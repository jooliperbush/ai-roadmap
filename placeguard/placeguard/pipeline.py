"""The whole audit, end to end: one video and 1-5 reference images in, one report dict out."""

from __future__ import annotations

import csv
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2

from .config import PipelineConfig
from .context import OpenAICompatibleJudge, SceneJudge, Transcriber, WhisperTranscriber, lexical_flags, window_text
from .detect import Detection, Detector, OrbDetector, load_references
from .ingest import VideoMeta, download_youtube, extract_audio, is_youtube_url, probe, sample_frames
from .metrics import compute_emv, compute_metrics, group_appearances, is_clear
from .quality import assess

log = logging.getLogger(__name__)

Progress = Callable[[str, float], None]


@dataclass
class AuditRequest:
    video: str  # local path or YouTube URL
    references: list[Path]
    brand_name: str
    competitors: list[str] = field(default_factory=list)
    blocked_terms: list[str] = field(default_factory=list)
    views: int | None = None  # overrides the YouTube view count when given
    base_cpm: float = 20.0
    currency: str = "USD"
    min_clear_view_time: float | None = None  # contract requirements, if any
    min_average_prominence: float | None = None


def run_audit(req: AuditRequest, config: PipelineConfig | None = None, *, workdir: Path | None = None,
              detector: Detector | None = None, transcriber: Transcriber | None | bool = True,
              judge: SceneJudge | None | bool = True, progress: Progress | None = None,
              detections_csv: Path | None = None) -> dict:
    """`transcriber` / `judge`: True means build the default (judge only if an LLM key is configured),
    None or False means skip that layer, and an instance is used as given."""
    config = config or PipelineConfig()
    progress = progress or (lambda stage, frac: None)
    with tempfile.TemporaryDirectory(prefix="placeguard-") as tmp:
        work = workdir or Path(tmp)

        progress("ingest", 0.0)
        meta = download_youtube(req.video, work) if is_youtube_url(req.video) else probe(Path(req.video))
        refs = load_references(req.references, config)
        detector = detector or OrbDetector(refs, config)

        detections: list[Detection] = []
        sampled = 0
        expected = max(1, int(meta.duration * config.sample_fps))
        for t, frame in sample_frames(meta.path, config.sample_fps, config.max_frame_side):
            sampled += 1
            det = detector.detect(frame, t)
            if det is not None:
                assess(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), refs[det.reference], det, config)
                det.keyframe_jpeg = _keyframe(frame, det)
                detections.append(det)
            if sampled % 20 == 0:
                progress("detect", min(sampled / expected, 1.0))
        progress("detect", 1.0)

        appearances = group_appearances(detections, config)
        metrics = compute_metrics(detections, config)

        progress("context", 0.0)
        safety = _brand_safety(req, meta, appearances, config, work, transcriber, judge)
        progress("context", 1.0)

    if detections_csv:
        write_detections_csv(detections, refs, config, detections_csv)

    metrics["brand_safety_score"] = safety["passed"]
    views = req.views if req.views is not None else meta.views
    emv = compute_emv(views, req.base_cpm, metrics["clear_view_time"], metrics["average_prominence"], config, req.currency)
    progress("report", 1.0)
    return {
        "video": {
            "source": req.video,
            "title": meta.title,
            "duration_seconds": round(meta.duration, 2),
            "width": meta.width,
            "height": meta.height,
            "views": views,
            "sample_fps": config.sample_fps,
            "sampled_frames": sampled,
        },
        "metrics": metrics,
        "emv": emv,
        "compliance": _compliance(req, metrics),
        "appearances": [a.to_dict(config) for a in appearances],
        "safety": safety,
        "timeline": [
            {
                "t": d.t,
                "prominence": round(d.prominence, 2),
                "visible_fraction": round(d.visible_fraction, 2),
                "sharpness_ratio": round(d.sharpness_ratio, 2),
                "clear": is_clear(d, config),
                "bbox": list(d.bbox),
                "reference": refs[d.reference].name,
            }
            for d in detections
        ],
    }


def _keyframe(frame, det: Detection) -> bytes:
    """Small annotated JPEG kept only for the safety judge: the frame with the product outlined."""
    img = frame.copy()
    cv2.polylines(img, [det.quad.astype("int32").reshape(-1, 1, 2)], True, (0, 255, 0), 2)
    h, w = img.shape[:2]
    scale = 512 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])[1].tobytes()


