from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    storage_backend: str  # "local" or "s3"
    storage_root: str
    s3_bucket: str | None
    s3_prefix: str
    eager: bool  # run Celery tasks inline: tests and single-process dev
    cors_origins: tuple[str, ...]
    max_upload_mb: int
    transcribe: bool


@lru_cache
def get_settings() -> Settings:
    env = os.environ.get
    return Settings(
        database_url=env("DATABASE_URL", "sqlite:///./placeguard.db"),
        redis_url=env("REDIS_URL", "redis://localhost:6379/0"),
        storage_backend=env("PLACEGUARD_STORAGE", "local"),
        storage_root=env("PLACEGUARD_STORAGE_ROOT", "./data"),
        s3_bucket=env("PLACEGUARD_S3_BUCKET"),
        s3_prefix=env("PLACEGUARD_S3_PREFIX", "placeguard/"),
        eager=env("PLACEGUARD_EAGER", "0") == "1",
        cors_origins=tuple(o for o in env("PLACEGUARD_CORS_ORIGINS", "http://localhost:3000").split(",") if o),
        max_upload_mb=int(env("PLACEGUARD_MAX_UPLOAD_MB", "2048")),
        transcribe=env("PLACEGUARD_TRANSCRIBE", "1") == "1",
    )
