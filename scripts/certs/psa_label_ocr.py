#!/usr/bin/env python
"""Local PSA label OCR helper.

Reads one slab/label batch image, finds label-like rectangular crops with OpenCV,
OCRs those crops plus the full image with Tesseract, and prints JSON.

This is intentionally local-only. It does not verify PSA, fetch cert pages, or
store images. The Next importer uses its text output only to extract candidate
cert numbers.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytesseract


def read_image(path: Path):
    img = cv2.imread(str(path))
    if img is None:
        raise SystemExit(f"Could not read image: {path}")
    return img


def normalize_for_ocr(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = 2.0 if max(gray.shape[:2]) < 1800 else 1.0
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.bilateralFilter(gray, 7, 45, 45)
    return gray


def label_crops(image: np.ndarray, max_crops: int = 48) -> list[np.ndarray]:
    gray = normalize_for_ocr(image)
    edges = cv2.Canny(gray, 60, 160)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h, w = gray.shape[:2]
    image_area = h * w
    candidates: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = cw * ch
        if area < image_area * 0.002 or area > image_area * 0.35:
            continue
        aspect = cw / max(ch, 1)
        if not (1.6 <= aspect <= 8.5):
            continue
        candidates.append((x, y, cw, ch, area))

    candidates.sort(key=lambda item: item[4], reverse=True)
    crops: list[np.ndarray] = []
    seen: list[tuple[int, int, int, int]] = []
    for x, y, cw, ch, _area in candidates:
        box = (x, y, cw, ch)
        if any(abs(x - sx) < 12 and abs(y - sy) < 12 for sx, sy, _sw, _sh in seen):
            continue
        seen.append(box)
        pad_x = max(6, int(cw * 0.04))
        pad_y = max(6, int(ch * 0.08))
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(w, x + cw + pad_x)
        y2 = min(h, y + ch + pad_y)
        crop = gray[y1:y2, x1:x2]
        if crop.shape[0] > crop.shape[1]:
            crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
        crops.append(crop)
        if len(crops) >= max_crops:
            break
    return crops


def ocr(image: np.ndarray) -> str:
    image = normalize_for_ocr(image) if len(image.shape) == 3 else image
    text = pytesseract.image_to_string(image, config="--psm 6")
    return text.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    image = read_image(args.image)
    crops = label_crops(image)
    texts = [ocr(image)]
    texts.extend(ocr(crop) for crop in crops)
    merged = "\n".join(text for text in texts if text)
    payload = {
        "label_crop_count": len(crops),
        "text": merged,
    }
    if args.json:
        print(json.dumps(payload))
    else:
        print(merged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
