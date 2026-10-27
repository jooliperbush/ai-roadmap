"""HTTP API. Run with `uvicorn placeguard.api.app:app`."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .schemas import CreateJob, JobAccepted, JobOut, UploadOut
from .settings import get_settings
from .storage import get_storage
from .worker import run_job

@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="PlaceGuard API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
bearer = HTTPBearer(auto_error=False)

IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def api_key(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> db.ApiKey:
    key = db.find_api_key(creds.credentials) if creds and creds.scheme.lower() == "bearer" else None
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing or invalid API key",
                            headers={"WWW-Authenticate": "Bearer"})
    return key


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/api/v1/uploads", response_model=UploadOut, status_code=201)
def create_upload(kind: str = Form(..., pattern="^(video|image)$"), file: UploadFile = File(...),
                  key: db.ApiKey = Depends(api_key)) -> UploadOut:
    """Upload an MP4 (kind=video) or a reference image of the logo/packaging (kind=image)."""
    head = file.file.read(64)
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if kind == "video":
        if size > get_settings().max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"video exceeds {get_settings().max_upload_mb} MB")
        if head[4:8] != b"ftyp":
            raise HTTPException(415, "video must be an MP4 file")
    else:
        if size > MAX_IMAGE_BYTES:
            raise HTTPException(413, "reference image exceeds 10 MB")
        data = file.file.read()
        file.file.seek(0)
        if cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED) is None:
            raise HTTPException(415, "reference image must be PNG, JPEG or WebP")

    upload_id = db._id("upl")
    filename = Path(file.filename or kind).name[:300]
    upload = db.Upload(id=upload_id, api_key_id=key.id, kind=kind, filename=filename,
                       content_type=file.content_type or "application/octet-stream", size_bytes=size,
                       storage_key=f"uploads/{key.id}/{upload_id}{Path(filename).suffix.lower()[:8]}")
    get_storage().put(upload.storage_key, file.file)
    with db.session() as s:
        s.add(upload)
        s.commit()
    return UploadOut(upload_id=upload.id, kind=kind, filename=upload.filename, size_bytes=size)


@app.post("/api/v1/audit/jobs", response_model=JobAccepted, status_code=202)
def create_job(body: CreateJob, key: db.ApiKey = Depends(api_key)) -> JobAccepted:
    with db.session() as s:
        owned = {u.id: u.kind for u in s.query(db.Upload).filter(db.Upload.api_key_id == key.id)}
        for ref in body.brand.reference_image_ids:
            if owned.get(ref) != "image":
                raise HTTPException(422, f"reference_image_ids: {ref} is not an image upload on this account")
        if body.source.type == "upload" and owned.get(body.source.upload_id) != "video":
            raise HTTPException(422, f"source.upload_id: {body.source.upload_id} is not a video upload on this account")
        job = db.Job(api_key_id=key.id, request=body.model_dump(mode="json"))
        s.add(job)
        s.commit()
    run_job.delay(job.id)
    return JobAccepted(job_id=job.id, status="queued", created_at=job.created_at,
                       links={"self": f"/api/v1/audit/jobs/{job.id}"})


@app.get("/api/v1/audit/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, key: db.ApiKey = Depends(api_key)) -> JobOut:
    with db.session() as s:
        job = s.get(db.Job, job_id)
        if job is None or job.api_key_id != key.id:
            raise HTTPException(404, "job not found")
        return JobOut(job_id=job.id, status=job.status, stage=job.stage, progress=job.progress,
                      created_at=job.created_at, started_at=job.started_at, completed_at=job.completed_at,
                      request=job.request, result=job.result, error=job.error)
