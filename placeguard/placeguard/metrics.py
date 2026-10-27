"""Stage 5: turn per-frame detections into appearances, the four standard metrics, and V1 EMV."""

from __future__ import annotations

from dataclasses import dataclass, field

from .config import PipelineConfig
from .detect import Detection

EMV_FORMULA = "(views / 1000) * base_cpm * (clear_view_time / 10) * prominence_multiplier"


def is_clear(d: Detection, config: PipelineConfig) -> bool:
    return d.visible_fraction >= config.clear_visible_fraction and d.in_focus


@dataclass
class Appearance:
    start: float
    end: float  # exclusive: last sampled timestamp + one sample interval
    detections: list[Detection] = field(default_factory=list)

    def to_dict(self, config: PipelineConfig) -> dict:
        step = 1.0 / config.sample_fps
        proms = [d.prominence for d in self.detections]
        return {
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "screen_time": round(len(self.detections) * step, 2),
            "clear_view_time": round(sum(is_clear(d, config) for d in self.detections) * step, 2),
            "average_prominence": round(sum(proms) / len(proms), 2),
            "peak_prominence": round(max(proms), 2),
        }


def group_appearances(detections: list[Detection], config: PipelineConfig) -> list[Appearance]:
    """Detections no more than `max_gap_samples` missed samples apart form one continuous appearance."""
    step = 1.0 / config.sample_fps
    max_gap = step * (config.max_gap_samples + 1) + 1e-6
    out: list[Appearance] = []
    for d in sorted(detections, key=lambda d: d.t):
        if out and d.t - out[-1].detections[-1].t <= max_gap:
            out[-1].detections.append(d)
            out[-1].end = d.t + step
        else:
            out.append(Appearance(start=d.t, end=d.t + step, detections=[d]))
    return out


def prominence_multiplier(average_prominence: float, tiers) -> float:
    mult = tiers[0][1]
    for lower, m in tiers:
        if average_prominence >= lower:
            mult = m
    return mult


def compute_metrics(detections: list[Detection], config: PipelineConfig) -> dict:
    """Screen time counts each sampled frame with a confirmed detection as 1/fps seconds on screen."""
    step = 1.0 / config.sample_fps
    proms = [d.prominence for d in detections]
    return {
        "total_screen_time": round(len(detections) * step, 2),
        "clear_view_time": round(sum(is_clear(d, config) for d in detections) * step, 2),
        "average_prominence": round(sum(proms) / len(proms), 2) if proms else 0.0,
    }


def compute_emv(views: int | None, base_cpm: float, clear_view_time: float, average_prominence: float,
                config: PipelineConfig, currency: str = "USD") -> dict:
    mult = prominence_multiplier(average_prominence, config.prominence_tiers)
    value = None if views is None else (views / 1000.0) * base_cpm * (clear_view_time / 10.0) * mult
    return {
        "value": None if value is None else round(value, 2),
        "currency": currency,
        "views": views,
        "base_cpm": base_cpm,
        "clear_view_time": clear_view_time,
        "prominence_multiplier": mult,
        "formula": EMV_FORMULA,
        **({"note": "view count unknown; supply views to value this placement"} if views is None else {}),
    }
