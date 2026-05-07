from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
import sys
from typing import Any

import cv2
import numpy as np
import torch
from torch import nn
from torch.utils.data import ConcatDataset, DataLoader, Dataset

ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = ROOT / "services" / "inference-api"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.models.synthetic_ding import DEFAULT_ARCHITECTURE, INPUT_SIZE, LABELS, build_model


ANNOTATION_LABEL_MAP = {
    "edge_wear": "edge_wear",
    "corner_wear": "corner_wear",
    "scratch": "scratch",
    "crease": "crease",
    "dent": "dent",
    "hole": "hole",
    "tear": "tear",
    "surface_contamination": "surface_contamination",
    "heavy_wear": "heavy_wear",
}


class SyntheticDingDataset(Dataset):
    def __init__(self, size: int, seed: int) -> None:
        self.size = size
        self.seed = seed
        self.samples = [render_sample(random.Random(seed + index)) for index in range(size)]

    def __len__(self) -> int:
        return self.size

    def __getitem__(self, index: int):
        image, label, bbox = self.samples[index]
        tensor = torch.from_numpy(image).float().permute(2, 0, 1) / 255.0
        return tensor, torch.tensor(label, dtype=torch.long), torch.tensor(bbox, dtype=torch.float32)


class AnnotatedManifestDataset(Dataset):
    def __init__(self, manifest: Path, root: Path) -> None:
        self.records: list[tuple[Path, int, list[float]]] = []
        self.skipped = 0
        if not manifest.is_file():
            return

        for raw_line in manifest.read_text(encoding="utf-8").splitlines():
            if not raw_line.strip():
                continue
            record = json.loads(raw_line)
            image_path = root / record["image_path"]
            if not image_path.is_file():
                self.skipped += 1
                continue
            annotation = first_supported_annotation(record)
            if annotation is None:
                self.skipped += 1
                continue
            label_name, bbox_xywh = annotation
            width = float(record["width"])
            height = float(record["height"])
            x, y, w, h = [float(v) for v in bbox_xywh]
            bbox = [
                max(0.0, min(1.0, x / width)),
                max(0.0, min(1.0, y / height)),
                max(0.0, min(1.0, (x + w) / width)),
                max(0.0, min(1.0, (y + h) / height)),
            ]
            self.records.append((image_path, LABELS.index(label_name), bbox))

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int):
        image_path, label, bbox = self.records[index]
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Unable to load annotated image: {image_path}")
        width, height = INPUT_SIZE
        resized = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        tensor = torch.from_numpy(resized).float().permute(2, 0, 1) / 255.0
        return tensor, torch.tensor(label, dtype=torch.long), torch.tensor(bbox, dtype=torch.float32)


def first_supported_annotation(record: dict[str, Any]) -> tuple[str, list[float]] | None:
    for annotation in record.get("annotations", []):
        mapped = ANNOTATION_LABEL_MAP.get(str(annotation.get("class_name", "")))
        if mapped in LABELS and annotation.get("bbox_xywh"):
            return mapped, annotation["bbox_xywh"]
    return None


