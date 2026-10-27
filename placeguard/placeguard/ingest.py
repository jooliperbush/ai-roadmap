"""Stage 1: get a local MP4, sample frames at a low fixed rate, and pull the audio track."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np


@dataclass
class VideoMeta:
    path: Path
    duration: float
    fps: float
    width: int
    height: int
    title: str | None = None
    views: int | None = None
    source_url: str | None = None


def is_youtube_url(value: str) -> bool:
    return value.startswith(("http://", "https://")) and any(
        host in value for host in ("youtube.com/", "youtu.be/", "youtube-nocookie.com/")
    )


def download_youtube(url: str, out_dir: Path) -> VideoMeta:
    """Download at <=720p (enough for detection, a fraction of the bytes) and keep the public view count."""
    import yt_dlp  # imported lazily so the pipeline runs on uploads without it

    out_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info)).with_suffix(".mp4")
    meta = probe(path)
    meta.title = info.get("title")
    meta.views = info.get("view_count")
    meta.source_url = url
    return meta


def probe(path: Path) -> VideoMeta:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"cannot open video: {path}")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        cap.release()
    if fps <= 0 or width <= 0 or height <= 0:
        raise ValueError(f"not a readable video: {path}")
    return VideoMeta(path=Path(path), duration=frames / fps, fps=fps, width=width, height=height)


def sample_frames(path: Path, sample_fps: float, max_side: int) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (timestamp, BGR frame) at sample_fps. Reads sequentially: seeking is unreliable across codecs."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"cannot open video: {path}")
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = 1.0 / sample_fps
    next_t = 0.0
    index = 0
    try:
        while True:
            if not cap.grab():
                break
            t = index / native_fps
            index += 1
            if t + 1e-6 < next_t:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            next_t += step
            yield round(t, 3), _limit_size(frame, max_side)
    finally:
        cap.release()


def _limit_size(frame: np.ndarray, max_side: int) -> np.ndarray:
    h, w = frame.shape[:2]
    scale = max_side / max(h, w)
    if scale >= 1.0:
        return frame
    return cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def extract_audio(path: Path, out_wav: Path) -> Path | None:
    """16 kHz mono WAV for Whisper, or None when the file has no audio track or ffmpeg is missing."""
    if shutil.which("ffmpeg") is None:
        return None
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", str(out_wav)],
        capture_output=True,
    )
    if result.returncode != 0 or not out_wav.exists() or out_wav.stat().st_size <= 44:
        return None
    return out_wav
