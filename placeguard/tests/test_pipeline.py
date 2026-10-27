"""Detection, occlusion and focus scoring against the synthetic video's known timeline."""

import csv

import cv2
import numpy as np
import pytest

from placeguard.config import PipelineConfig
from placeguard.detect import load_references
from placeguard.pipeline import AuditRequest, run_audit
from synthetic import BLURRED, CLEAR, OCCLUDED


@pytest.fixture(scope="module")
def report(assets, tmp_path_factory):
    out = tmp_path_factory.mktemp("out") / "detections.csv"
    req = AuditRequest(video=str(assets / "video.mp4"), references=[assets / "logo.png"], brand_name="Acme",
                       views=250_000, base_cpm=20.0, min_clear_view_time=5.0)
    r = run_audit(req, PipelineConfig(), transcriber=None, judge=None, detections_csv=out)
    r["_csv"] = out
    return r


def _frames_in(report, window):
    return [f for f in report["timeline"] if window[0] <= f["t"] < window[1]]


def test_screen_time_matches_ground_truth(report):
    # Product is on screen from 2s to 10s; sampled at 2 FPS that is 16 frames.
    assert report["metrics"]["total_screen_time"] == pytest.approx(8.0, abs=0.5)
    assert all(CLEAR[0] <= f["t"] < BLURRED[1] for f in report["timeline"]), "no detections outside the placement"


def test_only_unobstructed_in_focus_frames_count_as_clear(report):
    assert report["metrics"]["clear_view_time"] == pytest.approx(4.0, abs=0.5)
    assert all(f["clear"] for f in _frames_in(report, CLEAR))
    assert not any(f["clear"] for f in _frames_in(report, OCCLUDED))
    assert not any(f["clear"] for f in _frames_in(report, BLURRED))


def test_occlusion_measures_the_covered_half(report):
    occluded = [f["visible_fraction"] for f in _frames_in(report, OCCLUDED)]
    assert occluded and all(0.3 <= v <= 0.65 for v in occluded)
    assert all(f["visible_fraction"] >= 0.95 for f in _frames_in(report, CLEAR))


def test_blur_is_caught_by_focus_not_occlusion(report):
    blurred = _frames_in(report, BLURRED)
    assert blurred, "defocused product should still be detected"
    assert all(f["sharpness_ratio"] < 0.35 for f in blurred)
    assert all(f["sharpness_ratio"] >= 0.35 for f in _frames_in(report, CLEAR))


def test_prominence_is_share_of_viewport(report):
    # Logo is ~240x160 (+/-10%) in a 640x360 frame: roughly 13-20% of the viewport.
    clear = [f["prominence"] for f in _frames_in(report, CLEAR)]
    assert all(12 <= p <= 21 for p in clear)
    # Half covered: visible prominence roughly halves.
    occluded = [f["prominence"] for f in _frames_in(report, OCCLUDED)]
    assert max(occluded) < min(clear)


def test_one_continuous_appearance(report):
    assert len(report["appearances"]) == 1
    a = report["appearances"][0]
    assert a["start"] == pytest.approx(2.0, abs=0.5) and a["end"] == pytest.approx(10.0, abs=0.5)


def test_emv_and_compliance(report):
    emv = report["emv"]
    expected = 250_000 / 1000 * 20.0 * (report["metrics"]["clear_view_time"] / 10) * emv["prominence_multiplier"]
    assert emv["value"] == pytest.approx(expected)
    assert report["compliance"]["passed"] is False  # 4s clear < 5s required
    # No transcript and no judge: safety is reported as not evaluated, never as a silent pass.
    assert report["metrics"]["brand_safety_score"] is None


def test_csv_has_a_row_per_detection(report):
    with open(report["_csv"]) as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(report["timeline"])
    assert {"timestamp", "x", "y", "w", "h", "prominence_pct"} <= rows[0].keys()


def test_rejects_a_reference_with_no_texture(tmp_path):
    flat = tmp_path / "flat.png"
    cv2.imwrite(str(flat), np.full((100, 100, 3), 200, np.uint8))
    with pytest.raises(ValueError, match="too little texture"):
        load_references([flat], PipelineConfig())


def test_unrelated_reference_finds_nothing(assets, tmp_path):
    from synthetic import make_logo

    other = tmp_path / "other.png"
    cv2.imwrite(str(other), make_logo(seed=99)[:, ::-1])
    req = AuditRequest(video=str(assets / "video.mp4"), references=[other], brand_name="Other", views=1000)
    r = run_audit(req, transcriber=None, judge=None)
    assert r["metrics"]["total_screen_time"] <= 0.5
