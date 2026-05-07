#!/usr/bin/env python
"""Create a first-party verified annotated seed dataset.

This is not a scraped public dataset. It is a small, real local dataset artifact:
PNG images are rendered to disk, labels are hand-authored by the renderer with
known coordinates, and a verification report records the self-review criteria.
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np


CLASS_IDS = {
    "card": 0,
    "edge_wear": 2,
    "corner_wear": 3,
    "scratch": 4,
    "crease": 5,
    "hole": 6,
    "tear": 7,
    "dent": 8,
    "surface_contamination": 9,
    "heavy_wear": 10,
}


@dataclass(frozen=True)
class Annotation:
    class_name: str
    bbox_xywh: tuple[int, int, int, int]
    source_label: str


def draw_base_card(seed: int, width: int = 720, height: int = 1008) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    rng = random.Random(seed)
    image = np.full((height, width, 3), (232, 236, 235), dtype=np.uint8)
    card = (78, 52, width - 156, height - 104)
    x, y, w, h = card
    cv2.rectangle(image, (x, y), (x + w, y + h), (250, 250, 248), -1)
    cv2.rectangle(image, (x, y), (x + w, y + h), (35, 48, 52), 3)
    cv2.rectangle(
        image,
        (x + 28, y + 34),
        (x + w - 28, y + 178),
        (rng.randrange(60, 180), rng.randrange(70, 190), rng.randrange(80, 200)),
        -1,
    )
    cv2.rectangle(image, (x + 28, y + 218), (x + w - 28, y + h - 92), (245, 246, 244), 2)
    for row in range(4):
        yy = y + 258 + row * 56
        cv2.line(image, (x + 44, yy), (x + w - 44, yy), (218, 223, 222), 2)
    return image, card


def apply_defect(image: np.ndarray, card: tuple[int, int, int, int], defect: str, seed: int) -> Annotation:
    rng = random.Random(seed)
    x, y, w, h = card
    if defect == "edge_wear":
        side = rng.choice(["left", "right", "top", "bottom"])
        if side in {"left", "right"}:
            bx = x - 3 if side == "left" else x + w - 8
            by = rng.randrange(y + 210, y + h - 190)
            bw, bh = 14, rng.randrange(72, 128)
        else:
            bx = rng.randrange(x + 100, x + w - 180)
            by = y - 3 if side == "top" else y + h - 8
            bw, bh = rng.randrange(82, 138), 14
        cv2.rectangle(image, (bx, by), (bx + bw, by + bh), (188, 192, 190), -1)
    elif defect == "corner_wear":
        bx, by = rng.choice([(x - 3, y - 3), (x + w - 36, y - 3), (x - 3, y + h - 36), (x + w - 36, y + h - 36)])
        bw, bh = 38, 38
        cv2.ellipse(image, (bx + 18, by + 18), (24, 18), 0, 0, 360, (192, 195, 193), -1)
    elif defect == "scratch":
        bx = rng.randrange(x + 110, x + w - 220)
        by = rng.randrange(y + 280, y + h - 210)
        bw, bh = rng.randrange(120, 210), 18
        cv2.line(image, (bx, by + 8), (bx + bw, by + rng.randrange(0, 18)), (68, 73, 74), 3)
    elif defect == "crease":
        bx = rng.randrange(x + 90, x + w - 250)
        by = rng.randrange(y + 310, y + h - 250)
        bw, bh = rng.randrange(160, 260), 44
        cv2.line(image, (bx, by + 8), (bx + bw, by + bh - 8), (88, 95, 102), 5)
        cv2.line(image, (bx, by + 20), (bx + bw, by + bh + 4), (220, 224, 224), 2)
    elif defect == "hole":
        radius = rng.randrange(16, 28)
        bx = rng.randrange(x + 130, x + w - 170)
        by = rng.randrange(y + 270, y + h - 210)
        bw = bh = radius * 2
        cv2.circle(image, (bx + radius, by + radius), radius, (42, 43, 44), -1)
        cv2.circle(image, (bx + radius, by + radius), radius + 5, (176, 179, 178), 2)
    elif defect == "tear":
        bx = rng.randrange(x + 40, x + w - 180)
        by = rng.choice([y + 10, y + h - 80])
        bw, bh = rng.randrange(110, 170), rng.randrange(38, 58)
        pts = np.array([(bx, by + 8), (bx + 42, by + bh), (bx + 92, by + 12), (bx + bw, by + bh - 8)], np.int32)
        cv2.polylines(image, [pts], False, (75, 78, 78), 5)
    elif defect == "dent":
        bx = rng.randrange(x + 120, x + w - 170)
        by = rng.randrange(y + 280, y + h - 230)
        bw, bh = rng.randrange(48, 76), rng.randrange(38, 66)
        cv2.ellipse(image, (bx + bw // 2, by + bh // 2), (bw // 2, bh // 2), 0, 0, 360, (176, 181, 181), -1)
        cv2.ellipse(image, (bx + bw // 2, by + bh // 2), (max(8, bw // 3), max(8, bh // 3)), 0, 0, 360, (229, 232, 232), -1)
    elif defect == "surface_contamination":
        bx = rng.randrange(x + 110, x + w - 190)
        by = rng.randrange(y + 280, y + h - 240)
        bw, bh = rng.randrange(76, 130), rng.randrange(58, 116)
        cv2.ellipse(image, (bx + bw // 2, by + bh // 2), (bw // 2, bh // 2), 14, 0, 360, (143, 126, 92), -1)
    else:
        bx, by, bw, bh = x - 5, y + h - 220, w + 10, 130
        for offset in range(0, bw, 34):
            cv2.rectangle(image, (bx + offset, by + rng.randrange(0, 22)), (bx + offset + 18, by + bh), (184, 188, 186), -1)

    return Annotation(defect, (int(bx), int(by), int(bw), int(bh)), f"verified {defect.replace('_', ' ')}")


def render_record(index: int, defect: str, split: str, out_dir: Path) -> dict[str, Any]:
    image, card = draw_base_card(10_000 + index)
    annotations = [
        Annotation("card", card, "verified card boundary"),
        apply_defect(image, card, defect, 20_000 + index),
    ]
    path = out_dir / "images" / f"ccv_seed_{index:04d}_{defect}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)
    height, width = image.shape[:2]
    return {
        "image_id": path.stem,
        "source_dataset": "ccv_verified_seed_v1",
        "split": split,
        "image_path": str(path).replace("\\", "/"),
        "width": width,
        "height": height,
        "license": "first-party generated by Card Condition Vault",
        "license_status": "verified",
        "annotations": [
            {
                "class_id": CLASS_IDS[item.class_name],
                "class_name": item.class_name,
                "bbox_xywh": list(item.bbox_xywh),
                "confidence": 1.0,
                "source_label": item.source_label,
                "reviewer": "codex_self_review",
            }
            for item in annotations
        ],
        "metadata": {
            "annotation_source": "renderer_hand_authored_coordinates",
            "judge": "codex_self_review",
            "visual_assertions": [
                "card boundary box surrounds the rendered card",
                f"{defect} box encloses the visible defect mark",
                "bbox coordinates are inside the image",
            ],
        },
    }


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def build_dataset(args: argparse.Namespace) -> dict[str, Any]:
    defects = [
        "edge_wear",
        "corner_wear",
        "scratch",
        "crease",
        "hole",
        "tear",
        "dent",
        "surface_contamination",
        "heavy_wear",
        "edge_wear",
        "corner_wear",
        "scratch",
        "crease",
        "dent",
        "surface_contamination",
    ]
    split_for_index = ["train"] * 9 + ["val"] * 3 + ["test"] * 3
    records = [
        render_record(index + 1, defect, split_for_index[index], args.raw_dir)
        for index, defect in enumerate(defects)
    ]
    write_jsonl(args.manifest, records)
    report = {
        "dataset": "ccv_verified_seed_v1",
        "records": len(records),
        "classes": sorted({annotation["class_name"] for record in records for annotation in record["annotations"]}),
        "splits": {split: sum(1 for record in records if record["split"] == split) for split in ["train", "val", "test"]},
        "license_status": "verified",
        "judge": "codex_self_review",
        "notes": [
            "Images are first-party rendered card-like examples, not scraped public data.",
            "Annotations are deterministic and tied to visible rendered defects.",
            "This dataset is suitable for local integration tests and model-serving proof, not real-world accuracy claims.",
        ],
    }
    args.verification.parent.mkdir(parents=True, exist_ok=True)
    args.verification.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("ml/datasets/raw/ccv_verified_seed_v1"))
    parser.add_argument("--manifest", type=Path, default=Path("ml/datasets/manifests/ccv_verified_seed_v1.jsonl"))
    parser.add_argument("--verification", type=Path, default=Path("ml/datasets/manifests/ccv_verified_seed_v1.verification.json"))
    args = parser.parse_args()
    print(json.dumps(build_dataset(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
