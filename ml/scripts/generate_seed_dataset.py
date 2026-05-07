#!/usr/bin/env python
"""Generate the verified first-party local seed dataset.

The images are simple deterministic raster cards authored for this repository.
They are not downloaded or derived from public card scans.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


WIDTH = 640
HEIGHT = 896
SOURCE_DATASET = "first_party_generated_seed_v1"
LICENSE = "project-generated"
LICENSE_STATUS = "verified"


CLASS_BY_ID = {
    0: "card",
    1: "corner",
    2: "edge_wear",
    3: "corner_wear",
    4: "scratch",
    5: "crease",
    6: "hole",
    7: "tear",
    8: "dent",
    9: "surface_contamination",
    10: "heavy_wear",
    11: "unknown_damage",
    12: "glare_uncertain",
}


SEED_RECORDS: list[dict[str, Any]] = [
    {
        "image_id": "ccv_seed_0001",
        "split": "train",
        "card_side": "front",
        "background": (35, 43, 58),
        "card_fill": (240, 235, 222),
        "accent": (65, 112, 166),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 3, "bbox_xywh": [90, 62, 72, 72], "source_label": "whitened rounded corner"},
            {"class_id": 4, "bbox_xywh": [252, 332, 178, 18], "source_label": "surface scratch"},
        ],
    },
    {
        "image_id": "ccv_seed_0002",
        "split": "train",
        "card_side": "back",
        "background": (42, 48, 50),
        "card_fill": (231, 238, 232),
        "accent": (126, 57, 50),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 2, "bbox_xywh": [520, 218, 30, 318], "source_label": "right edge whitening"},
            {"class_id": 8, "bbox_xywh": [300, 454, 76, 58], "source_label": "pressure dent"},
        ],
    },
    {
        "image_id": "ccv_seed_0003",
        "split": "train",
        "card_side": "front",
        "background": (36, 38, 46),
        "card_fill": (238, 228, 212),
        "accent": (47, 126, 94),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 5, "bbox_xywh": [184, 236, 272, 28], "source_label": "horizontal crease"},
            {"class_id": 9, "bbox_xywh": [408, 620, 76, 96], "source_label": "brown surface stain"},
        ],
    },
    {
        "image_id": "ccv_seed_0004",
        "split": "val",
        "card_side": "front",
        "background": (30, 43, 45),
        "card_fill": (235, 232, 225),
        "accent": (159, 91, 42),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 6, "bbox_xywh": [304, 400, 42, 42], "source_label": "puncture hole"},
            {"class_id": 7, "bbox_xywh": [462, 126, 70, 108], "source_label": "top-right tear"},
        ],
    },
    {
        "image_id": "ccv_seed_0005",
        "split": "test",
        "card_side": "back",
        "background": (48, 42, 58),
        "card_fill": (226, 232, 242),
        "accent": (93, 77, 153),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 10, "bbox_xywh": [118, 108, 394, 648], "source_label": "broad heavy wear"},
            {"class_id": 11, "bbox_xywh": [232, 692, 98, 74], "source_label": "unknown dark damage"},
        ],
    },
    {
        "image_id": "ccv_seed_0006",
        "split": "holdout",
        "card_side": "front",
        "background": (34, 46, 62),
        "card_fill": (236, 237, 232),
        "accent": (42, 119, 154),
        "annotations": [
            {"class_id": 0, "bbox_xywh": [86, 58, 468, 780], "source_label": "card body"},
            {"class_id": 1, "bbox_xywh": [482, 766, 64, 64], "source_label": "generic lower-right corner"},
            {"class_id": 12, "bbox_xywh": [180, 174, 296, 84], "source_label": "synthetic glare uncertainty"},
        ],
    },
]


def draw_base_card(record: dict[str, Any]) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), record["background"])
    draw = ImageDraw.Draw(image)
    card_box = (86, 58, 554, 838)
    draw.rounded_rectangle(card_box, radius=26, fill=record["card_fill"], outline=(24, 27, 31), width=4)
    draw.rectangle((126, 112, 514, 318), fill=record["accent"], outline=(30, 30, 30), width=2)
    draw.rectangle((132, 326, 508, 748), outline=(126, 126, 118), width=2)
    for y in (374, 426, 478, 530, 582, 634):
        draw.line((158, y, 482, y), fill=(180, 176, 166), width=3)
    return image


def draw_annotation(image: Image.Image, annotation: dict[str, Any]) -> None:
    draw = ImageDraw.Draw(image)
    x, y, w, h = annotation["bbox_xywh"]
    box = (x, y, x + w, y + h)
    class_id = annotation["class_id"]

    if class_id == 1:
        draw.arc(box, 0, 90, fill=(80, 80, 72), width=8)
    elif class_id == 2:
        for offset in range(0, int(h), 34):
            draw.rectangle((x, y + offset, x + w, min(y + offset + 18, y + h)), fill=(247, 247, 238))
    elif class_id == 3:
        draw.pieslice(box, 180, 270, fill=(248, 248, 238))
    elif class_id == 4:
        draw.line((x, y + h / 2, x + w, y + h / 2), fill=(70, 74, 78), width=5)
        draw.line((x + 16, y + 3, x + w - 20, y + h - 4), fill=(120, 124, 130), width=2)
    elif class_id == 5:
        draw.line((x, y + h / 2, x + w, y + h / 2), fill=(95, 88, 82), width=7)
        draw.line((x, y + h / 2 + 8, x + w, y + h / 2 + 8), fill=(205, 202, 194), width=3)
    elif class_id == 6:
        draw.ellipse(box, fill=(35, 30, 28), outline=(112, 105, 96), width=4)
    elif class_id == 7:
        points = [(x + w, y), (x + 16, y + 32), (x + w - 20, y + h), (x + w, y + h)]
        draw.polygon(points, fill=(52, 52, 48))
        draw.line((x + 10, y + 30, x + w - 8, y + h - 8), fill=(92, 88, 82), width=5)
    elif class_id == 8:
        draw.ellipse(box, fill=(190, 186, 178), outline=(120, 116, 108), width=3)
        draw.ellipse((x + 14, y + 12, x + w - 14, y + h - 10), outline=(98, 96, 90), width=2)
    elif class_id == 9:
        draw.ellipse(box, fill=(120, 79, 45), outline=(91, 60, 36), width=3)
        draw.ellipse((x + 18, y + 20, x + w - 14, y + h - 22), fill=(144, 96, 54))
    elif class_id == 10:
        draw.rectangle(box, outline=(96, 87, 77), width=8)
        for offset in range(0, int(h), 72):
            draw.line((x + 18, y + offset, x + w - 18, y + offset + 44), fill=(115, 107, 96), width=4)
    elif class_id == 11:
        draw.rectangle(box, fill=(70, 58, 54), outline=(40, 36, 34), width=3)
    elif class_id == 12:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.ellipse(box, fill=(255, 255, 255, 130), outline=(226, 240, 255, 180), width=5)
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_manifest_record(record: dict[str, Any], image_path: Path) -> dict[str, Any]:
    annotations = []
    for annotation in record["annotations"]:
        class_id = int(annotation["class_id"])
        annotations.append(
            {
                "class_id": class_id,
                "class_name": CLASS_BY_ID[class_id],
                "bbox_xywh": annotation["bbox_xywh"],
                "confidence": 1.0,
                "source_label": annotation["source_label"],
                "annotator": "dataset_agent",
                "annotation_type": "hand-authored",
            }
        )

    return {
        "image_id": record["image_id"],
        "source_dataset": SOURCE_DATASET,
        "split": record["split"],
        "image_path": image_path.as_posix(),
        "width": WIDTH,
        "height": HEIGHT,
        "license": LICENSE,
        "license_status": LICENSE_STATUS,
        "annotations": annotations,
        "metadata": {
            "card_side": record["card_side"],
            "generation_method": "first-party deterministic PIL render",
            "generator_script": "ml/scripts/generate_seed_dataset.py",
            "external_source": False,
            "rights_basis": "Generated locally for Card Condition Vault; no public dataset assets used.",
        },
    }


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def generate_dataset(root: Path, manifest_path: Path, verification_path: Path) -> None:
    image_dir = root / "seed" / "first_party_generated_v1" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    manifest_records = []
    verification_records = []
    for seed_record in SEED_RECORDS:
        image = draw_base_card(seed_record)
        for annotation in seed_record["annotations"]:
            if annotation["class_id"] != 0:
                draw_annotation(image, annotation)
        image_path = image_dir / f"{seed_record['image_id']}.png"
        image.save(image_path)

        manifest_record = build_manifest_record(seed_record, image_path)
        manifest_records.append(manifest_record)
        verification_records.append(
            {
                "image_id": seed_record["image_id"],
                "image_path": image_path.as_posix(),
                "sha256": sha256(image_path),
                "width": WIDTH,
                "height": HEIGHT,
                "source_dataset": SOURCE_DATASET,
                "license": LICENSE,
                "license_status": LICENSE_STATUS,
                "annotation_authoring": "hand-authored bounding boxes over deterministic first-party renders",
                "external_source": False,
            }
        )

    write_jsonl(manifest_path, manifest_records)
    verification_path.parent.mkdir(parents=True, exist_ok=True)
    verification_path.write_text(
        json.dumps(
            {
                "dataset": SOURCE_DATASET,
                "record_count": len(manifest_records),
                "image_count": len(verification_records),
                "external_public_datasets_used": False,
                "license_status": LICENSE_STATUS,
                "records": verification_records,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets-root", default=Path("ml/datasets"), type=Path)
    parser.add_argument(
        "--manifest",
        default=Path("ml/datasets/manifests/local_seed_manifest.jsonl"),
        type=Path,
    )
    parser.add_argument(
        "--verification",
        default=Path("ml/datasets/manifests/local_seed_verification.json"),
        type=Path,
    )
    args = parser.parse_args()

    generate_dataset(args.datasets_root, args.manifest, args.verification)
    print(
        json.dumps(
            {
                "manifest": str(args.manifest),
                "verification": str(args.verification),
                "records": len(SEED_RECORDS),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
