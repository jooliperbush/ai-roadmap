"""Synthetic sponsored video with known ground truth, so detection metrics can be asserted exactly.

Timeline (seconds):
  0-2   no product
  2-6   product clear, drifting and scaling slightly
  6-8   product half covered by a flat "hand"
  8-10  product heavily defocused
  10-12 no product
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

W, H, FPS, DURATION = 640, 360, 30, 12.0
CLEAR = (2.0, 6.0)
OCCLUDED = (6.0, 8.0)
BLURRED = (8.0, 10.0)


def make_logo(seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    logo = np.full((160, 240, 3), 245, np.uint8)
    for _ in range(18):
        color = tuple(int(c) for c in rng.integers(0, 200, 3))
        kind = rng.integers(0, 3)
        x, y = int(rng.integers(10, 230)), int(rng.integers(10, 150))
        if kind == 0:
            cv2.circle(logo, (x, y), int(rng.integers(6, 22)), color, -1)
        elif kind == 1:
            cv2.rectangle(logo, (x, y), (x + int(rng.integers(8, 40)), y + int(rng.integers(8, 30))), color, -1)
        else:
            cv2.line(logo, (x, y), (int(rng.integers(0, 240)), int(rng.integers(0, 160))), color, 3)
    cv2.putText(logo, "ACME", (40, 105), cv2.FONT_HERSHEY_DUPLEX, 2.0, (20, 20, 120), 4)
    cv2.rectangle(logo, (2, 2), (237, 157), (0, 0, 0), 3)
    return logo


def _background(rng: np.random.Generator) -> np.ndarray:
    small = rng.integers(60, 190, (H // 20, W // 20, 3), dtype=np.uint8)
    bg = cv2.resize(small, (W, H), interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(bg, (0, 0), 6)


def write_video(path: Path, logo: np.ndarray, *, with_audio_tone: bool = False) -> Path:
    rng = np.random.default_rng(1)
    bg = _background(rng)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    n = int(DURATION * FPS)
    for k in range(n):
        t = k / FPS
        frame = bg.copy()
        if CLEAR[0] <= t < BLURRED[1]:
            s = 1.0 + 0.1 * np.sin(t)
            lw, lh = int(240 * s), int(160 * s)
            x = int(180 + 40 * np.sin(t * 0.7))
            y = int(90 + 20 * np.cos(t * 0.5))
            patch = cv2.resize(logo, (lw, lh), interpolation=cv2.INTER_AREA)
            if BLURRED[0] <= t < BLURRED[1]:
                patch = cv2.GaussianBlur(patch, (0, 0), 3.5)
            frame[y:y + lh, x:x + lw] = patch
            if OCCLUDED[0] <= t < OCCLUDED[1]:
                cv2.rectangle(frame, (x + lw // 2, y - 10), (x + lw + 10, y + lh + 10), (120, 160, 200), -1)
        writer.write(frame)
    writer.release()
    return path
