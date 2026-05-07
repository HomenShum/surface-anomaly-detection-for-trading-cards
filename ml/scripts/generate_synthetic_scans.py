from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


QUALITY_VARIANTS = {
    "reject_blur": "blur",
    "reject_glare": "glare",
    "reject_angle": "rotation",
    "reject_card_edge_missing": "partial_crop",
    "reject_low_light": "shadow",
    "reject_sleeve_reflection": "sleeve_reflection",
}


def iter_images(path: Path) -> list[Path]:
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    if path.is_file():
        return [path]
    return sorted(p for p in path.rglob("*") if p.suffix.lower() in extensions)


def augment(image: np.ndarray, variant: str) -> np.ndarray:
    height, width = image.shape[:2]
    if variant == "blur":
        return cv2.GaussianBlur(image, (17, 17), 0)
    if variant == "glare":
        overlay = image.copy()
        cv2.ellipse(overlay, (int(width * 0.62), int(height * 0.30)), (int(width * 0.28), int(height * 0.09)), -18, 0, 360, (255, 255, 255), -1)
        return cv2.addWeighted(overlay, 0.55, image, 0.45, 0)
    if variant == "rotation":
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), 11, 0.92)
        return cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REFLECT)
    if variant == "partial_crop":
        cropped = image[:, int(width * 0.08) :]
        return cv2.resize(cropped, (width, height), interpolation=cv2.INTER_AREA)
    if variant == "shadow":
        gradient = np.linspace(0.42, 1.0, width, dtype=np.float32)[None, :, None]
        return np.clip(image.astype(np.float32) * gradient, 0, 255).astype(np.uint8)
    if variant == "sleeve_reflection":
        overlay = image.copy()
        pts = np.array([[width * 0.1, height * 0.05], [width * 0.35, height * 0.05], [width * 0.9, height * 0.9], [width * 0.72, height * 0.9]], dtype=np.int32)
        cv2.fillConvexPoly(overlay, pts, (230, 245, 255))
        return cv2.addWeighted(overlay, 0.28, image, 0.72, 0)
    return image


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic bad scan variants for quality-gate training.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", default=Path("ml/datasets/processed/synthetic_quality"), type=Path)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for image_path in iter_images(args.input):
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            continue
        accepted_path = args.output / "accepted" / image_path.name
        accepted_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(accepted_path), image)
        records.append({"image_path": str(accepted_path), "quality_label": "accepted", "source": str(image_path)})
        for label, variant in QUALITY_VARIANTS.items():
            out_path = args.output / label / image_path.name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out_path), augment(image, variant))
            records.append({"image_path": str(out_path), "quality_label": label, "source": str(image_path)})

    manifest = args.output / "quality_manifest.jsonl"
    with manifest.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    print(json.dumps({"records": len(records), "manifest": str(manifest)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
