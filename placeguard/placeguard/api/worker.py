"""Celery worker: `celery -A placeguard.api.worker worker --concurrency=1` on each GPU box.

Concurrency 1 per GPU: one audit saturates the detector, and two would only contend for memory.
"""

from __future__ import annotations

import logging
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import Celery

from ..config import PipelineConfig
from ..pipeline import AuditRequest, run_audit
from . import db
from .settings import get_settings
from .storage import get_storage

log = logging.getLogger(__name__)

settings = get_settings()
celery_app = Celery("placeguard", broker=settings.redis_url, backend=None)
celery_app.conf.update(
    task_always_eager=settings.eager,
    task_acks_late=True,  # a worker lost mid-audit puts the job back on the queue
    worker_prefetch_multiplier=1,
    task_time_limit=60 * 60,
)


def _update(job_id: str, **fields) -> None:
    with db.session() as s:
        job = s.get(db.Job, job_id)
        for k, v in fields.items():
            setattr(job, k, v)
        s.commit()


@celery_app.task(name="placeguard.run_job")
def run_job(job_id: str) -> None:
    with db.session() as s:
        job = s.get(db.Job, job_id)
        if job is None or job.status in ("completed", "failed"):
            return
        req = job.request
        uploads = {u.id: u for u in s.query(db.Upload).filter(db.Upload.api_key_id == job.api_key_id)}

    _update(job_id, status="processing", stage="ingest", progress=0.0, started_at=datetime.now(timezone.utc))
    storage = get_storage()
    last_write = [0.0]

    def progress(stage: str, frac: float) -> None:
        # Weight stages by typical cost so the bar moves honestly: detection dominates.
        base, span = {"ingest": (0.0, 0.05), "detect": (0.05, 0.75), "context": (0.8, 0.18), "report": (0.98, 0.02)}[stage]
        now = time.monotonic()
        if now - last_write[0] > 2.0 or frac >= 1.0:
            last_write[0] = now
            _update(job_id, stage=stage, progress=round(base + span * frac, 3))

    try:
        with tempfile.TemporaryDirectory(prefix=f"{job_id}-") as tmp:
            work = Path(tmp)
            refs = []
            for i, upload_id in enumerate(req["brand"]["reference_image_ids"]):
                u = uploads[upload_id]
                refs.append(storage.download(u.storage_key, work / f"ref{i}_{Path(u.filename).name}"))
            source = req["source"]
            if source["type"] == "upload":
                u = uploads[source["upload_id"]]
                video = str(storage.download(u.storage_key, work / "video.mp4"))
            else:
                video = str(source["url"])

            opts = req.get("options", {})
            config = PipelineConfig(
                sample_fps=opts.get("sample_fps", 2.0),
                safety_window_seconds=opts.get("safety_window_seconds", 10.0),
            )
            valuation, requirements = req.get("valuation", {}), req.get("requirements", {})
            result = run_audit(
                AuditRequest(
                    video=video, references=refs, brand_name=req["brand"]["name"],
                    competitors=req["brand"].get("competitors", []),
                    blocked_terms=req["brand"].get("blocked_terms", []),
                    views=valuation.get("views"), base_cpm=valuation.get("base_cpm", 20.0),
                    currency=valuation.get("currency", "USD"),
                    min_clear_view_time=requirements.get("min_clear_view_time"),
                    min_average_prominence=requirements.get("min_average_prominence"),
                ),
                config, workdir=work, progress=progress,
                transcriber=True if get_settings().transcribe else None,
            )
        _update(job_id, status="completed", stage="report", progress=1.0, result=result,
                completed_at=datetime.now(timezone.utc))
    except Exception as exc:
        log.exception("job %s failed", job_id)
        _update(job_id, status="failed", error=f"{type(exc).__name__}: {exc}", completed_at=datetime.now(timezone.utc))
