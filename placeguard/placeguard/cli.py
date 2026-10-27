"""`python -m placeguard audit VIDEO --ref logo.png` — the week 1-2 script, and the dev entry points."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import PipelineConfig
from .pipeline import AuditRequest, run_audit


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="placeguard")
    sub = parser.add_subparsers(dest="command", required=True)

    a = sub.add_parser("audit", help="audit one video (MP4 path or YouTube URL)")
    a.add_argument("video")
    a.add_argument("--ref", action="append", required=True, type=Path, help="reference image (1-5, repeatable)")
    a.add_argument("--brand", default="the brand")
    a.add_argument("--competitor", action="append", default=[])
    a.add_argument("--blocked-term", action="append", default=[])
    a.add_argument("--views", type=int, help="override the view count used for EMV")
    a.add_argument("--cpm", type=float, default=20.0, help="base CPM (default 20)")
    a.add_argument("--fps", type=float, default=2.0, help="sampling rate (default 2)")
    a.add_argument("--min-clear-view", type=float, help="contract minimum clear view seconds")
    a.add_argument("--min-prominence", type=float, help="contract minimum average prominence %%")
    a.add_argument("--no-transcribe", action="store_true", help="skip Whisper")
    a.add_argument("--no-llm", action="store_true", help="skip the multimodal scene judge")
    a.add_argument("--csv", type=Path, help="write per-frame detections CSV here")
    a.add_argument("--json", type=Path, help="write the report JSON here (default: stdout)")

    k = sub.add_parser("create-key", help="issue an API key for the HTTP API")
    k.add_argument("name")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.command == "create-key":
        from .api.db import create_api_key, init_db

        init_db()
        print(create_api_key(args.name))
        return 0

    if not 1 <= len(args.ref) <= 5:
        parser.error("provide between 1 and 5 --ref images")
    req = AuditRequest(
        video=args.video, references=args.ref, brand_name=args.brand, competitors=args.competitor,
        blocked_terms=args.blocked_term, views=args.views, base_cpm=args.cpm,
        min_clear_view_time=args.min_clear_view, min_average_prominence=args.min_prominence,
    )
    report = run_audit(
        req, PipelineConfig(sample_fps=args.fps),
        transcriber=None if args.no_transcribe else True,
        judge=None if args.no_llm else True,
        progress=lambda stage, frac: print(f"{stage} {frac:.0%}", file=sys.stderr),
        detections_csv=args.csv,
    )
    text = json.dumps(report, indent=2)
    if args.json:
        args.json.write_text(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
