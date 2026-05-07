#!/usr/bin/env python
"""Validate and normalize Card Condition Vault JSONL manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ALLOWED_SPLITS = {"train", "val", "test", "holdout"}
ALLOWED_LICENSE_STATUSES = {
    "verified",
    "restricted",
    "verify before commercial use",
}
REQUIRED_RECORD_FIELDS = {
    "image_id",
    "source_dataset",
    "split",
    "image_path",
    "width",
    "height",
    "license",
    "license_status",
    "annotations",
}


def load_label_map(path: Path) -> tuple[dict[int, str], dict[str, int]]:
    try:
        import yaml  # type: ignore
    except ImportError:
        return _load_label_map_without_yaml(path)

    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    classes = data.get("classes", [])
    by_id = {int(item["id"]): str(item["name"]) for item in classes}
    by_name = {name: class_id for class_id, name in by_id.items()}
    return by_id, by_name


def _load_label_map_without_yaml(path: Path) -> tuple[dict[int, str], dict[str, int]]:
    by_id: dict[int, str] = {}
    current_id: int | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("- id:"):
            current_id = int(line.split(":", 1)[1].strip())
        elif current_id is not None and line.startswith("name:"):
            name = line.split(":", 1)[1].strip()
            by_id[current_id] = name
            current_id = None
    return by_id, {name: class_id for class_id, name in by_id.items()}


def normalize_record(record: dict[str, Any], by_id: dict[int, str], by_name: dict[str, int]) -> dict[str, Any]:
    missing = sorted(REQUIRED_RECORD_FIELDS - set(record))
    if missing:
        raise ValueError(f"{record.get('image_id', '<unknown>')}: missing fields {missing}")

    split = record["split"]
    if split not in ALLOWED_SPLITS:
        raise ValueError(f"{record['image_id']}: invalid split {split!r}")

    license_status = record["license_status"]
    if license_status not in ALLOWED_LICENSE_STATUSES:
        raise ValueError(f"{record['image_id']}: invalid license_status {license_status!r}")

    width = int(record["width"])
    height = int(record["height"])
    if width <= 0 or height <= 0:
        raise ValueError(f"{record['image_id']}: width and height must be positive")
    record["width"] = width
    record["height"] = height

    normalized_annotations = []
    for index, annotation in enumerate(record["annotations"]):
        class_id = annotation.get("class_id")
        class_name = annotation.get("class_name")
        if class_id is None and class_name is not None:
            class_id = by_name.get(class_name)
        if class_id is None:
            raise ValueError(f"{record['image_id']}: annotation {index} missing class_id")
        class_id = int(class_id)
        expected_name = by_id.get(class_id)
        if expected_name is None:
            raise ValueError(f"{record['image_id']}: annotation {index} unknown class_id {class_id}")
        if class_name and class_name != expected_name:
            raise ValueError(
                f"{record['image_id']}: annotation {index} class_name {class_name!r} "
                f"does not match class_id {class_id} ({expected_name!r})"
            )

        bbox = annotation.get("bbox_xywh")
        if bbox is not None:
            if not isinstance(bbox, list) or len(bbox) != 4:
                raise ValueError(f"{record['image_id']}: annotation {index} bbox_xywh must be [x, y, w, h]")
            x, y, w, h = [float(value) for value in bbox]
            if w <= 0 or h <= 0:
                raise ValueError(f"{record['image_id']}: annotation {index} bbox width/height must be positive")
            if x < 0 or y < 0 or x + w > width or y + h > height:
                raise ValueError(f"{record['image_id']}: annotation {index} bbox exceeds image bounds")
            annotation["bbox_xywh"] = [x, y, w, h]

        annotation["class_id"] = class_id
        annotation["class_name"] = expected_name
        annotation.setdefault("confidence", 1.0)
        normalized_annotations.append(annotation)

    record["annotations"] = normalized_annotations
    record.setdefault("metadata", {})
    return record


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
            handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="ml/datasets/manifests/sample_manifest.jsonl", help="Input JSONL manifest.")
    parser.add_argument("--output", help="Optional normalized JSONL output path.")
    parser.add_argument("--label-map", default="ml/configs/label_map.yaml", help="DING ontology YAML.")
    args = parser.parse_args()

    by_id, by_name = load_label_map(Path(args.label_map))
    records = [normalize_record(record, by_id, by_name) for record in read_jsonl(Path(args.input))]

    if args.output:
        write_jsonl(Path(args.output), records)

    split_counts: dict[str, int] = {}
    source_counts: dict[str, int] = {}
    license_counts: dict[str, int] = {}
    for record in records:
        split_counts[record["split"]] = split_counts.get(record["split"], 0) + 1
        source_counts[record["source_dataset"]] = source_counts.get(record["source_dataset"], 0) + 1
        license_counts[record["license_status"]] = license_counts.get(record["license_status"], 0) + 1

    print(json.dumps({
        "records": len(records),
        "splits": split_counts,
        "sources": source_counts,
        "license_statuses": license_counts,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
