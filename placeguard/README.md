# PlaceGuard

**Independent verification of product placements in creator video: how long the product was really
on screen, how clearly, in what context, and what that exposure is worth.**

V1 targets influencer agencies and DTC brands sponsoring YouTube videos. An audit is fire-and-forget:
a YouTube URL or MP4 plus 1–5 reference images of the logo or packaging go in; screen time, clear-view
time, prominence, brand safety, a contract compliance verdict and an Equivalent Media Value come out.

```
video (YouTube URL / MP4) ─┐
reference images (1–5) ────┤
                           ▼
 1 ingest      yt-dlp ≤720p · sample frames at 2 FPS · extract 16 kHz mono audio
 2 detect      ORB keypoints + RANSAC homography per reference → product outline per frame
 3 quality     warp frame into reference space → per-cell NCC (visible %) + Laplacian (focus)
 4 context     Whisper transcript → lexical flags ±10 s · multimodal LLM → sentiment + semantic flags
 5 report      appearances · metrics · EMV · compliance checks · per-frame timeline (+ CSV)
```

## Layout

| Path | What it is |
|---|---|
| `placeguard/ingest.py` | YouTube download (keeps the public view count), frame sampling, audio extraction |
| `placeguard/detect.py` | `OrbDetector` (default, CPU) and `GroundingDinoDetector` (zero-shot proposals, ORB-verified) |
| `placeguard/quality.py` | Occlusion and focus scoring in the product's own coordinates |
| `placeguard/context.py` | Whisper transcription, lexical safety pass, OpenAI-compatible multimodal judge |
| `placeguard/metrics.py` | Appearances, the four standard metrics, EMV |
| `placeguard/pipeline.py` | `run_audit()`: the whole audit end to end |
| `placeguard/cli.py` | `placeguard audit …` (the week 1–2 script) and `placeguard create-key` |
| `placeguard/api/` | FastAPI app, SQLAlchemy models, S3/local storage, Celery worker |
| `web/` | Next.js + Tailwind + Recharts dashboard |
| `tests/` | Pipeline accuracy against a synthetic video with known ground truth; metrics; safety; API |

## Running it

```bash
pip install -e ".[api,audio,dev]"

# Week 1-2 script: one MP4 + one logo -> CSV of timestamps and boxes, plus the JSON report
placeguard audit video.mp4 --ref logo.png --brand Acme --views 250000 --cpm 20 \
  --competitor Globex --min-clear-view 15 --csv detections.csv --json report.json

# Full stack: Postgres, Redis, API, worker, dashboard on :3000
docker compose up --build
docker compose exec api placeguard create-key my-agency    # prints the API key once

# Single-process dev without Redis (jobs run inline in the request)
PLACEGUARD_EAGER=1 uvicorn placeguard.api.app:app --reload
cd web && npm install && npm run dev

pytest                        # 31 tests, CPU only, no network or model weights needed
```

Configuration is environment variables: `DATABASE_URL`, `REDIS_URL`, `PLACEGUARD_STORAGE`
(`local`|`s3`), `PLACEGUARD_S3_BUCKET`, `PLACEGUARD_CORS_ORIGINS`, `PLACEGUARD_TRANSCRIBE`,
and for the scene judge `OPENAI_API_KEY` (or `PLACEGUARD_LLM_API_KEY`, `PLACEGUARD_LLM_MODEL`,
`PLACEGUARD_LLM_BASE_URL` — Gemini Flash works through its OpenAI-compatible endpoint).

## Metrics

Each sampled frame with a confirmed detection counts as `1 / sample_fps` seconds on screen.

| Metric | Definition |
|---|---|
| `total_screen_time` | Seconds the product is detected on screen |
| `clear_view_time` | Seconds the product is ≥80% visible **and** in focus (sharpness ≥ 0.35× the reference at the same scale) |
| `average_prominence` | Mean % of the viewport covered by the *visible* product outline (clipped to the frame, scaled by visible fraction), over frames where it is on screen |
| `brand_safety_score` | `true`/`false` when checks ran: fails on any flag within ±10 s of an appearance. **`null` when nothing could be checked** (no audio and no LLM) — never a silent pass |

**EMV** = `(views / 1000) × base_cpm × (clear_view_time / 10) × prominence_multiplier`

Views default to the YouTube view count. Prominence multiplier tiers are placeholders for week 8
calibration (`config.py`):

| Average prominence | <2% | 2–5% | 5–15% | 15–30% | ≥30% |
|---|---|---|---|---|---|
| Multiplier | 0.5 | 0.8 | 1.0 | 1.25 | 1.5 |

## API (V1)

Every endpoint takes `Authorization: Bearer <API_KEY>`. Keys are stored as SHA-256 hashes; uploads
and jobs are scoped to the key that created them.

### `POST /api/v1/uploads`

Multipart form: `kind` = `video` (MP4, checked by its `ftyp` header) or `image` (PNG/JPEG/WebP,
≤10 MB, decoded to verify). Returns `201`:

```json
{ "upload_id": "upl_3f9c…", "kind": "image", "filename": "logo.png", "size_bytes": 48211 }
```

### `POST /api/v1/audit/jobs`

```json
{
  "source": { "type": "youtube", "url": "https://www.youtube.com/watch?v=abc123" },
  "brand": {
    "name": "Acme",
    "reference_image_ids": ["upl_3f9c…", "upl_77a1…"],
    "competitors": ["Globex"],
    "blocked_terms": []
  },
  "valuation": { "views": null, "base_cpm": 20.0, "currency": "USD" },
  "requirements": { "min_clear_view_time": 15, "min_average_prominence": null },
  "options": { "sample_fps": 2.0, "safety_window_seconds": 10 }
}
```

