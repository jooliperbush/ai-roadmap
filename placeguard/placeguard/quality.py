"""Stage 3: how much of the detected product is actually visible, and is it in focus.

The frame is warped back into the reference image's coordinates using the detection homography, at
roughly the scale the product occupies on screen. The reference is cut into a grid; each textured
cell is compared to the same cell in the warped frame by normalised cross-correlation. A cell covered
by a hand, cropped by the frame edge, or blown out no longer correlates. That gives visible pixels
versus expected outline without a segmentation model, and the same warp gives a like-for-like
sharpness comparison (Laplacian variance of frame vs reference over the visible cells).

A SAM-based mask can replace this behind the same `assess` signature when GPU workers are in place.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import PipelineConfig
from .detect import Detection, Reference


def assess(frame_gray: np.ndarray, ref: Reference, det: Detection, config: PipelineConfig) -> None:
    rw, rh = ref.size
    on_screen_area = cv2.contourArea(det.quad.astype(np.float32))
    scale = min(1.0, float(np.sqrt(on_screen_area / (rw * rh))))
    # Never compare at fewer than ~8px per grid cell; below that NCC is meaningless.
    scale = max(scale, 8.0 * config.grid_cells / min(rw, rh))
    ww, wh = max(1, round(rw * scale)), max(1, round(rh * scale))

    ref_work = cv2.resize(ref.gray, (ww, wh), interpolation=cv2.INTER_AREA).astype(np.float32)
    to_work = np.diag([scale, scale, 1.0]) @ np.linalg.inv(det.homography)
    frame_work = cv2.warpPerspective(frame_gray, to_work, (ww, wh), flags=cv2.INTER_AREA).astype(np.float32)
    in_frame = cv2.warpPerspective(np.full(frame_gray.shape, 255, np.uint8), to_work, (ww, wh), flags=cv2.INTER_NEAREST)

    g = config.grid_cells
    xs = np.linspace(0, ww, g + 1).astype(int)
    ys = np.linspace(0, wh, g + 1).astype(int)
    textured = visible = 0
    vis_mask = np.zeros((wh, ww), np.uint8)
    for j in range(g):
        for i in range(g):
            sl = (slice(ys[j], ys[j + 1]), slice(xs[i], xs[i + 1]))
            r = ref_work[sl]
            if r.size < 4 or r.std() < config.cell_texture_min_std:
                continue
            textured += 1
            if (in_frame[sl] > 0).mean() < 0.5:
                continue
            if _ncc(r, frame_work[sl]) >= config.cell_ncc_threshold:
                visible += 1
                vis_mask[sl] = 1

    det.visible_fraction = visible / textured if textured else 1.0
    if visible:
        det.sharpness_ratio = _lap_var(frame_work, vis_mask) / max(_lap_var(ref_work, vis_mask), 1e-6)
    else:
        det.sharpness_ratio = 0.0
    det.in_focus = det.sharpness_ratio >= config.focus_ratio_threshold


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = float(np.sqrt((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / denom) if denom > 1e-6 else 0.0


def _lap_var(img: np.ndarray, mask: np.ndarray) -> float:
    # Measured at half resolution: codec softening lives in the finest octave, real defocus does not.
    if min(img.shape[:2]) >= 32:
        img = cv2.pyrDown(img)
        mask = cv2.resize(mask, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST)
    lap = cv2.Laplacian(img, cv2.CV_32F, ksize=3)
    # Erode so the cell borders of the mask do not contribute edge energy of their own.
    inner = cv2.erode(mask, np.ones((3, 3), np.uint8)) > 0
    vals = lap[inner] if inner.any() else lap[mask > 0]
    return float(vals.var()) if vals.size else 0.0
