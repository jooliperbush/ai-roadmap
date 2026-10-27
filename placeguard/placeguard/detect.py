"""Stage 2: find the brand's product or logo in a frame and confirm it matches the reference images.

The default detector is ORB keypoints + RANSAC homography against each reference image. It needs no
GPU and no training, it localises the product as a quadrilateral (so prominence and occlusion can be
measured in the product's own coordinates), and the inlier count doubles as the "does this match the
brand's reference" confirmation the spec asks for.

Its weakness is texture-poor products and very small or heavily blurred appearances. For those,
`GroundingDinoDetector` proposes boxes from a text prompt and verifies each with the same matcher.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from .config import PipelineConfig


@dataclass
class Reference:
    name: str
    gray: np.ndarray
    keypoints: list
    descriptors: np.ndarray

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.gray.shape[:2]
        return w, h

    @property
    def corners(self) -> np.ndarray:
        w, h = self.size
        return np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)


@dataclass
class Detection:
    t: float
    reference: int
    quad: np.ndarray  # 4x2 product corners in frame pixels
    homography: np.ndarray  # reference -> frame
    inliers: int
    frame_size: tuple[int, int]  # (w, h)
    visible_fraction: float = 1.0
    sharpness_ratio: float = 1.0
    in_focus: bool = True
    keyframe_jpeg: bytes | None = field(default=None, repr=False)

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        """Axis-aligned box clipped to the frame, as (x, y, w, h)."""
        fw, fh = self.frame_size
        xs = np.clip(self.quad[:, 0], 0, fw)
        ys = np.clip(self.quad[:, 1], 0, fh)
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(np.ceil(xs.max())), int(np.ceil(ys.max()))
        return x0, y0, x1 - x0, y1 - y0

    @property
    def prominence(self) -> float:
        """Percent of the viewport covered by the visible part of the product.

        Uses the product's true outline clipped to the frame, scaled by the visible fraction, so a
        product held at an angle or half behind a hand is not credited with its whole bounding box.
        """
        fw, fh = self.frame_size
        clipped = _clip_polygon_to_rect(self.quad, fw, fh)
        if len(clipped) < 3:
            return 0.0
        area = cv2.contourArea(clipped.astype(np.float32))
        return 100.0 * area * self.visible_fraction / (fw * fh)


class Detector(Protocol):
    def detect(self, frame_bgr: np.ndarray, t: float) -> Detection | None: ...


def _orb(n: int) -> cv2.ORB:
    return cv2.ORB_create(nfeatures=n, scaleFactor=1.2, nlevels=10, edgeThreshold=15, patchSize=31, fastThreshold=12)


def load_references(paths: list[Path], config: PipelineConfig) -> list[Reference]:
    if not 1 <= len(paths) <= 5:
        raise ValueError("provide between 1 and 5 reference images")
    orb = _orb(config.reference_features)
    refs = []
    for p in paths:
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError(f"cannot read reference image: {p}")
        gray = _to_gray(img)
        h, w = gray.shape
        scale = config.reference_max_side / max(h, w)
        if scale < 1.0:
            gray = cv2.resize(gray, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        kps, desc = orb.detectAndCompute(gray, None)
        if desc is None or len(kps) < config.min_inliers:
            raise ValueError(
                f"reference image {Path(p).name} has too little texture to match ({len(kps or [])} keypoints); "
                "use a tighter crop of the logo or packaging"
            )
        refs.append(Reference(name=Path(p).name, gray=gray, keypoints=kps, descriptors=desc))
    return refs


def _to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    if img.shape[2] == 4:
        # Composite transparent logos onto mid-grey so the alpha edge becomes texture rather than noise.
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32) * alpha + 128.0 * (1.0 - alpha)
        img = rgb.astype(np.uint8)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


class OrbDetector:
    def __init__(self, references: list[Reference], config: PipelineConfig):
        self.references = references
        self.config = config
        self.orb = _orb(config.frame_features)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)

    def detect(self, frame_bgr: np.ndarray, t: float) -> Detection | None:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        kps, desc = self.orb.detectAndCompute(gray, None)
        if desc is None or len(kps) < self.config.min_inliers:
            return None
        fh, fw = gray.shape[:2]
        return self.match(kps, desc, t, (fw, fh))

    def match(self, kps, desc, t: float, frame_size: tuple[int, int], offset=(0.0, 0.0)) -> Detection | None:
        """Best-matching reference for these frame keypoints; `offset` shifts keypoints from a crop."""
        fw, fh = frame_size
        best: Detection | None = None
        for i, ref in enumerate(self.references):
            det = self._match_one(i, ref, kps, desc, t, (fw, fh), offset)
            if det and (best is None or det.inliers > best.inliers):
                best = det
        return best

    def _match_one(self, index, ref, kps, desc, t, frame_size, offset) -> Detection | None:
        cfg = self.config
        pairs = self.matcher.knnMatch(ref.descriptors, desc, k=2)
        good = [m for m, *rest in (p for p in pairs if p) if not rest or m.distance < cfg.ratio_test * rest[0].distance]
        if len(good) < cfg.min_inliers:
            return None
        src = np.float32([ref.keypoints[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kps[m.trainIdx].pt for m in good]).reshape(-1, 1, 2) + np.float32(offset)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if H is None or mask is None:
            return None
        inliers = int(mask.sum())
        if inliers < cfg.min_inliers:
            return None
        quad = cv2.perspectiveTransform(ref.corners, H).reshape(4, 2)
        if not _plausible_quad(quad, ref.size, frame_size, cfg.min_area_fraction):
            return None
        return Detection(t=t, reference=index, quad=quad, homography=H, inliers=inliers, frame_size=frame_size)


def _plausible_quad(quad: np.ndarray, ref_size, frame_size, min_area_fraction: float) -> bool:
    """Reject degenerate homographies: twisted, collapsed, absurdly sheared, or vanishingly small."""
    if not np.all(np.isfinite(quad)):
        return False
    if not cv2.isContourConvex(quad.astype(np.float32).reshape(-1, 1, 2)):
        return False
    fw, fh = frame_size
    area = cv2.contourArea(quad.astype(np.float32))
    if area < min_area_fraction * fw * fh:
        return False
    sides = np.linalg.norm(quad - np.roll(quad, -1, axis=0), axis=1)
    rw, rh = ref_size
    # Opposite sides should stay comparable, and the overall aspect should not flip wildly.
    if min(sides[0], sides[2]) / max(sides[0], sides[2]) < 0.3 or min(sides[1], sides[3]) / max(sides[1], sides[3]) < 0.3:
        return False
    aspect_ref = rw / rh
    aspect = ((sides[0] + sides[2]) / 2) / max((sides[1] + sides[3]) / 2, 1e-6)
    return 0.25 < aspect / aspect_ref < 4.0


def _clip_polygon_to_rect(poly: np.ndarray, w: float, h: float) -> np.ndarray:
    """Sutherland-Hodgman clip of a convex polygon to [0,w]x[0,h]."""
    pts = [tuple(p) for p in poly]
    for axis, bound, keep_below in ((0, 0.0, False), (0, w, True), (1, 0.0, False), (1, h, True)):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            cur_in = cur[axis] <= bound if keep_below else cur[axis] >= bound
            prev_in = prev[axis] <= bound if keep_below else prev[axis] >= bound
            if cur_in != prev_in:
                frac = (bound - prev[axis]) / (cur[axis] - prev[axis])
                out.append(tuple(prev[k] + frac * (cur[k] - prev[k]) for k in range(2)))
            if cur_in:
                out.append(cur)
        pts = out
        if not pts:
            break
    return np.array(pts, dtype=np.float64).reshape(-1, 2)


class GroundingDinoDetector:
    """Zero-shot proposals from a text prompt, each confirmed against the references with ORB.

    Requires `transformers` and `torch` (install the `gpu` extra). Not exercised by the test suite,
    which runs on CPU without model weights.
    """

    def __init__(self, references: list[Reference], config: PipelineConfig, prompt: str,
                 model_id: str = "IDEA-Research/grounding-dino-tiny", box_threshold: float = 0.3):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(self.device)
        self.prompt = prompt.lower().strip().rstrip(".") + "."
        self.box_threshold = box_threshold
        self.verifier = OrbDetector(references, config)

    def detect(self, frame_bgr: np.ndarray, t: float) -> Detection | None:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=rgb, text=self.prompt, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        h, w = rgb.shape[:2]
        results = self.processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=self.box_threshold, target_sizes=[(h, w)]
        )[0]
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        best = None
        for box in results["boxes"].tolist():
            x0, y0, x1, y1 = (int(max(0, v)) for v in box)
            pad = int(0.1 * max(x1 - x0, y1 - y0))
            x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)
            crop = gray[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            # Upsample small crops so ORB has enough pixels to describe.
            scale = max(1.0, 240.0 / max(crop.shape))
            if scale > 1.0:
                crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            kps, desc = self.verifier.orb.detectAndCompute(crop, None)
            if desc is None:
                continue
            for kp in kps:
                kp.pt = (kp.pt[0] / scale, kp.pt[1] / scale)
            det = self.verifier.match(kps, desc, t, (w, h), offset=(float(x0), float(y0)))
            if det and (best is None or det.inliers > best.inliers):
                best = det
        return best
