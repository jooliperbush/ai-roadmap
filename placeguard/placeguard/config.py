"""Tunable thresholds for one audit. Every number here is a V1 default to be calibrated in alpha."""

from __future__ import annotations

from dataclasses import dataclass, field

# (lower bound of average prominence in %, multiplier). The highest bound not above the value wins.
# Placeholder tiers until the week-8 calibration run replaces them with fitted values.
DEFAULT_PROMINENCE_TIERS: tuple[tuple[float, float], ...] = (
    (0.0, 0.5),
    (2.0, 0.8),
    (5.0, 1.0),
    (15.0, 1.25),
    (30.0, 1.5),
)


@dataclass
class PipelineConfig:
    # Sampling: 2-3 FPS is enough for screen-time accounting; each sampled frame stands for 1/fps seconds.
    sample_fps: float = 2.0
    # Frames wider or taller than this are downscaled before detection. Prominence is a ratio, so it is unaffected.
    max_frame_side: int = 1280

    # ORB detection
    reference_max_side: int = 480
    reference_features: int = 1500
    frame_features: int = 4000
    ratio_test: float = 0.75
    min_inliers: int = 12
    min_area_fraction: float = 0.0005  # of the frame; anything smaller is noise, not a placement

    # Occlusion and clarity
    grid_cells: int = 6
    cell_texture_min_std: float = 8.0
    cell_ncc_threshold: float = 0.5
    clear_visible_fraction: float = 0.8  # spec: ">80% unobscured"
    focus_ratio_threshold: float = 0.35  # frame sharpness / reference sharpness at the same scale

    # Appearances: detections closer than this many sample intervals are one continuous appearance
    max_gap_samples: int = 1

    # Brand safety
    safety_window_seconds: float = 10.0
    keyframes_per_appearance: int = 3

    # Valuation
    prominence_tiers: tuple[tuple[float, float], ...] = field(default=DEFAULT_PROMINENCE_TIERS)
