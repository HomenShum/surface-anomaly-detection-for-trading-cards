#!/usr/bin/env python3
"""Detect PSA slab-label rectangles in a multi-label batch photo.

Use case: friend sends one photo containing 12-30 PSA slabs lined up. We want
to auto-extract every cert number, verify each, and ingest as silver_plus
references — without the operator manually transcribing each cert.

Pipeline:
  1. Load image, downscale if huge.
  2. Find white/near-white quad-ish regions (PSA labels are bright on a typical
     dark backdrop).
  3. Filter contours by area + aspect ratio (PSA labels are wide rectangles,
     roughly 3.2:1 to 4.0:1).
  4. Sort top-to-bottom, left-to-right.
  5. For each candidate, optionally run Tesseract OCR.
  6. Apply the PSA cert regex (\d{7,12}) and surface every candidate cert
     number along with its bounding box.
  7. Emit JSON to stdout (or to --output file).

Outputs JSON shape:
  {
    "source_image": "...",
    "image_size": [w, h],
    "labels": [
      {
        "index": 0,
        "bbox": [x, y, w, h],
        "crop_path": "...",
        "ocr_text": "...",
        "candidate_certs": ["154378339", ...],
        "candidate_grades": ["NM-MT 8", ...]
      }
    ],
    "summary": {
      "total_candidates": int,
      "ocr_run": bool,
      "unique_certs": int
    }
  }

Honest: this is morphology + heuristics, not a trained label detector. False
positives are rejected via aspect ratio + size; false negatives just mean the
operator can fall back to typing cert numbers directly.

Requires: opencv-python, pytesseract (already installed). Tesseract CLI on
PATH for the --ocr branch.

Usage:
  python scripts/certs/detect_psa_labels.py path/to/batch.jpg --ocr
  python scripts/certs/detect_psa_labels.py path/to/dir --ocr --output report.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, List, Optional, Tuple

import cv2
import numpy as np

try:
    import pytesseract  # type: ignore
except ImportError:  # pragma: no cover
    pytesseract = None  # type: ignore

PSA_CERT_RE = re.compile(r"\b(\d{7,12})\b")
GRADE_RE = re.compile(r"\b(?:GEM\s*MT\s*10|MINT\s*9(?:\.5)?|NM-?MT\s*8(?:\.5)?|NM\s*7|EX-?MT\s*6|EX\s*5|VG-?EX\s*4|VG\s*3|GOOD\s*2|FR\s*1|PR\s*1)\b", re.IGNORECASE)


@dataclass
class LabelCandidate:
    index: int
    bbox: Tuple[int, int, int, int]
    crop_path: Optional[str]
    ocr_text: str
    candidate_certs: List[str] = field(default_factory=list)
    candidate_grades: List[str] = field(default_factory=list)


def downscale_for_processing(image: np.ndarray, max_side: int = 2200) -> Tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return image, 1.0
    scale = max_side / longest
    resized = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def find_label_candidates(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """Find bright wide-rectangle blobs that are PSA-label-like.

    Returns a list of (x, y, w, h) bounding boxes in the input image's
    coordinate space.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Close gaps inside labels (text strokes break the white blob otherwise).
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = image.shape[:2]
    image_area = float(height * width)
    candidates: List[Tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = float(w * h)
        if area < image_area * 0.0035 or area > image_area * 0.18:
            continue
        if w <= 0 or h <= 0:
            continue
        aspect = w / float(h)
        # PSA labels are wide rectangles. Allow 2.4..6.0 to account for skew
        # and partial occlusion.
        if aspect < 2.4 or aspect > 6.0:
            continue
        # Reject near-image-bounding-boxes (whole photo). These usually fall
        # within the area filter above, but double-check on the longest side.
        if w >= int(width * 0.94) or h >= int(height * 0.94):
            continue
        candidates.append((x, y, w, h))
    # Sort top-to-bottom, then left-to-right (cluster by row using h/2).
    candidates.sort(key=lambda b: (b[1] // max(1, b[3] // 2), b[0]))
    return candidates


def crop_label(image: np.ndarray, bbox: Tuple[int, int, int, int], pad_ratio: float = 0.04) -> np.ndarray:
    x, y, w, h = bbox
    pad_x = int(w * pad_ratio)
    pad_y = int(h * pad_ratio)
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(image.shape[1], x + w + pad_x)
    y2 = min(image.shape[0], y + h + pad_y)
    return image[y1:y2, x1:x2]


def run_ocr(image: np.ndarray) -> str:
    if pytesseract is None:
        return ""
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    try:
        return pytesseract.image_to_string(rgb, lang="eng", config="--psm 6")
    except Exception as exc:  # pragma: no cover
        return f"[ocr error] {exc}"


def candidates_from_text(text: str) -> Tuple[List[str], List[str]]:
    cert_matches = sorted({m.group(1) for m in PSA_CERT_RE.finditer(text)})
    grade_matches = sorted({m.group(0).upper().replace(" ", " ").strip() for m in GRADE_RE.finditer(text)})
    return cert_matches, grade_matches


def process_image(image_path: Path, output_dir: Optional[Path], run_ocr_flag: bool) -> dict:
    image = cv2.imread(str(image_path))
    if image is None:
        raise FileNotFoundError(f"could not load image: {image_path}")
    work_image, _ = downscale_for_processing(image)

    bboxes = find_label_candidates(work_image)
    labels: List[LabelCandidate] = []
    for index, bbox in enumerate(bboxes):
        crop = crop_label(work_image, bbox)
        crop_path: Optional[str] = None
        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)
            target = output_dir / f"{image_path.stem}_label_{index:02d}.jpg"
            cv2.imwrite(str(target), crop)
            crop_path = str(target)

        ocr_text = run_ocr(crop) if run_ocr_flag else ""
        certs, grades = candidates_from_text(ocr_text)
        labels.append(
            LabelCandidate(
                index=index,
                bbox=tuple(int(v) for v in bbox),
                crop_path=crop_path,
                ocr_text=ocr_text.strip(),
                candidate_certs=certs,
                candidate_grades=grades,
            )
        )

    unique_certs = sorted({c for label in labels for c in label.candidate_certs})
    return {
        "source_image": str(image_path),
        "image_size": [int(work_image.shape[1]), int(work_image.shape[0])],
        "labels": [asdict(label) for label in labels],
        "summary": {
            "total_candidates": len(labels),
            "ocr_run": run_ocr_flag,
            "unique_certs": len(unique_certs),
            "certs": unique_certs,
        },
    }


def gather_image_paths(target: Path) -> List[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
        return sorted(p for p in target.rglob("*") if p.suffix.lower() in exts)
    raise FileNotFoundError(f"target not found: {target}")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Detect PSA slab-label rectangles in batch photos.")
    parser.add_argument("target", help="Image file or directory of images.")
    parser.add_argument("--output-dir", default=None, help="Directory to save cropped label images.")
    parser.add_argument("--output", default=None, help="Path to write JSON report (default stdout).")
    parser.add_argument("--ocr", action="store_true", help="Run Tesseract OCR on each crop.")
    args = parser.parse_args(argv)

    target = Path(args.target).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else None
    image_paths = gather_image_paths(target)

    reports: List[dict] = []
    for image_path in image_paths:
        try:
            reports.append(process_image(image_path, output_dir, args.ocr))
        except Exception as exc:  # pragma: no cover - friendly CLI behaviour
            reports.append({"source_image": str(image_path), "error": str(exc)})

    payload: Any = {
        "ocr_adapter": "tesseract" if args.ocr and pytesseract is not None else "off",
        "image_count": len(reports),
        "reports": reports,
    }
    serialized = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(serialized, encoding="utf-8")
    else:
        print(serialized)
    return 0


if __name__ == "__main__":
    sys.exit(main())
