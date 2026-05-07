from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


DISCLAIMER = (
    "This is a timestamped condition evidence record and AI-assisted condition estimate. "
    "It is not an official grade or legal guarantee."
)

ALPHA_LABEL_MAP = [
    "card",
    "edge_wear",
    "corner_wear",
    "scratch",
    "crease",
    "tear_or_hole",
    "heavy_wear",
    "unknown_damage",
]

KNOWN_LIMITATIONS = [
    "Controlled-alpha model; do not present as official grading or legal proof.",
    "The served local checkpoint is trained in-repo and still needs licensed real-card fine-tuning before public accuracy claims.",
    "Foil, chrome, holo, sleeves, glare, low light, and motion blur can look like surface damage.",
    "Empty detections mean no defect exceeded the current threshold, not proof the card is clean.",
    "User corrections are useful training signals but are not ground truth until reviewed.",
]

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_YOLO_WEIGHTS = "services/inference-api/app/models/ding-detector-v0.pt"
DEFAULT_SYNTHETIC_WEIGHTS = "services/inference-api/app/models/synthetic_ding_cnn.pt"
LEGACY_SYNTHETIC_WEIGHTS = "services/inference-api/app/models/synthetic_ding_cnn.pt"
ROBOFLOW_MANIFEST = "ml/datasets/manifests/roboflow_alpha_manifest.jsonl"
VERIFIED_SEED_MANIFEST = "ml/datasets/manifests/ccv_verified_seed_v1.jsonl"


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def resolve_repo_path(value: str | Path | None) -> Path | None:
    if value is None or str(value).strip() == "":
        return None
    path = Path(value).expanduser()
    return path if path.is_absolute() else REPO_ROOT / path


def sha256_file(path: Path | None) -> str | None:
    if path is None or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _non_empty_manifest(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def current_manifest_path() -> Path | None:
    roboflow_path = resolve_repo_path(os.environ.get("CARD_CONDITION_DATASET_MANIFEST", ROBOFLOW_MANIFEST))
    if roboflow_path and _non_empty_manifest(roboflow_path):
        return roboflow_path

    verified_path = resolve_repo_path(VERIFIED_SEED_MANIFEST)
    return verified_path if verified_path and _non_empty_manifest(verified_path) else None


def current_weights_paths() -> tuple[Path | None, Path | None]:
    yolo_path = resolve_repo_path(os.environ.get("CARD_CONDITION_YOLO_WEIGHTS", DEFAULT_YOLO_WEIGHTS))
    synthetic_env = os.environ.get("CARD_CONDITION_SYNTHETIC_WEIGHTS")
    synthetic_was_explicit = synthetic_env is not None
    synthetic_env = synthetic_env or DEFAULT_SYNTHETIC_WEIGHTS
    synthetic_path = resolve_repo_path(synthetic_env)
    if not synthetic_was_explicit and (not synthetic_path or not synthetic_path.is_file()):
        synthetic_path = resolve_repo_path(LEGACY_SYNTHETIC_WEIGHTS)
    return yolo_path, synthetic_path


def metrics_for_weights(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    candidates = [path.with_suffix(".metrics.json")]
    if path.name == "ding-detector-v0.pt":
        candidates.append(path.with_name("synthetic_ding_cnn.metrics.json"))
    for candidate in candidates:
        data = _read_json(candidate)
        if data:
            return data
    return None


def current_model_metadata() -> dict[str, Any]:
    yolo_path, synthetic_path = current_weights_paths()
    yolo_loaded = bool(yolo_path and yolo_path.is_file())
    synthetic_loaded = bool(synthetic_path and synthetic_path.is_file())
    weights_path = yolo_path if yolo_loaded else synthetic_path
    weights_sha = sha256_file(weights_path)
    manifest_path = current_manifest_path()
    manifest_hash = sha256_file(manifest_path)
    metrics = metrics_for_weights(weights_path)
    model_version = os.environ.get("CARD_CONDITION_MODEL_VERSION", "ding-detector-v0")
    training_run_id = os.environ.get("CARD_CONDITION_TRAINING_RUN_ID")
    if not training_run_id:
        training_run_id = str(metrics.get("training_run_id")) if metrics and metrics.get("training_run_id") else None
    if not training_run_id:
        training_run_id = f"local-trained-{(weights_sha or 'missing')[:12]}"

    allow_mock = env_bool("ALLOW_MOCK_DETECTOR", default=False)
    require_real = env_bool("REQUIRE_REAL_MODEL", default=True)
    return {
        "ding_detector": model_version if (yolo_loaded or synthetic_loaded) else "model-unavailable",
        "normalizer": "opencv-v0.1",
        "mock": not (yolo_loaded or synthetic_loaded),
        "model_version": model_version,
        "weights_path": str(weights_path.relative_to(REPO_ROOT)) if weights_path and weights_path.exists() else None,
        "weights_sha256": weights_sha,
        "dataset_manifest": str(manifest_path.relative_to(REPO_ROOT)) if manifest_path else None,
        "dataset_manifest_hash": manifest_hash,
        "training_run_id": training_run_id,
        "label_map": ALPHA_LABEL_MAP,
        "known_limitations": KNOWN_LIMITATIONS,
        "yolo_weights_loaded": yolo_loaded,
        "synthetic_weights_loaded": synthetic_loaded,
        "fallback_available": allow_mock,
        "allow_mock_detector": allow_mock,
        "require_real_model": require_real,
        "disclaimer": DISCLAIMER,
    }
