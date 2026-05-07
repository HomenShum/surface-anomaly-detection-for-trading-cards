from pathlib import Path

from ml.scripts.verify_annotated_dataset import verify_manifest


def test_verified_seed_dataset_has_images_labels_and_splits() -> None:
    report = verify_manifest(
        Path("ml/datasets/manifests/ccv_verified_seed_v1.jsonl"),
        Path("ml/configs/label_map.yaml"),
    )

    assert report["status"] == "verified"
    assert report["records"] >= 12
    assert {"train", "val", "test"}.issubset(report["splits"])
    assert "card" in report["classes"]
    assert "scratch" in report["classes"]
