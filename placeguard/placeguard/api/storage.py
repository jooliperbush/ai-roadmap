"""Blob storage for uploaded videos and reference images: a local directory in dev, S3 in production."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import BinaryIO, Protocol

from .settings import get_settings


class Storage(Protocol):
    def put(self, key: str, data: BinaryIO) -> None: ...
    def download(self, key: str, dest: Path) -> Path: ...


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError("storage key escapes the storage root")
        return path

    def put(self, key: str, data: BinaryIO) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            shutil.copyfileobj(data, fh)

    def download(self, key: str, dest: Path) -> Path:
        shutil.copyfile(self._path(key), dest)
        return dest


class S3Storage:
    def __init__(self, bucket: str, prefix: str):
        import boto3

        self.client = boto3.client("s3")
        self.bucket, self.prefix = bucket, prefix

    def put(self, key: str, data: BinaryIO) -> None:
        self.client.upload_fileobj(data, self.bucket, self.prefix + key)

    def download(self, key: str, dest: Path) -> Path:
        self.client.download_file(self.bucket, self.prefix + key, str(dest))
        return dest


def get_storage() -> Storage:
    s = get_settings()
    if s.storage_backend == "s3":
        if not s.s3_bucket:
            raise RuntimeError("PLACEGUARD_STORAGE=s3 requires PLACEGUARD_S3_BUCKET")
        return S3Storage(s.s3_bucket, s.s3_prefix)
    return LocalStorage(s.storage_root)
