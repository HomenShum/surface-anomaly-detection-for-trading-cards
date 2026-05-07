from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from typing import Any

import numpy as np

from app.models import resolve_model_artifact
from app.pipelines.model_metadata import env_bool, resolve_repo_path

try:  # pragma: no cover - optional runtime dependency
    from ultralytics import YOLO
except Exception:  # pragma: no cover
    YOLO = None  # type: ignore[assignment]


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]
    source: str


@dataclass(frozen=True)
class DetectorResult:
    detections: list[Detection]
    model_loaded: bool
    fallback_reason: str | None = None
    metadata: dict[str, Any] | None = None


class CardConditionDetector:
    def __init__(
        self,
        weights_path: str | Path | None = None,
        *,
        confidence_threshold: float = 0.25,
        labels: list[str] | None = None,
    ) -> None:
        self.artifact = resolve_model_artifact(weights_path, kind="yolo")
        self.confidence_threshold = confidence_threshold
        self.labels = labels or ["corner_wear", "edge_wear", "scratch", "crease", "unknown_damage"]
        self._model = None
        self._synthetic_path: Path | None = None
        self._fallback_reason: str | None = None
        self._allow_mock = env_bool("ALLOW_MOCK_DETECTOR", default=False)

        if not self.artifact.exists:
            synthetic_path = _resolve_synthetic_path()
            if synthetic_path.is_file():
                self._synthetic_path = synthetic_path
                self._fallback_reason = "yolo_weights_missing_using_synthetic_trained_model"
            else:
                self._fallback_reason = "weights_missing"
        elif YOLO is None:
            synthetic_path = _resolve_synthetic_path()
            if synthetic_path.is_file():
                self._synthetic_path = synthetic_path
                self._fallback_reason = "ultralytics_unavailable_using_synthetic_trained_model"
            else:
                self._fallback_reason = "ultralytics_unavailable"
        else:
            self._model = YOLO(str(self.artifact.path))

    @property
    def model_loaded(self) -> bool:
        return self._model is not None or self._synthetic_path is not None

    def predict(self, image: np.ndarray) -> DetectorResult:
        if image is None or image.size == 0:
            raise ValueError("predict requires a non-empty image")

        if self._model is None:
            synthetic = self._synthetic_predict(image)
            if synthetic is not None:
                return synthetic
            if self._allow_mock:
                return self._mock_predict(image)
            return DetectorResult(
                detections=[],
                model_loaded=False,
                fallback_reason=self._fallback_reason or "model_unavailable_mock_disabled",
                metadata={
                    "weights_path": str(self.artifact.path) if self.artifact.path else None,
                    "image_shape": list(image.shape),
                    "allow_mock_detector": False,
                },
            )

        raw_results = self._model.predict(image, conf=self.confidence_threshold, verbose=False)
        detections: list[Detection] = []
        for result in raw_results:
            names = getattr(result, "names", {})
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            for box in boxes:
                confidence = float(box.conf[0])
                if confidence < self.confidence_threshold:
                    continue
                class_id = int(box.cls[0])
                label = str(names.get(class_id, class_id))
                xyxy = tuple(float(v) for v in box.xyxy[0].tolist())
                detections.append(Detection(label=label, confidence=confidence, bbox=xyxy, source="model"))

        return DetectorResult(
            detections=detections,
            model_loaded=True,
            metadata={"weights_path": str(self.artifact.path) if self.artifact.path else None},
        )

    def _synthetic_predict(self, image: np.ndarray) -> DetectorResult | None:
        if self._synthetic_path is None:
            return None
        try:
            from app.models.synthetic_ding import predict_with_checkpoint

            prediction = predict_with_checkpoint(image, str(self._synthetic_path))
        except Exception as exc:
            self._fallback_reason = f"synthetic_model_failed:{exc.__class__.__name__}"
            return None
        return DetectorResult(
            detections=[
                Detection(
                    prediction.label,
                    max(float(self.confidence_threshold), min(0.99, prediction.confidence)),
                    prediction.bbox_xyxy,
                    "synthetic_trained",
                )
            ],
            model_loaded=True,
            fallback_reason=self._fallback_reason,
            metadata={
                "synthetic_weights_path": str(self._synthetic_path),
                "image_shape": list(image.shape),
                "synthetic_metrics": _read_synthetic_metrics(self._synthetic_path),
            },
        )

    def _mock_predict(self, image: np.ndarray) -> DetectorResult:
        height, width = image.shape[:2]
        min_side = float(min(width, height))
        pad = max(4.0, min_side * 0.025)
        corner_size = max(12.0, min_side * 0.12)

        detections = [
            Detection("corner_wear", 0.15, (pad, pad, corner_size, corner_size), "mock"),
            Detection(
                "edge_wear",
                0.12,
                (pad, height - corner_size, width - pad, height - pad),
                "mock",
            ),
        ]
        return DetectorResult(
            detections=detections,
            model_loaded=False,
            fallback_reason=self._fallback_reason or "model_unavailable",
            metadata={
                "weights_path": str(self.artifact.path) if self.artifact.path else None,
                "image_shape": list(image.shape),
            },
        )


def detect_card_condition(
    image: np.ndarray,
    weights_path: str | Path | None = None,
    *,
    confidence_threshold: float = 0.25,
) -> DetectorResult:
    detector = CardConditionDetector(weights_path, confidence_threshold=confidence_threshold)
    return detector.predict(image)


def _resolve_synthetic_path() -> Path:
    configured_env = os.environ.get("CARD_CONDITION_SYNTHETIC_WEIGHTS")
    configured = resolve_repo_path(configured_env or "services/inference-api/app/models/synthetic_ding_cnn.pt")
    if configured_env is not None:
        return configured or Path(configured_env)
    if configured and configured.is_file():
        return configured
    legacy = resolve_repo_path("services/inference-api/app/models/synthetic_ding_cnn.pt")
    return legacy or Path("services/inference-api/app/models/synthetic_ding_cnn.pt")


def _read_synthetic_metrics(weights_path: Path) -> dict[str, Any] | None:
    metrics_path = weights_path.with_suffix(".metrics.json")
    if not metrics_path.is_file():
        return None
    try:
        return json.loads(metrics_path.read_text(encoding="utf-8"))
    except Exception:
        return None