def _brand_safety(req, meta: VideoMeta, appearances, config, work: Path, transcriber, judge) -> dict:
    window = config.safety_window_seconds
    out = {"passed": None, "window_seconds": window, "transcript_available": False,
           "llm_reviewed": False, "sentiment": [], "flags": [], "notes": []}
    if not appearances:
        out["passed"] = True
        out["notes"].append("product never appeared, so no placement context to evaluate")
        return out

    segments = []
    if transcriber is True:
        transcriber = WhisperTranscriber()
    if not transcriber:
        out["notes"].append("transcription disabled for this run")
    else:
        wav = extract_audio(meta.path, work / "audio.wav")
        if wav is None:
            out["notes"].append("no audio track")
        else:
            try:
                segments = transcriber.transcribe(wav)
                out["transcript_available"] = True
            except ImportError:
                out["notes"].append("whisper not installed; transcript checks skipped")
            except Exception as exc:  # a failed transcript must not sink the visual audit
                log.exception("transcription failed")
                out["notes"].append(f"transcription failed: {exc}")
    if out["transcript_available"]:
        out["flags"] += lexical_flags(segments, appearances, window, req.competitors, req.blocked_terms)

    if judge is True:
        judge = OpenAICompatibleJudge.from_env(window)
        if judge is None:
            out["notes"].append("no LLM key configured; semantic scene review skipped")
    if judge:
        try:
            for i, a in enumerate(appearances):
                frames = [d.keyframe_jpeg for d in _spread(a.detections, config.keyframes_per_appearance)]
                verdict = judge.judge(req.brand_name, window_text(segments, a, window), frames)
                out["sentiment"].append({"appearance": i, "sentiment": verdict["sentiment"]})
                for f in verdict["flags"]:
                    out["flags"].append({**f, "source": "llm", "t": round(a.start, 2), "appearances": [i]})
                if verdict["sentiment"] == "negative":
                    out["flags"].append({"category": "negative_sentiment", "source": "llm", "t": round(a.start, 2),
                                         "evidence": "scene judged negative around the placement", "appearances": [i]})
            out["llm_reviewed"] = True
        except Exception as exc:
            log.exception("scene judge failed")
            out["notes"].append(f"semantic scene review failed: {exc}")

    evaluated = out["transcript_available"] or out["llm_reviewed"]
    # Pass/fail only when something was actually checked; otherwise say so instead of passing by default.
    out["passed"] = (not out["flags"]) if evaluated else None
    return out


def _spread(items: list, k: int) -> list:
    if len(items) <= k:
        return items
    return [items[round(i * (len(items) - 1) / (k - 1))] for i in range(k)] if k > 1 else [items[len(items) // 2]]


def _compliance(req: AuditRequest, metrics: dict) -> dict:
    checks = []
    if req.min_clear_view_time is not None:
        checks.append({"check": "min_clear_view_time", "required": req.min_clear_view_time,
                       "actual": metrics["clear_view_time"], "passed": metrics["clear_view_time"] >= req.min_clear_view_time})
    if req.min_average_prominence is not None:
        checks.append({"check": "min_average_prominence", "required": req.min_average_prominence,
                       "actual": metrics["average_prominence"],
                       "passed": metrics["average_prominence"] >= req.min_average_prominence})
    safe = metrics["brand_safety_score"]
    checks.append({"check": "brand_safety", "required": True, "actual": safe, "passed": safe})
    results = [c["passed"] for c in checks]
    passed = False if False in results else (None if None in results else True)
    return {"passed": passed, "checks": checks}


def write_detections_csv(detections: list[Detection], refs, config: PipelineConfig, path: Path) -> None:
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["timestamp", "reference", "x", "y", "w", "h", "inliers", "prominence_pct",
                    "visible_fraction", "sharpness_ratio", "in_focus", "clear"])
        for d in detections:
            w.writerow([d.t, refs[d.reference].name, *d.bbox, d.inliers, round(d.prominence, 3),
                        round(d.visible_fraction, 3), round(d.sharpness_ratio, 3), d.in_focus, is_clear(d, config)])
