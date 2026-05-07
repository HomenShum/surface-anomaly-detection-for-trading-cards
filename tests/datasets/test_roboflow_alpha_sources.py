from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "ml" / "configs" / "roboflow_sources.yaml"
LABEL_MAP = ROOT / "ml" / "configs" / "alpha_label_map.yaml"


def test_roboflow_sources_are_verified_and_mapped() -> None:
    sources = yaml.safe_load(SOURCES.read_text(encoding="utf-8"))["sources"]
    expected_ids = {
        "roboflow_card_grader_v5",
        "roboflow_pokemon_surface_damage_v2",
        "roboflow_scratch_poke_v2",
        "roboflow_pokefrontbackdamage_v1",
        "roboflow_card_condition_29wwd_v1",
        "roboflow_pokemon_card_detection_7aaz7_v1",
        "roboflow_pokemon_cards_segmentation_v2",
        "roboflow_pokemon_card_detection_3_v1",
    }
    assert {source["id"] for source in sources} == expected_ids
    for source in sources:
        assert source["license"] == "CC BY 4.0"
        assert source["license_status"] == "verified"
        assert isinstance(source["version"], int)
        assert source["version"] >= 1
        assert source["label_map"]
        assert source["dataset_url"].startswith("https://universe.roboflow.com/")


def test_downloaded_roboflow_alpha_audit_distinguishes_missing_sources() -> None:
    audit_path = ROOT / "ml/datasets/manifests/roboflow_alpha_manifest.audit.json"
    if not audit_path.exists():
        return
    audit = yaml.safe_load(audit_path.read_text(encoding="utf-8"))
    assert "downloaded_sources" in audit or "sources" in audit
    assert set(audit.get("downloaded_sources", audit.get("sources", {}).keys())).issubset(
        {source["id"] for source in yaml.safe_load(SOURCES.read_text(encoding="utf-8"))["sources"]}
    )


def test_alpha_label_map_is_compact_launch_ontology() -> None:
    label_map = yaml.safe_load(LABEL_MAP.read_text(encoding="utf-8"))
    classes = [entry["name"] for entry in label_map["classes"]]
    assert classes == [
        "card",
        "edge_wear",
        "corner_wear",
        "scratch",
        "crease",
        "tear_or_hole",
        "heavy_wear",
        "unknown_damage",
    ]
