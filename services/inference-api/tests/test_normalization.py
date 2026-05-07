from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.pipelines.detector import CardConditionDetector, detect_card_condition
from app.pipelines.normalization import (
    DEFAULT_OUTPUT_SIZE,
    NormalizationResult,
    normalize_card_image,
    score_image_quality,
)


def test_normalize_card_image_returns_expected_size_and_quality() -> None:
    image = np.zeros((300, 220, 3), dtype=np.uint8)
    image[20:280, 20:200] = 180
    image[40:260, 40:180] = 80

    result = normalize_card_image(image, output_size=(160, 224))

    assert isinstance(result, NormalizationResult)
    assert result.image.shape == (224, 160, 3)
    assert 0.0 <= result.quality.score <= 1.0
    assert result.transform["method"] in {"perspective", "center_crop_resize"}


def test_normalize_card_image_accepts_grayscale_input() -> None:
    image = np.full((120, 80), 127, dtype=np.uint8)

    result = normalize_card_image(image, output_size=(64, 96), enhance=False)

    assert result.image.shape == (96, 64, 3)
    assert "low_contrast" in result.quality.warnings


def test_score_image_quality_flags_poor_images() -> None:
    dark_image = np.zeros((64, 64, 3), dtype=np.uint8)

    quality = score_image_quality(dark_image, edge_confidence=0.0)

    assert quality.score < 0.35
    assert "poor_brightness" in quality.warnings
    assert "possible_blur" in quality.warnings


def test_default_output_size_is_card_like() -> None:
    width, height = DEFAULT_OUTPUT_SIZE

    assert width < height
    assert round(width / height, 2) == 0.71


def test_detector_refuses_mock_when_all_weights_missing_by_default(tmp_path: Path, monkeypatch) -> None:
    image = np.full((224, 160, 3), 128, dtype=np.uint8)
    monkeypatch.setenv("CARD_CONDITION_SYNTHETIC_WEIGHTS", str(tmp_path / "missing-synthetic.pt"))
    monkeypatch.setenv("ALLOW_MOCK_DETECTOR", "false")
    detector = CardConditionDetector(tmp_path / "missing.pt")

    result = detector.predict(image)

    assert result.model_loaded is False
    assert result.fallback_reason == "weights_missing"
    assert result.detections == []


def test_detector_can_use_mock_only_when_explicitly_allowed(tmp_path: Path, monkeypatch) -> None:
    image = np.full((224, 160, 3), 128, dtype=np.uint8)
    monkeypatch.setenv("CARD_CONDITION_SYNTHETIC_WEIGHTS", str(tmp_path / "missing-synthetic.pt"))
    monkeypatch.setenv("ALLOW_MOCK_DETECTOR", "true")
    detector = CardConditionDetector(tmp_path / "missing.pt")

    result = detector.predict(image)

    assert result.model_loaded is False
    assert result.detections
    assert all(d.source == "mock" for d in result.detections)


def test_detect_card_condition_helper_uses_trained_synthetic_fallback() -> None:
    image = np.full((224, 160, 3), 128, dtype=np.uint8)

    result = detect_card_condition(image)

    assert result.model_loaded is True
    assert result.fallback_reason in {
        "weights_missing",
        "yolo_weights_missing_using_synthetic_trained_model",
        "ultralytics_unavailable_using_synthetic_trained_model",
    }
    assert result.detections
    assert result.detections[0].source == "synthetic_trained"
