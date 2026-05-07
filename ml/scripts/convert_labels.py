#!/usr/bin/env python
"""Convert Card Condition Vault manifests to a YOLO detection dataset."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

try:
    from .build_manifest import load_label_map, normalize_record, read_jsonl
except ImportError:
    from build_manifest import load_label_map, normalize_record, read_jsonl


def load_yolo_classes(label_map_path: Path) -> list[tuple[int, str]]:
    try:
        import yaml  # type: ignore
    except ImportError:
        by_id, _ = load_label_map(label_map_path)
        non_yolo_names = {"clean_card", "glare_uncertain"}
        return [(class_id, name) for class_id, name in sorted(by_id.items()) if name not in non_yolo_names]

    data = yaml.safe_load(label_map_path.read_text(encoding="utf-8"))
    classes = []
    for item in data.get("classes", []):
        if bool(item.get("yolo", True)):
            classes.append((int(item["id"]), str(item["name"])))
    return sorted(classes)


def yolo_line(annotation: dict[str, Any], width: int, height: int, class_id_to_yolo_id: dict[int, int]) -> str | None:
    class_id = int(annotation["class_id"])
    if class_id not in class_id_to_yolo_id:
        return None

    bbox = annotation.get("bbox_xywh")
    if bbox is None:
        return None

    x, y, w, h = [float(value) for value in bbox]
    cx = (x + w / 2.0) / width
    cy = (y + h / 2.0) / height
    nw = w / width
    nh = h / height
    return f"{class_id_to_yolo_id[class_id]} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


def write_dataset_yaml(out_dir: Path, yolo_classes: list[tuple[int, str]]) -> None:
    names = [name for _, name in yolo_classes]
    yaml_text = [
        f"path: {out_dir.resolve().as_posix()}",
        "train: images/train",
        "val: images/val",
        "test: images/test",
        f"nc: {len(names)}",
        "names:",
    ]
    yaml_text.extend(f"  {index}: {name}" for index, name in enumerate(names))
    (out_dir / "dataset.yaml").write_text("\n".join(yaml_text) + "\n", encoding="utf-8")


def export_yolo(records: list[dict[str, Any]], out_dir: Path, label_map_path: Path, copy_images: bool) -> None:
    yolo_classes = load_yolo_classes(label_map_path)
    class_id_to_yolo_id = {class_id: yolo_id for yolo_id, (class_id, _) in enumerate(yolo_classes)}

    for split in ("train", "val", "test"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    for record in records:
        split = record["split"]
        if split == "holdout":
            continue
        if split not in {"train", "val", "test"}:
            raise ValueError(f"{record['image_id']}: YOLO export does not support split {split!r}")

        image_path = Path(record["image_path"])
        output_stem = _safe_stem(str(record.get("image_id") or image_path.stem))
        image_name = f"{output_stem}{image_path.suffix.lower()}"
        label_path = out_dir / "labels" / split / f"{output_stem}.txt"
        lines = [
            line
            for annotation in record["annotations"]
            if (line := yolo_line(annotation, int(record["width"]), int(record["height"]), class_id_to_yolo_id))
        ]
        label_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

        if copy_images:
            if not image_path.exists():
                raise FileNotFoundError(f"Missing image for {record['image_id']}: {image_path}")
            shutil.copy2(image_path, out_dir / "images" / split / image_name)

    write_dataset_yaml(out_dir, yolo_classes)


def _safe_stem(value: str) -> str:
    safe = []
    for char in value:
        if char.isalnum() or char in {"-", "_"}:
            safe.append(char)
        else:
            safe.append("_")
    return "".join(safe).strip("_") or "image"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="ml/datasets/manifests/sample_manifest.jsonl", help="Input JSONL manifest.")
    parser.add_argument("--out", default="ml/datasets/yolo/card_condition_vault", help="YOLO output directory.")
    parser.add_argument("--label-map", default="ml/configs/label_map.yaml", help="DING ontology YAML.")
    parser.add_argument("--copy-images", action="store_true", help="Copy source images into YOLO split folders.")
    args = parser.parse_args()

    label_map_path = Path(args.label_map)
    by_id, by_name = load_label_map(label_map_path)
    records = [normalize_record(record, by_id, by_name) for record in read_jsonl(Path(args.manifest))]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    export_yolo(records, out_dir, label_map_path, args.copy_images)

    print(json.dumps({"records": len(records), "out": str(out_dir)}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
