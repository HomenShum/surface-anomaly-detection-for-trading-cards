from __future__ import annotations

from dataclasses import dataclass

import numpy as np


LABELS = [
    "edge_wear",
    "corner_wear",
    "scratch",
    "crease",
    "dent",
    "hole",
    "tear",
    "surface_contamination",
    "heavy_wear",
]
INPUT_SIZE = (128, 192)
DEFAULT_ARCHITECTURE = "synthetic-ding-cnn-v0.2-large"


@dataclass(frozen=True)
class SyntheticPrediction:
    label: str
    confidence: float
    bbox_xyxy: tuple[float, float, float, float]


def build_model(architecture: str = DEFAULT_ARCHITECTURE, num_labels: int | None = None):
    import torch
    from torch import nn

    output_labels = num_labels or len(LABELS)

    class SyntheticDingCNNV1(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(3, 16, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(16, 32, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1),
                nn.ReLU(),
                nn.AdaptiveAvgPool2d((6, 4)),
            )
            self.head = nn.Sequential(nn.Flatten(), nn.Linear(64 * 6 * 4, 96), nn.ReLU())
            self.classifier = nn.Linear(96, output_labels)
            self.box = nn.Linear(96, 4)

        def forward(self, x):  # type: ignore[no-untyped-def]
            hidden = self.head(self.features(x))
            return self.classifier(hidden), self.box(hidden).sigmoid()

    class SyntheticDingCNNV2(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(3, 24, 3, padding=1),
                nn.BatchNorm2d(24),
                nn.ReLU(),
                nn.Conv2d(24, 24, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(24, 48, 3, padding=1),
                nn.BatchNorm2d(48),
                nn.ReLU(),
                nn.Conv2d(48, 48, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(48, 96, 3, padding=1),
                nn.BatchNorm2d(96),
                nn.ReLU(),
                nn.Conv2d(96, 128, 3, padding=1),
                nn.ReLU(),
                nn.AdaptiveAvgPool2d((7, 5)),
            )
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Linear(128 * 7 * 5, 256),
                nn.ReLU(),
                nn.Dropout(0.10),
                nn.Linear(256, 160),
                nn.ReLU(),
            )
            self.classifier = nn.Linear(160, output_labels)
            self.box = nn.Linear(160, 4)

        def forward(self, x):  # type: ignore[no-untyped-def]
            hidden = self.head(self.features(x))
            return self.classifier(hidden), self.box(hidden).sigmoid()

    class SyntheticDingCNNV3(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(3, 32, 3, padding=1),
                nn.BatchNorm2d(32),
                nn.ReLU(),
                nn.Conv2d(32, 32, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1),
                nn.BatchNorm2d(64),
                nn.ReLU(),
                nn.Conv2d(64, 64, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(64, 128, 3, padding=1),
                nn.BatchNorm2d(128),
                nn.ReLU(),
                nn.Conv2d(128, 160, 3, padding=1),
                nn.BatchNorm2d(160),
                nn.ReLU(),
                nn.Conv2d(160, 192, 3, padding=1),
                nn.ReLU(),
                nn.AdaptiveAvgPool2d((8, 6)),
            )
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Linear(192 * 8 * 6, 512),
                nn.ReLU(),
                nn.Dropout(0.12),
                nn.Linear(512, 256),
                nn.ReLU(),
                nn.Dropout(0.08),
                nn.Linear(256, 192),
                nn.ReLU(),
            )
            self.classifier = nn.Linear(192, output_labels)
            self.box = nn.Linear(192, 4)

        def forward(self, x):  # type: ignore[no-untyped-def]
            hidden = self.head(self.features(x))
            return self.classifier(hidden), self.box(hidden).sigmoid()

    if architecture in {"synthetic-ding-cnn-v0.1", "v0.1"}:
        return SyntheticDingCNNV1()
    if architecture in {"synthetic-ding-cnn-v0.2", "synthetic-ding-cnn-v0.2-large", "v0.2", "large"}:
        return SyntheticDingCNNV2()
    if architecture in {"synthetic-ding-cnn-v0.3-xlarge", "v0.3", "xlarge"}:
        return SyntheticDingCNNV3()
    raise ValueError(f"Unsupported synthetic DING architecture: {architecture}")


def preprocess_bgr(image: np.ndarray):
    import torch

    width, height = INPUT_SIZE
    try:
        import cv2

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
    except Exception:
        rgb = image[:, :, ::-1] if image.ndim == 3 and image.shape[2] >= 3 else image
        y_idx = np.linspace(0, rgb.shape[0] - 1, height).astype(int)
        x_idx = np.linspace(0, rgb.shape[1] - 1, width).astype(int)
        resized = rgb[y_idx][:, x_idx]
    tensor = torch.from_numpy(resized).float().permute(2, 0, 1).unsqueeze(0) / 255.0
    return tensor


def predict_with_checkpoint(image: np.ndarray, checkpoint_path: str) -> SyntheticPrediction:
    import torch

    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    labels = checkpoint.get("labels", LABELS)
    architecture = checkpoint.get("architecture", checkpoint.get("model_version", "synthetic-ding-cnn-v0.1"))
    model = build_model(str(architecture), num_labels=len(labels))
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    with torch.no_grad():
        logits, bbox = model(preprocess_bgr(image))
        probabilities = torch.softmax(logits[0], dim=0)
        confidence, class_id = torch.max(probabilities, dim=0)
        x1, y1, x2, y2 = bbox[0].tolist()

    height, width = image.shape[:2]
    left = min(x1, x2) * width
    right = max(x1, x2) * width
    top = min(y1, y2) * height
    bottom = max(y1, y2) * height
    if right - left < width * 0.03:
        right = min(width - 1.0, left + width * 0.08)
    if bottom - top < height * 0.03:
        bottom = min(height - 1.0, top + height * 0.08)
    return SyntheticPrediction(
        label=str(labels[int(class_id)]),
        confidence=float(confidence),
        bbox_xyxy=(float(left), float(top), float(right), float(bottom)),
    )
