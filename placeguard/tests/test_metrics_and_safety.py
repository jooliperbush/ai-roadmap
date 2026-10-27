import numpy as np
import pytest

from placeguard.config import PipelineConfig
from placeguard.context import Segment, lexical_flags, parse_judgement
from placeguard.detect import Detection
from placeguard.metrics import compute_emv, group_appearances, prominence_multiplier
from placeguard.pipeline import _brand_safety

CFG = PipelineConfig()


def det(t, quad=((0, 0), (64, 0), (64, 36), (0, 36)), visible=1.0):
    return Detection(t=t, reference=0, quad=np.array(quad, float), homography=np.eye(3), inliers=50,
                     frame_size=(640, 360), visible_fraction=visible, keyframe_jpeg=b"jpg")


def test_prominence_is_area_share_scaled_by_visibility():
    assert det(0).prominence == pytest.approx(1.0)  # 64x36 of 640x360
    assert det(0, visible=0.5).prominence == pytest.approx(0.5)


def test_prominence_clips_the_part_outside_the_frame():
    half_off = det(0, quad=((-32, 0), (32, 0), (32, 36), (-32, 36)))
    assert half_off.prominence == pytest.approx(0.5)


def test_emv_formula_from_spec():
    emv = compute_emv(views=100_000, base_cpm=25.0, clear_view_time=20.0, average_prominence=6.0, config=CFG)
    # (100000/1000) * 25 * (20/10) * 1.0
    assert emv["value"] == 5000.0
    assert emv["prominence_multiplier"] == 1.0


def test_emv_without_views_is_unvalued_not_zero():
    emv = compute_emv(views=None, base_cpm=25.0, clear_view_time=20.0, average_prominence=6.0, config=CFG)
    assert emv["value"] is None and "note" in emv


@pytest.mark.parametrize("prom,mult", [(0.5, 0.5), (2.0, 0.8), (4.9, 0.8), (5.0, 1.0), (20, 1.25), (45, 1.5)])
def test_prominence_tiers(prom, mult):
    assert prominence_multiplier(prom, CFG.prominence_tiers) == mult


def test_appearances_bridge_one_missed_sample_but_not_two():
    dets = [det(t) for t in (1.0, 1.5, 2.5, 3.0, 5.0)]  # gap of one sample after 1.5, then a long gap
    apps = group_appearances(dets, CFG)
    assert [(a.start, a.end) for a in apps] == [(1.0, 3.5), (5.0, 5.5)]


def test_lexical_flags_only_inside_the_window():
    apps = group_appearances([det(30.0), det(30.5)], CFG)
    segments = [
        Segment(5.0, 8.0, "what the fuck is this"),  # 22s before: outside the 10s window
        Segment(22.0, 25.0, "this is honestly shit"),  # inside
        Segment(31.0, 33.0, "way better than Globex, by the way"),  # inside, competitor
        Segment(36.0, 38.0, "they f*** up the shipping"),  # inside, censored profanity
        Segment(55.0, 58.0, "damn this shoot went long"),  # outside, and not on the strong list anyway
    ]
    flags = lexical_flags(segments, apps, 10.0, competitors=["Globex"])
    got = sorted((f["category"], f["term"].lower()) for f in flags)
    assert got == [("competitor_mention", "globex"), ("profanity", "f***"), ("profanity", "shit")]


def test_lexical_flags_respect_word_boundaries():
    apps = group_appearances([det(1.0)], CFG)
    flags = lexical_flags([Segment(0, 2, "Scunthorpe classic, a bombastic shitake... no")], apps, 10.0, competitors=[])
    assert flags == []


def test_judge_output_is_held_to_the_closed_schema():
    raw = '```json\n{"sentiment": "Angry", "flags": [{"category": "violence", "evidence": "a fight"}, {"category": "vibes"}]}\n```'
    assert parse_judgement(raw) == {"sentiment": "neutral", "flags": [{"category": "violence", "evidence": "a fight"}]}


class FakeTranscriber:
    def __init__(self, segments):
        self.segments = segments

    def transcribe(self, wav):
        return self.segments


class FakeJudge:
    def __init__(self, sentiment="positive", flags=()):
        self.sentiment, self.flags, self.calls = sentiment, list(flags), []

    def judge(self, brand, transcript, keyframes):
        self.calls.append((brand, transcript, keyframes))
        return {"sentiment": self.sentiment, "flags": self.flags}


class Req:
    brand_name, competitors, blocked_terms = "Acme", ["Globex"], []


class Meta:
    path = None


def test_brand_safety_passes_when_checked_and_clean(tmp_path, monkeypatch):
    monkeypatch.setattr("placeguard.pipeline.extract_audio", lambda p, out: out)
    apps = group_appearances([det(10.0), det(10.5)], CFG)
    judge = FakeJudge()
    out = _brand_safety(Req, Meta, apps, CFG, tmp_path, FakeTranscriber([Segment(9, 12, "love this bottle")]), judge)
    assert out["passed"] is True and out["transcript_available"] and out["llm_reviewed"]
    assert judge.calls[0][1] == "love this bottle" and judge.calls[0][2] == [b"jpg", b"jpg"]


def test_negative_scene_fails_brand_safety(tmp_path, monkeypatch):
    monkeypatch.setattr("placeguard.pipeline.extract_audio", lambda p, out: None)
    apps = group_appearances([det(10.0)], CFG)
    out = _brand_safety(Req, Meta, apps, CFG, tmp_path, FakeTranscriber([]), FakeJudge(sentiment="negative"))
    assert out["passed"] is False
    assert [f["category"] for f in out["flags"]] == ["negative_sentiment"]
    assert "no audio track" in out["notes"]
