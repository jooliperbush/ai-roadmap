from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, HttpUrl, field_validator


class YouTubeSource(BaseModel):
    type: Literal["youtube"]
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def _youtube(cls, v: HttpUrl) -> HttpUrl:
        if v.host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"}:
            raise ValueError("only YouTube URLs are supported in V1; upload other videos as MP4")
        return v


class UploadSource(BaseModel):
    type: Literal["upload"]
    upload_id: str


class Brand(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    reference_image_ids: list[str] = Field(min_length=1, max_length=5)
    competitors: list[str] = Field(default_factory=list, max_length=50)
    blocked_terms: list[str] = Field(default_factory=list, max_length=200)


class Valuation(BaseModel):
    views: int | None = Field(default=None, ge=0, description="defaults to the YouTube view count")
    base_cpm: float = Field(default=20.0, gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)


class Requirements(BaseModel):
    min_clear_view_time: float | None = Field(default=None, ge=0)
    min_average_prominence: float | None = Field(default=None, ge=0, le=100)


class Options(BaseModel):
    sample_fps: float = Field(default=2.0, ge=0.5, le=5.0)
    safety_window_seconds: float = Field(default=10.0, ge=0, le=60)


class CreateJob(BaseModel):
    source: Annotated[Union[YouTubeSource, UploadSource], Field(discriminator="type")]
    brand: Brand
    valuation: Valuation = Field(default_factory=Valuation)
    requirements: Requirements = Field(default_factory=Requirements)
    options: Options = Field(default_factory=Options)


class UploadOut(BaseModel):
    upload_id: str
    kind: Literal["video", "image"]
    filename: str
    size_bytes: int


class JobAccepted(BaseModel):
    job_id: str
    status: str
    created_at: datetime
    links: dict[str, str]


class JobOut(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "completed", "failed"]
    stage: str | None
    progress: float
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    request: dict
    result: dict | None = None
    error: str | None = None
