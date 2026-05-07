#!/usr/bin/env python
"""Verify annotated Card Condition Vault dataset manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml.scripts.build_manifest import load_label_map, normalize_record, read_jsonl


def verify_manifest(manifest: Path, label_map: Path) -> dict[str, Any]:
    by_id, by_name = load_label_map(label_map)
    records = [normalize_record(record, by_id, by_name) for record in read_jsonl(manifest)]
    if not records:
        raise ValueError("manifest has no records")

    errors: list[str] = []
    class_counts: dict[str, int] = {}
    split_counts: dict[str, int] = {}
    for record in records:
        image_path = Path(record["image_path"])
        if not image_path.is_file():
            errors.append(f"{record['image_id']}: image file missing: {image_path}")
        if record["license_status"] != "verified":
            errors.append(f"{record['image_id']}: license_status is not verified")
        split_counts[record["split"]] = split_counts.get(record["split"], 0) + 1
        if not record["annotations"]:
            errors.append(f"{record['image_id']}: no annotations")
        for annotation in record["annotations"]:
            class_name = str(annotation["class_name"])
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
            if annotation.get("reviewer") != "codex_self_review":
                errors.append(f"{record['image_id']}: {class_name} annotation missing codex_self_review")

    required_splits = {"train", "val", "test"}
    missing_splits = sorted(required_splits - set(split_counts))
    if missing_splits:
        errors.append(f"missing splits: {missing_splits}")
    if len(class_counts) < 6:
        errors.append("dataset must cover at least 6 classes")
    if errors:
        raise ValueError("; ".join(errors))

    return {
        "manifest": str(manifest),
        "records": len(records),
        "classes": class_counts,
        "splits": split_counts,
        "status": "verified",
        "judge": "codex_self_review",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/datasets/manifests/ccv_verified_seed_v1.jsonl"))
    parser.add_argument("--label-map", type=Path, default=Path("ml/configs/label_map.yaml"))
    parser.add_argument("--output", type=Path, default=Path("ml/datasets/manifests/ccv_verified_seed_v1.audit.json"))
    args = parser.parse_args()
    report = verify_manifest(args.manifest, args.label_map)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
