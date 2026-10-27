"""PostgreSQL in production (DATABASE_URL), SQLite for local dev and tests. Same models either way."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from functools import lru_cache

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .settings import get_settings


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class Base(DeclarativeBase):
    pass


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("key"))
    name: Mapped[str] = mapped_column(String(200))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Upload(Base):
    __tablename__ = "uploads"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("upl"))
    api_key_id: Mapped[str] = mapped_column(ForeignKey("api_keys.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "video" | "image"
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("job"))
    api_key_id: Mapped[str] = mapped_column(ForeignKey("api_keys.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|processing|completed|failed
    stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    request: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


@lru_cache
def _sessionmaker() -> sessionmaker:
    url = get_settings().database_url
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
    return sessionmaker(create_engine(url, **kwargs), expire_on_commit=False)


def session() -> Session:
    return _sessionmaker()()


def init_db() -> None:
    Base.metadata.create_all(_sessionmaker().kw["bind"])


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_api_key(name: str) -> str:
    """Returns the raw key once; only its hash is stored."""
    raw = "pg_" + secrets.token_urlsafe(32)
    with session() as s:
        s.add(ApiKey(name=name, key_hash=hash_key(raw)))
        s.commit()
    return raw


def find_api_key(raw: str) -> ApiKey | None:
    with session() as s:
        key = s.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(raw)))
        return key if key and key.revoked_at is None else None
