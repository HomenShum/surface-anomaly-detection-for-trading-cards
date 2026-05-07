"""PSA slab-label detection pipeline.

Mirrors the logic in `scripts/certs/detect_psa_labels.py` so the same heuristic
runs from a CLI batch and from a FastAPI endpoint. We DO NOT scrape PSA
content here — this is bounded morphology + Tesseract OCR on a user-supplied
photo (the operator's own picture of slabs they own).

Honest contract:
  - Returns candidate cert numbers and grade tokens, never a confirmed match.
  - Cropped label images are NOT persisted server-side (we operate on the
    in-memory ndarray and return base64 thumbnails by default).
  - Tesseract OCR is best-effort; missing OCR returns empty text and the
    operator falls back to typing cert numbers.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Tuple

import cv2
import numpy as np

try:
    import pytesseract  # type: ignore
except ImportError:  # pragma: no cover
    pytesseract = None  # type: ignore

PSA_CERT_RE = re.compile(r"\b(\d{7,12})\b")
GRADE_RE = re.compile(
    r"\b(?:GEM\s*MT\s*10|MINT\s*9(?:\.5)?|NM-?MT\s*8(?:\.5)?|NM\s*7|EX-?MT\s*6|"
    r"EX\s*5|VG-?EX\s*4|VG\s*3|GOOD\s*2|FR\s*1|PR\s*1)\b",
    re.IGNORECASE,
)


@dataclass
class DetectedLabel:
    index: int
    bbox: Tuple[int, int, int, int]
    crop_base64: Optional[str]
    ocr_text: str
    candidate_certs: List[str] = field(default_factory=list)
    candidate_grades: List[str] = field(default_factory=list)


@dataclass
class DetectLabelsResult:
    image_size: Tuple[int, int]
    labels: List[DetectedLabel]
    ocr_run: bool
    unique_certs: List[str]


def _decode_image(image_bytes: bytes) -> np.ndarray:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode image bytes")
    return image


def _downscale(image: np.ndarray, max_side: int = 2200) -> np.ndarray:
    h, w = image.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return image
    scale = max_side / longest
    return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def _find_label_candidates(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = image.shape[:2]
    image_area = float(height * width)
    out: List[Tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = float(w * h)
        if area < image_area * 0.0035 or area > image_area * 0.18:
            continue
        if w <= 0 or h <= 0:
            continue
        aspect = w / float(h)
        if aspect < 2.4 or aspect > 6.0:
            continue
        if w >= int(width * 0.94) or h >= int(height * 0.94):
            continue
        out.append((int(x), int(y), int(w), int(h)))
    out.sort(key=lambda b: (b[1] // max(1, b[3] // 2), b[0]))
    return out


def _crop_label(image: np.ndarray, bbox: Tuple[int, int, int, int], pad_ratio: float = 0.04) -> np.ndarray:
    x, y, w, h = bbox
    pad_x = int(w * pad_ratio)
    pad_y = int(h * pad_ratio)
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(image.shape[1], x + w + pad_x)
    y2 = min(image.shape[0], y + h + pad_y)
    return image[y1:y2, x1:x2]


def _crop_to_base64(crop: np.ndarray, max_side: int = 320, quality: int = 78) -> Optional[str]:
    if crop.size == 0:
        return None
    h, w = crop.shape[:2]
    longest = max(h, w)
    if longest > max_side:
        scale = max_side / longest
        crop = cv2.resize(crop, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        return None
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def _run_ocr(crop: np.ndarray) -> str:
    if pytesseract is None:
        return ""
    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    try:
        return str(pytesseract.image_to_string(rgb, lang="eng", config="--psm 6")).strip()
    except Exception:  # pragma: no cover
        return ""


def _candidates(text: str) -> Tuple[List[str], List[str]]:
    certs = sorted({m.group(1) for m in PSA_CERT_RE.finditer(text)})
    grades = sorted({m.group(0).upper().strip() for m in GRADE_RE.finditer(text)})
    return certs, grades


def detect_labels_in_bytes(image_bytes: bytes, *, run_ocr: bool = True, include_thumbnails: bool = True) -> DetectLabelsResult:
    image = _downscale(_decode_image(image_bytes))
    bboxes = _find_label_candidates(image)
    labels: List[DetectedLabel] = []
    for index, bbox in enumerate(bboxes):
        crop = _crop_label(image, bbox)
        crop_b64 = _crop_to_base64(crop) if include_thumbnails else None
        ocr_text = _run_ocr(crop) if run_ocr else ""
        certs, grades = _candidates(ocr_text)
        labels.append(
            DetectedLabel(
                index=index,
                bbox=bbox,
                crop_base64=crop_b64,
                ocr_text=ocr_text,
                candidate_certs=certs,
                candidate_grades=grades,
            )
        )
    unique = sorted({c for label in labels for c in label.candidate_certs})
    return DetectLabelsResult(
        image_size=(int(image.shape[1]), int(image.shape[0])),
        labels=labels,
        ocr_run=run_ocr,
        unique_certs=unique,
    )


def detect_labels_in_iterable(image_byte_chunks: Iterable[bytes], *, run_ocr: bool = True) -> List[DetectLabelsResult]:
    out: List[DetectLabelsResult] = []
    for chunk in image_byte_chunks:
        out.append(detect_labels_in_bytes(chunk, run_ocr=run_ocr))
    return out
