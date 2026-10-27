"""Stage 4: contextual brand safety around each appearance.

Two layers. A deterministic lexical pass over the Whisper transcript catches profanity, violent
language and competitor mentions inside the safety window (default +/-10 s of any appearance); it is
cheap, explainable, and always runs when there is a transcript. An optional multimodal judge then
reads the same transcript window plus keyframes and returns sentiment and semantic flags (e.g. the
product shown during a rant, or next to drugs) that words alone miss.
"""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .metrics import Appearance


@dataclass
class Segment:
    start: float
    end: float
    text: str


class Transcriber(Protocol):
    def transcribe(self, wav: Path) -> list[Segment]: ...


class WhisperTranscriber:
    """faster-whisper when installed (several times faster on CPU), otherwise openai-whisper."""

    def __init__(self, model_size: str = "base"):
        self.model_size = model_size

    def transcribe(self, wav: Path) -> list[Segment]:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            WhisperModel = None
        if WhisperModel is not None:
            model = WhisperModel(self.model_size, device="auto", compute_type="int8")
            segments, _ = model.transcribe(str(wav), vad_filter=True)
            return [Segment(s.start, s.end, s.text.strip()) for s in segments]
        import whisper

        result = whisper.load_model(self.model_size).transcribe(str(wav))
        return [Segment(s["start"], s["end"], s["text"].strip()) for s in result["segments"]]


# Deliberately strong-only: "damn", "shoot" (a photo shoot), "shot" and "crap" are everyday creator
# speech and would bury real flags. Brands with a stricter policy extend these lists per job.
PROFANITY = [
    "fuck", "fucking", "fucked", "motherfucker", "shit", "shitty", "bullshit", "bitch", "bastard",
    "asshole", "cunt", "goddamn", "slut", "whore",
]
VIOLENCE = [
    "kill him", "kill her", "kill them", "killed", "murder", "murdered", "stabbed", "shooting",
    "gunfire", "assault", "suicide", "bomb", "terrorist", "dead body",
]
# Whisper often censors profanity itself ("f***", "s***"); count those too.
_CENSORED = re.compile(r"(?<![\w*])[a-z]+\*{2,}[a-z]*(?![\w*])", re.I)


def _word_pattern(words: list[str]) -> re.Pattern | None:
    words = [w.strip() for w in words if w and w.strip()]
    if not words:
        return None
    return re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")\b", re.I)


def lexical_flags(segments: list[Segment], appearances: list[Appearance], window: float,
                  competitors: list[str], blocked_terms: list[str] | None = None) -> list[dict]:
    checks = [
        ("profanity", _word_pattern(PROFANITY)),
        ("violence", _word_pattern(VIOLENCE)),
        ("competitor_mention", _word_pattern(competitors)),
        ("blocked_term", _word_pattern(blocked_terms or [])),
    ]
    flags = []
    for seg in segments:
        near = [i for i, a in enumerate(appearances) if seg.start <= a.end + window and seg.end >= a.start - window]
        if not near:
            continue
        found: list[tuple[str, str]] = []
        for category, pat in checks:
            if pat:
                found += [(category, m.group(0)) for m in pat.finditer(seg.text)]
        found += [("profanity", m.group(0)) for m in _CENSORED.finditer(seg.text)]
        for category, term in found:
            flags.append({
                "category": category,
                "source": "transcript",
                "t": round(seg.start, 2),
                "term": term,
                "evidence": seg.text,
                "appearances": near,
            })
    return flags


def window_text(segments: list[Segment], a: Appearance, window: float) -> str:
    return " ".join(s.text for s in segments if s.start <= a.end + window and s.end >= a.start - window)


class SceneJudge(Protocol):
    def judge(self, brand: str, transcript: str, keyframes: list[bytes]) -> dict: ...


JUDGE_PROMPT = """You are a brand-safety reviewer for sponsored video placements.
The brand "{brand}" appears on screen in the attached frames. The transcript below covers the same
moment plus {window:.0f} seconds either side.

Decide, strictly from the frames and transcript:
- sentiment toward or around the brand placement: "positive", "neutral" or "negative"
- any brand-safety flags present in this moment, from this closed list only:
  profanity, violence, sexual_content, drugs_alcohol, hate_or_harassment, dangerous_activity,
  competitor_mention, negative_product_mention, misinformation

Return JSON only: {{"sentiment": "...", "flags": [{{"category": "...", "evidence": "short quote or visual description"}}]}}
Return an empty flags list when nothing applies. Do not speculate beyond what is shown or said.

Transcript:
\"\"\"{transcript}\"\"\"
"""

JUDGE_CATEGORIES = {
    "profanity", "violence", "sexual_content", "drugs_alcohol", "hate_or_harassment",
    "dangerous_activity", "competitor_mention", "negative_product_mention", "misinformation",
}


class OpenAICompatibleJudge:
    """Any OpenAI-compatible chat endpoint with image input: GPT-4o-mini by default, or Gemini Flash via
    its OpenAI-compatible base URL (PLACEGUARD_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai)."""

    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1",
                 window: float = 10.0, timeout: float = 60.0):
        self.api_key, self.model, self.base_url = api_key, model, base_url.rstrip("/")
        self.window, self.timeout = window, timeout

    @classmethod
    def from_env(cls, window: float = 10.0) -> "OpenAICompatibleJudge | None":
        key = os.environ.get("PLACEGUARD_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not key:
            return None
        return cls(
            api_key=key,
            model=os.environ.get("PLACEGUARD_LLM_MODEL", "gpt-4o-mini"),
            base_url=os.environ.get("PLACEGUARD_LLM_BASE_URL", "https://api.openai.com/v1"),
            window=window,
        )

    def judge(self, brand: str, transcript: str, keyframes: list[bytes]) -> dict:
        import httpx

        content = [{"type": "text", "text": JUDGE_PROMPT.format(brand=brand, window=self.window,
                                                                 transcript=transcript or "(no speech)")}]
        for jpeg in keyframes:
            url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
            content.append({"type": "image_url", "image_url": {"url": url, "detail": "low"}})
        resp = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": content}],
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return parse_judgement(resp.json()["choices"][0]["message"]["content"])


def parse_judgement(raw: str) -> dict:
    """Hold the model to the closed schema: unknown sentiment becomes neutral, unknown categories are dropped."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        data = json.loads(match.group(0)) if match else {}
    sentiment = str(data.get("sentiment", "neutral")).lower()
    if sentiment not in {"positive", "neutral", "negative"}:
        sentiment = "neutral"
    flags = []
    for f in data.get("flags") or []:
        if isinstance(f, dict) and f.get("category") in JUDGE_CATEGORIES:
            flags.append({"category": f["category"], "evidence": str(f.get("evidence", ""))[:300]})
    return {"sentiment": sentiment, "flags": flags}
