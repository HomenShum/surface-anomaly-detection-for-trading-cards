from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

from ml.scripts.build_manifest import load_label_map, normalize_record, read_jsonl
from ml.scripts.convert_labels import load_yolo_classes, yolo_line


ROOT = Path(__file__).resolve().parents[2]
LABEL_MAP = ROOT / "ml/configs/label_map.yaml"
MANIFEST = ROOT / "ml/datasets/manifests/local_seed_manifest.jsonl"
VERIFICATION = ROOT / "ml/datasets/manifests/local_seed_verification.json"
YOLO_OUT = ROOT / "ml/datasets/yolo/card_condition_vault_seed"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_records() -> list[dict]:
    by_id, by_name = load_label_map(LABEL_MAP)
    return [normalize_record(record, by_id, by_name) for record in read_jsonl(MANIFEST)]


def test_seed_manifest_images_metadata_and_hashes_are_valid() -> None:
    records = normalized_records()
    verification = json.loads(VERIFICATION.read_text(encoding="utf-8"))
    verification_by_id = {record["image_id"]: record for record in verification["records"]}

    assert verification["external_public_datasets_used"] is False
    assert verification["license_status"] == "verified"
    assert len(records) == verification["record_count"] == 6

    for record in records:
        image_path = ROOT / record["image_path"]
        assert image_path.exists(), record["image_id"]
        with Image.open(image_path) as image:
            assert image.size == (record["width"], record["height"])
            assert image.format == "PNG"

        metadata = record["metadata"]
        assert metadata["external_source"] is False
        assert metadata["rights_basis"].startswith("Generated locally")
        assert record["license_status"] == "verified"

        verified = verification_by_id[record["image_id"]]
        assert verified["sha256"] == sha256(image_path)
        assert verified["width"] == record["width"]
        assert verified["height"] == record["height"]


def test_seed_manifest_classes_splits_and_bboxes_are_valid() -> None:
    records = normalized_records()
    by_id, _ = load_label_map(LABEL_MAP)
    observed_splits = {record["split"] for record in records}
    observed_classes = {
        int(annotation["class_id"])
        for record in records
        for annotation in record["annotations"]
    }

    assert observed_splits == {"train", "val", "test", "holdout"}
    assert observed_classes == set(by_id)

    for record in records:
        assert record["annotations"], record["image_id"]
        for annotation in record["annotations"]:
            x, y, width, height = annotation["bbox_xywh"]
            assert x >= 0
            assert y >= 0
            assert width > 0
            assert height > 0
            assert x + width <= record["width"]
            assert y + height <= record["height"]
            assert annotation["class_name"] == by_id[int(annotation["class_id"])]


def test_yolo_export_matches_manifest_annotations() -> None:
    records = [record for record in normalized_records() if record["split"] != "holdout"]
    yolo_classes = load_yolo_classes(LABEL_MAP)
    class_id_to_yolo_id = {class_id: yolo_id for yolo_id, (class_id, _) in enumerate(yolo_classes)}

    subprocess.run(
        [
            sys.executable,
            "ml/scripts/convert_labels.py",
            "--manifest",
            "ml/datasets/manifests/local_seed_manifest.jsonl",
            "--out",
            "ml/datasets/yolo/card_condition_vault_seed",
        ],
        cwd=ROOT,
        check=True,
    )

    dataset_yaml = (YOLO_OUT / "dataset.yaml").read_text(encoding="utf-8")
    assert "nc: 12" in dataset_yaml
    assert "glare_uncertain" not in dataset_yaml

    for record in records:
        expected_lines = [
            line
            for annotation in record["annotations"]
            if (line := yolo_line(annotation, record["width"], record["height"], class_id_to_yolo_id))
        ]
        label_path = YOLO_OUT / "labels" / record["split"] / f"{Path(record['image_path']).stem}.txt"
        assert label_path.exists(), record["image_id"]
        actual_lines = label_path.read_text(encoding="utf-8").splitlines()
        assert actual_lines == expected_lines
        for line in actual_lines:
            values = line.split()
            assert 0 <= int(values[0]) < len(yolo_classes)
            for value in values[1:]:
                assert 0.0 <= float(value) <= 1.0