`source` may instead be `{ "type": "upload", "upload_id": "upl_…" }`. Only `source` and `brand`
(with 1–5 image uploads) are required. Response `202 Accepted`:

```json
{
  "job_id": "job_8c990ea479db45aa9c09",
  "status": "queued",
  "created_at": "2026-10-27T21:04:11Z",
  "links": { "self": "/api/v1/audit/jobs/job_8c990ea479db45aa9c09" }
}
```

### `GET /api/v1/audit/jobs/{job_id}`

`status` is `queued` → `processing` (with `stage` and `progress` 0–1) → `completed` or `failed`
(with `error`). Completed, `200 OK` (timeline truncated):

```json
{
  "job_id": "job_8c990ea479db45aa9c09",
  "status": "completed",
  "stage": "report",
  "progress": 1.0,
  "result": {
    "video": { "title": "My desk setup", "duration_seconds": 612.4, "views": 250000, "sample_fps": 2.0, "sampled_frames": 1225 },
    "metrics": { "total_screen_time": 41.5, "clear_view_time": 28.0, "average_prominence": 6.8, "brand_safety_score": true },
    "emv": { "value": 14000.0, "currency": "USD", "views": 250000, "base_cpm": 20.0, "clear_view_time": 28.0,
             "prominence_multiplier": 1.0, "formula": "(views / 1000) * base_cpm * (clear_view_time / 10) * prominence_multiplier" },
    "compliance": { "passed": true, "checks": [
      { "check": "min_clear_view_time", "required": 15, "actual": 28.0, "passed": true },
      { "check": "brand_safety", "required": true, "actual": true, "passed": true } ] },
    "appearances": [ { "start": 182.0, "end": 214.5, "screen_time": 30.0, "clear_view_time": 22.5, "average_prominence": 7.9, "peak_prominence": 18.2 } ],
    "safety": { "passed": true, "window_seconds": 10, "transcript_available": true, "llm_reviewed": true,
                "sentiment": [ { "appearance": 0, "sentiment": "positive" } ], "flags": [], "notes": [] },
    "timeline": [ { "t": 182.0, "prominence": 7.4, "visible_fraction": 1.0, "sharpness_ratio": 0.91, "clear": true, "bbox": [412, 220, 180, 140], "reference": "logo.png" } ]
  }
}
```

A flag looks like `{ "category": "profanity", "source": "transcript", "t": 176.0, "term": "shit",
"evidence": "this one was honestly shit", "appearances": [0] }`. LLM flags use a closed category list
(`context.py`); anything outside it is dropped.

## Design decisions

- **ORB + homography is the default detector, not YOLO.** A fine-tuned YOLO needs labelled data per
  brand, which V1 doesn't have. The homography gives the product's true outline (not a loose box),
  which is what makes occlusion and prominence measurable, and the inlier count is the reference-match
  confirmation. Grounding DINO is wired in for texture-poor or tiny products; it needs the `gpu` extra.
- **Occlusion without SAM.** Comparing the reference and the warped frame cell by cell measures
  "visible pixels vs expected outline" directly and runs on CPU. SAM can replace `quality.assess`
  behind the same signature once GPU workers exist.
- **Focus measured at half resolution.** Codec softening lives in the finest octave; real defocus
  doesn't. On the test video this separates clear frames (0.84–1.17× reference) from defocused ones
  (0.10–0.12×) with a wide margin either side of the 0.35 threshold.
- **No result is invented.** Unknown views → EMV `null` with a note. No audio and no LLM key →
  brand safety `null`. A failed transcription is noted and the visual audit still completes.
- **Lexical lists are strong-terms only** ("damn", "shoot", "shot" are normal creator speech); brands
  extend them per job with `blocked_terms`.

## Status against the 60-day plan

| Weeks | Milestone | State |
|---|---|---|
| 1–2 | Core ML pipeline: MP4 + logo → CSV of timestamps and boxes | **Done.** Accuracy asserted against a synthetic video with known ground truth (8.0 s on screen, 4.0 s clear, 47% visible while half-covered) |
| 3–4 | Whisper + multimodal LLM safety around appearances | **Built, tested with fakes.** Not yet run against real Whisper weights or a live LLM (no network to model hosts from the build environment) |
| 5 | FastAPI + Celery, cloud GPU workers | **API, queue, storage done and tested** (eager mode). GPU worker provisioning not started |
| 6–7 | Next.js dashboard | **Done.** Paste a link or upload, add logos, watch progress, read the report; verified in a browser at desktop and phone width |
| 8 | Alpha: 50 real sponsored videos | **Not started.** Needed to calibrate thresholds, the prominence tiers and EMV |

Known V1 limits, in priority order for alpha:

1. **Real-footage accuracy is unmeasured.** The synthetic test proves the mechanics, not performance
   on motion blur, curved packaging, glare or tiny logos. Week 8 needs hand-labelled ground truth.
2. **One instance per frame per reference.** Two of the same product in shot count once.
3. **YouTube download is untested here** (network blocked in the build environment) and is subject
   to YouTube's terms and rate limiting; uploads are the reliable path.
4. **The dashboard holds the API key in the browser.** Fine for internal alpha users; customer-facing
   use needs a server-side session in front of the API.
5. **No migrations yet:** tables are created on startup. Add Alembic before the first schema change.