def render_sample(rng: random.Random) -> tuple[np.ndarray, int, list[float]]:
    width, height = INPUT_SIZE
    image = np.full((height, width, 3), 238, dtype=np.uint8)
    card_margin_x = 18
    card_margin_y = 14
    base_tint = rng.randrange(232, 250)
    image = np.full((height, width, 3), base_tint, dtype=np.uint8)
    border_color = rng.choice([(45, 55, 58), (65, 62, 72), (42, 65, 58)])
    cv2.rectangle(image, (card_margin_x, card_margin_y), (width - card_margin_x, height - card_margin_y), (255, 255, 255), -1)
    cv2.rectangle(image, (card_margin_x, card_margin_y), (width - card_margin_x, height - card_margin_y), border_color, 2)
    cv2.rectangle(
        image,
        (card_margin_x + 12, card_margin_y + 16),
        (width - card_margin_x - 12, card_margin_y + 70),
        (rng.randrange(70, 190), rng.randrange(70, 190), rng.randrange(70, 190)),
        -1,
    )
    for _ in range(rng.randrange(2, 6)):
        x = rng.randrange(card_margin_x + 8, width - card_margin_x - 8)
        y = rng.randrange(card_margin_y + 80, height - card_margin_y - 8)
        cv2.circle(image, (x, y), rng.randrange(1, 3), (rng.randrange(170, 235),) * 3, -1)
    label = rng.randrange(len(LABELS))

    if LABELS[label] == "edge_wear":
        side = rng.choice(["left", "right", "top", "bottom"])
        if side in {"left", "right"}:
            x1 = card_margin_x - 2 if side == "left" else width - card_margin_x - 5
            y1 = rng.randrange(card_margin_y + 30, height - card_margin_y - 50)
            x2, y2 = x1 + 7, y1 + rng.randrange(22, 54)
        else:
            x1 = rng.randrange(card_margin_x + 22, width - card_margin_x - 54)
            y1 = card_margin_y - 1 if side == "top" else height - card_margin_y - 5
            x2, y2 = x1 + rng.randrange(22, 54), y1 + 7
        cv2.rectangle(image, (x1, y1), (x2, y2), (205, 205, 205), -1)
    elif LABELS[label] == "corner_wear":
        x1, y1 = rng.choice([
            (card_margin_x - 1, card_margin_y - 1),
            (width - card_margin_x - 18, card_margin_y - 1),
            (card_margin_x - 1, height - card_margin_y - 18),
            (width - card_margin_x - 18, height - card_margin_y - 18),
        ])
        x2, y2 = x1 + rng.randrange(14, 24), y1 + rng.randrange(14, 24)
        cv2.ellipse(image, (x1 + 8, y1 + 8), (11, 8), 0, 0, 360, (205, 205, 205), -1)
    elif LABELS[label] == "scratch":
        x1 = rng.randrange(card_margin_x + 20, width - card_margin_x - 48)
        y1 = rng.randrange(card_margin_y + 86, height - card_margin_y - 40)
        length = rng.randrange(28, 62)
        angle = rng.uniform(-0.3, 0.3)
        x2 = int(x1 + length)
        y2 = int(y1 + length * angle)
        cv2.line(image, (x1, y1), (x2, y2), (55, 55, 55), 2)
        x1, y1, x2, y2 = min(x1, x2), min(y1, y2) - 3, max(x1, x2), max(y1, y2) + 3
    elif LABELS[label] == "crease":
        x1 = rng.randrange(card_margin_x + 18, width - card_margin_x - 64)
        y1 = rng.randrange(card_margin_y + 90, height - card_margin_y - 64)
        x2 = x1 + rng.randrange(40, 82)
        y2 = y1 + rng.randrange(10, 28)
        cv2.line(image, (x1, y1), (x2, y2), (90, 100, 110), 3)
        cv2.line(image, (x1, y1 + 5), (x2, y2 + 5), (210, 215, 218), 1)
    elif LABELS[label] == "dent":
        x1 = rng.randrange(card_margin_x + 18, width - card_margin_x - 38)
        y1 = rng.randrange(card_margin_y + 88, height - card_margin_y - 38)
        radius = rng.randrange(5, 12)
        x2, y2 = x1 + radius * 2, y1 + radius * 2
        cv2.circle(image, (x1 + radius, y1 + radius), radius, (170, 175, 180), -1)
        cv2.circle(image, (x1 + radius, y1 + radius), max(2, radius - 3), (225, 228, 230), -1)
    elif LABELS[label] == "hole":
        x1 = rng.randrange(card_margin_x + 20, width - card_margin_x - 44)
        y1 = rng.randrange(card_margin_y + 88, height - card_margin_y - 44)
        radius = rng.randrange(6, 13)
        x2, y2 = x1 + radius * 2, y1 + radius * 2
        cv2.circle(image, (x1 + radius, y1 + radius), radius, (35, 35, 35), -1)
        cv2.circle(image, (x1 + radius, y1 + radius), radius + 2, (175, 178, 180), 1)
    elif LABELS[label] == "tear":
        x1 = rng.randrange(card_margin_x + 12, width - card_margin_x - 74)
        y1 = rng.choice([card_margin_y + 12, height - card_margin_y - 36])
        x2 = x1 + rng.randrange(34, 74)
        y2 = y1 + rng.randrange(14, 30)
        points = np.array([(x1, y1), (x1 + 16, y2), (x1 + 34, y1 + 4), (x2, y2 - 2)], dtype=np.int32)
        cv2.polylines(image, [points], False, (65, 65, 65), 3)
    elif LABELS[label] == "surface_contamination":
        x1 = rng.randrange(card_margin_x + 20, width - card_margin_x - 56)
        y1 = rng.randrange(card_margin_y + 88, height - card_margin_y - 56)
        x2, y2 = x1 + rng.randrange(24, 52), y1 + rng.randrange(20, 46)
        cv2.ellipse(
            image,
            ((x1 + x2) // 2, (y1 + y2) // 2),
            ((x2 - x1) // 2, (y2 - y1) // 2),
            12,
            0,
            360,
            (150, 126, 88),
            -1,
        )
    else:
        x1 = card_margin_x - 2
        y1 = rng.randrange(card_margin_y + 90, height - card_margin_y - 72)
        x2 = width - card_margin_x + 2
        y2 = y1 + rng.randrange(30, 58)
        for offset in range(0, width, 24):
            cv2.rectangle(image, (offset, y1 + rng.randrange(0, 8)), (offset + 12, y2), (185, 188, 190), -1)

    if rng.random() < 0.35:
        alpha = rng.uniform(0.92, 1.08)
        beta = rng.uniform(-8, 8)
        image = np.clip(image.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8)
    noise = np.random.default_rng(self_seed(rng)).normal(0, rng.uniform(2.0, 5.5), image.shape)
    image = np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    bbox = [
        max(0.0, min(1.0, x1 / width)),
        max(0.0, min(1.0, y1 / height)),
        max(0.0, min(1.0, x2 / width)),
        max(0.0, min(1.0, y2 / height)),
    ]
    return image, label, bbox


def self_seed(rng: random.Random) -> int:
    return rng.randrange(0, 2**32 - 1)


def train(args: argparse.Namespace) -> dict[str, float]:
    torch.manual_seed(args.seed)
    synthetic_train = SyntheticDingDataset(args.train_samples, args.seed)
    annotated_train = AnnotatedManifestDataset(args.annotated_manifest, ROOT)
    train_dataset = ConcatDataset([synthetic_train, annotated_train]) if len(annotated_train) else synthetic_train
    train_loader = DataLoader(train_dataset, batch_size=args.batch, shuffle=True)
    val_loader = DataLoader(SyntheticDingDataset(args.val_samples, args.seed + 100_000), batch_size=args.batch)
    model = build_model(args.architecture, num_labels=len(LABELS))
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    ce = nn.CrossEntropyLoss()
    l1 = nn.SmoothL1Loss()

    for _epoch in range(args.epochs):
        model.train()
        for images, labels, boxes in train_loader:
            logits, pred_boxes = model(images)
            loss = ce(logits, labels) + args.box_weight * l1(pred_boxes, boxes)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

    model.eval()
    correct = 0
    total = 0
    box_error = 0.0
    per_class_total = {label: 0 for label in LABELS}
    per_class_correct = {label: 0 for label in LABELS}
    with torch.no_grad():
        for images, labels, boxes in val_loader:
            logits, pred_boxes = model(images)
            predictions = logits.argmax(dim=1)
            correct += int((predictions == labels).sum().item())
            total += int(labels.numel())
            box_error += float(torch.abs(pred_boxes - boxes).mean().item()) * int(labels.numel())
            for label_id, prediction_id in zip(labels.tolist(), predictions.tolist(), strict=False):
                label_name = LABELS[int(label_id)]
                per_class_total[label_name] += 1
                if int(label_id) == int(prediction_id):
                    per_class_correct[label_name] += 1
    metrics = {
        "architecture": args.architecture,
        "val_accuracy": round(correct / max(1, total), 4),
        "val_bbox_l1": round(box_error / max(1, total), 4),
        "train_samples": args.train_samples,
        "val_samples": args.val_samples,
        "annotated_samples_used": len(annotated_train),
        "annotated_samples_skipped": annotated_train.skipped,
        "labels": list(LABELS),
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "per_class_accuracy": {
            label: round(per_class_correct[label] / max(1, per_class_total[label]), 4)
            for label in LABELS
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "labels": LABELS,
            "input_size": INPUT_SIZE,
            "architecture": args.architecture,
            "metrics": metrics,
            "model_version": args.architecture,
        },
        args.output,
    )
    args.metrics.parent.mkdir(parents=True, exist_ok=True)
    args.metrics.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a synthetic DING detector for alpha fallback inference.")
    parser.add_argument("--output", type=Path, default=Path("services/inference-api/app/models/synthetic_ding_cnn.pt"))
    parser.add_argument("--metrics", type=Path, default=Path("services/inference-api/app/models/synthetic_ding_cnn.metrics.json"))
    parser.add_argument("--annotated-manifest", type=Path, default=Path("ml/datasets/manifests/ccv_verified_seed_v1.jsonl"))
    parser.add_argument(
        "--architecture",
        default=DEFAULT_ARCHITECTURE,
        choices=[
            "synthetic-ding-cnn-v0.1",
            "synthetic-ding-cnn-v0.2",
            "synthetic-ding-cnn-v0.2-large",
            "synthetic-ding-cnn-v0.3-xlarge",
        ],
    )
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--train-samples", type=int, default=3200)
    parser.add_argument("--val-samples", type=int, default=600)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--box-weight", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=1776)
    args = parser.parse_args()
    metrics = train(args)
    print(json.dumps({"output": str(args.output), "metrics": metrics}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
