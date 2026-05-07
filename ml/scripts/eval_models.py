from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import random
import sys
from typing import Any, Iterable

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = ROOT / "services" / "inference-api"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.pipelines.detector import CardConditionDetector, Detection
from app.pipelines.normalization import load_image, normalize_card_image


@dataclass(frozen=True)
class LabeledBox:
    class_id: int
    label: str
    bbox_xyxy: tuple[float, float, float, float]
    confidence: float = 1.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate card condition model artifacts.")
    parser.add_argument("--images", type=Path, help="Image file or folder for prediction-only eval.")
    parser.add_argument("--weights", type=Path, help="Trained weights to evaluate.")
    parser.add_argument("--base-weights", type=Path, help="Optional frozen/base model weights to compare if available locally.")
    parser.add_argument("--data", type=Path, help="YOLO dataset.yaml for labeled detection evaluation.")
    parser.add_argument("--split", default="test", choices=["train", "val", "test"], help="YOLO split to evaluate.")
    parser.add_argument("--output", type=Path, default=Path("ml/runs/eval_report.json"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def iter_images(path: Path) -> list[Path]:
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    if path.is_file():
        return [path]
    return sorted(p for p in path.rglob("*") if p.suffix.lower() in extensions)


def parse_yolo_data_yaml(path: Path) -> dict[str, Any]:
    """Parse the small subset of YOLO data.yaml we emit locally."""
    raw = path.read_text(encoding="utf-8").splitlines()
    parsed: dict[str, Any] = {"names": {}}
    in_names = False
    for line in raw:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("names:"):
            in_names = True
            continue
        if in_names and line.startswith("  "):
            key, value = line.strip().split(":", 1)
            parsed["names"][int(key)] = value.strip().strip("\"'")
            continue
        in_names = False
        if ":" in line:
            key, value = line.split(":", 1)
            parsed[key.strip()] = value.strip().strip("\"'")
    return parsed


def resolve_split_images(data_yaml: Path, split: str) -> tuple[Path, list[Path], dict[int, str]]:
    data = parse_yolo_data_yaml(data_yaml)
    root = Path(str(data.get("path", data_yaml.parent))).expanduser()
    if not root.is_absolute():
        root = (data_yaml.parent / root).resolve()
    split_value = str(data.get(split, f"images/{split}"))
    image_root = Path(split_value)
    if not image_root.is_absolute():
        image_root = root / image_root
    return root, iter_images(image_root), {int(k): str(v) for k, v in data["names"].items()}


def label_path_for_image(dataset_root: Path, image_path: Path) -> Path:
    parts = list(image_path.parts)
    if "images" in parts:
        index = parts.index("images")
        label_parts = parts[:]
        label_parts[index] = "labels"
        return Path(*label_parts).with_suffix(".txt")
    return dataset_root / "labels" / image_path.with_suffix(".txt").name


def read_yolo_labels(label_path: Path, image_shape: tuple[int, int], names: dict[int, str]) -> list[LabeledBox]:
    if not label_path.is_file():
        return []
    height, width = image_shape
    labels: list[LabeledBox] = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        class_id = int(float(parts[0]))
        xc, yc, bw, bh = (float(value) for value in parts[1:5])
        x1 = (xc - bw / 2.0) * width
        y1 = (yc - bh / 2.0) * height
        x2 = (xc + bw / 2.0) * width
        y2 = (yc + bh / 2.0) * height
        labels.append(
            LabeledBox(
                class_id=class_id,
                label=names.get(class_id, str(class_id)),
                bbox_xyxy=(x1, y1, x2, y2),
            )
        )
    return labels


def iou_xyxy(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    intersection = iw * ih
    if intersection <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def region_for_box(box: tuple[float, float, float, float], image_shape: tuple[int, int]) -> str:
    height, width = image_shape
    x1, y1, x2, y2 = box
    cx = ((x1 + x2) / 2.0) / max(1, width)
    cy = ((y1 + y2) / 2.0) / max(1, height)
    near_left_or_right = cx <= 0.18 or cx >= 0.82
    near_top_or_bottom = cy <= 0.18 or cy >= 0.82
    if near_left_or_right and near_top_or_bottom:
        return "corner"
    if near_left_or_right or near_top_or_bottom:
        return "edge"
    return "center"


def safe_div(num: float, denom: float) -> float:
    return num / denom if denom else 0.0


def empty_counts() -> dict[str, int]:
    return {"tp": 0, "fp": 0, "fn": 0, "support": 0, "predictions": 0}


def summarize_counts(counts: dict[str, int]) -> dict[str, float | int]:
    precision = safe_div(counts["tp"], counts["tp"] + counts["fp"])
    recall = safe_div(counts["tp"], counts["tp"] + counts["fn"])
    f1 = safe_div(2 * precision * recall, precision + recall)
    return {
        **counts,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
    }


def detection_to_labeled_box(detection: Detection, names_by_label: dict[str, int]) -> LabeledBox | None:
    if detection.label not in names_by_label:
        return None
    return LabeledBox(
        class_id=names_by_label[detection.label],
        label=detection.label,
        bbox_xyxy=tuple(float(value) for value in detection.bbox),
        confidence=float(detection.confidence),
    )


def match_predictions(
    ground_truth: list[LabeledBox],
    predictions: list[LabeledBox],
    *,
    image_shape: tuple[int, int],
    iou_threshold: float,
) -> dict[str, Any]:
    matched_gt: set[int] = set()
    class_counts: dict[str, dict[str, int]] = {}
    region_counts: dict[str, dict[str, int]] = {}
    overall = empty_counts()

    for gt in ground_truth:
        class_counts.setdefault(gt.label, empty_counts())["support"] += 1
        region_counts.setdefault(region_for_box(gt.bbox_xyxy, image_shape), empty_counts())["support"] += 1

    ordered_predictions = sorted(predictions, key=lambda pred: pred.confidence, reverse=True)
    for pred in ordered_predictions:
        class_counts.setdefault(pred.label, empty_counts())["predictions"] += 1
        region_counts.setdefault(region_for_box(pred.bbox_xyxy, image_shape), empty_counts())["predictions"] += 1
        best_index = -1
        best_iou = 0.0
        for index, gt in enumerate(ground_truth):
            if index in matched_gt or gt.class_id != pred.class_id:
                continue
            overlap = iou_xyxy(pred.bbox_xyxy, gt.bbox_xyxy)
            if overlap > best_iou:
                best_index = index
                best_iou = overlap
        if best_index >= 0 and best_iou >= iou_threshold:
            matched_gt.add(best_index)
            class_counts[pred.label]["tp"] += 1
            region_counts[region_for_box(ground_truth[best_index].bbox_xyxy, image_shape)]["tp"] += 1
            overall["tp"] += 1
        else:
            class_counts[pred.label]["fp"] += 1
            region_counts[region_for_box(pred.bbox_xyxy, image_shape)]["fp"] += 1
            overall["fp"] += 1

    for index, gt in enumerate(ground_truth):
        if index not in matched_gt:
            class_counts[gt.label]["fn"] += 1
            region_counts[region_for_box(gt.bbox_xyxy, image_shape)]["fn"] += 1
            overall["fn"] += 1

    overall["support"] = len(ground_truth)
    overall["predictions"] = len(predictions)
    return {
        "overall": summarize_counts(overall),
        "per_class": {label: summarize_counts(counts) for label, counts in sorted(class_counts.items())},
        "per_region": {region: summarize_counts(counts) for region, counts in sorted(region_counts.items())},
    }


def merge_metric_summaries(summaries: Iterable[dict[str, Any]]) -> dict[str, Any]:
    overall = empty_counts()
    class_counts: dict[str, dict[str, int]] = {}
    region_counts: dict[str, dict[str, int]] = {}
    for summary in summaries:
        for key in overall:
            overall[key] += int(summary["overall"][key])
        for label, counts in summary["per_class"].items():
            target = class_counts.setdefault(label, empty_counts())
            for key in target:
                target[key] += int(counts[key])
        for region, counts in summary["per_region"].items():
            target = region_counts.setdefault(region, empty_counts())
            for key in target:
                target[key] += int(counts[key])
    return {
        "overall": summarize_counts(overall),
        "per_class": {label: summarize_counts(counts) for label, counts in sorted(class_counts.items())},
        "per_region": {region: summarize_counts(counts) for region, counts in sorted(region_counts.items())},
    }


def random_baseline_predictions(
    image_shape: tuple[int, int],
    names: dict[int, str],
    *,
    count: int,
    rng: random.Random,
) -> list[LabeledBox]:
    height, width = image_shape
    predictions: list[LabeledBox] = []
    class_ids = sorted(names)
    for _ in range(max(1, count)):
        bw = rng.uniform(0.04, 0.22) * width
        bh = rng.uniform(0.04, 0.22) * height
        x1 = rng.uniform(0, max(1.0, width - bw))
        y1 = rng.uniform(0, max(1.0, height - bh))
        class_id = rng.choice(class_ids)
        predictions.append(
            LabeledBox(class_id, names[class_id], (x1, y1, x1 + bw, y1 + bh), confidence=rng.uniform(0.05, 0.5))
        )
    return predictions


def class_prior_predictions(
    image_shape: tuple[int, int],
    names: dict[int, str],
    class_priors: list[int],
    *,
    count: int,
) -> list[LabeledBox]:
    height, width = image_shape
    # Detector-agnostic lower bound: common classes in canonical edge/corner boxes.
    boxes = [
        (0.02 * width, 0.02 * height, 0.18 * width, 0.18 * height),
        (0.82 * width, 0.02 * height, 0.98 * width, 0.18 * height),
        (0.02 * width, 0.82 * height, 0.18 * width, 0.98 * height),
        (0.82 * width, 0.82 * height, 0.98 * width, 0.98 * height),
        (0.02 * width, 0.42 * height, 0.18 * width, 0.58 * height),
        (0.42 * width, 0.02 * height, 0.58 * width, 0.18 * height),
    ]
    predictions: list[LabeledBox] = []
    for index in range(max(1, count)):
        class_id = class_priors[index % len(class_priors)]
        predictions.append(
            LabeledBox(class_id, names[class_id], boxes[index % len(boxes)], confidence=max(0.05, 0.4 - index * 0.02))
        )
    return predictions


def evaluate_detector_on_yolo(
    *,
    detector: CardConditionDetector,
    images: list[Path],
    dataset_root: Path,
    names: dict[int, str],
    iou_threshold: float,
) -> dict[str, Any]:
    names_by_label = {label: class_id for class_id, label in names.items()}
    summaries = []
    evaluated = 0
    for image_path in images:
        image = load_image(image_path)
        image_shape = image.shape[:2]
        labels = read_yolo_labels(label_path_for_image(dataset_root, image_path), image_shape, names)
        result = detector.predict(image)
        predictions = [
            box for box in (detection_to_labeled_box(detection, names_by_label) for detection in result.detections) if box
        ]
        summaries.append(match_predictions(labels, predictions, image_shape=image_shape, iou_threshold=iou_threshold))
        evaluated += 1
    merged = merge_metric_summaries(summaries)
    return {
        "image_count": evaluated,
        "model_loaded": detector.model_loaded,
        "fallback_reason": detector._fallback_reason,  # noqa: SLF001 - this is an eval diagnostic.
        **merged,
    }


def evaluate_lower_bounds(
    *,
    images: list[Path],
    dataset_root: Path,
    names: dict[int, str],
    iou_threshold: float,
    seed: int,
) -> dict[str, Any]:
    rng = random.Random(seed)
    all_labels: list[LabeledBox] = []
    image_payloads = []
    for image_path in images:
        image = load_image(image_path)
        image_shape = image.shape[:2]
        labels = read_yolo_labels(label_path_for_image(dataset_root, image_path), image_shape, names)
        all_labels.extend(labels)
        image_payloads.append((image_shape, labels))

    class_frequency: dict[int, int] = {}
    for label in all_labels:
        class_frequency[label.class_id] = class_frequency.get(label.class_id, 0) + 1
    class_priors = [class_id for class_id, _ in sorted(class_frequency.items(), key=lambda item: item[1], reverse=True)]
    if not class_priors:
        class_priors = sorted(names)
    mean_labels_per_image = round(safe_div(len(all_labels), len(images))) if images else 1

    random_summaries = []
    prior_summaries = []
    for image_shape, labels in image_payloads:
        random_summaries.append(
            match_predictions(
                labels,
                random_baseline_predictions(image_shape, names, count=mean_labels_per_image, rng=rng),
                image_shape=image_shape,
                iou_threshold=iou_threshold,
            )
        )
        prior_summaries.append(
            match_predictions(
                labels,
                class_prior_predictions(image_shape, names, class_priors, count=mean_labels_per_image),
                image_shape=image_shape,
                iou_threshold=iou_threshold,
            )
        )

    return {
        "random_detector": {
            "description": "Uniform random boxes/classes. Sanity lower bound only.",
            **merge_metric_summaries(random_summaries),
        },
        "class_prior_regions": {
            "description": "Most common classes in fixed corner/edge boxes. Uses split-level priors, so treat as a weak sanity baseline.",
            "class_order": [names[class_id] for class_id in class_priors],
            **merge_metric_summaries(prior_summaries),
        },
    }


def prediction_only_report(args: argparse.Namespace) -> dict[str, Any]:
    if args.images is None:
        raise ValueError("--images is required when --data is not provided")
    detector = CardConditionDetector(args.weights, confidence_threshold=args.conf)
    images = iter_images(args.images)
    if args.limit > 0:
        images = images[: args.limit]

    records = []
    quality_scores = []
    for image_path in images:
        normalized = normalize_card_image(load_image(image_path))
        result = detector.predict(normalized.image)
        quality_scores.append(normalized.quality.score)
        records.append(
            {
                "image": str(image_path),
                "quality_score": normalized.quality.score,
                "detections": [d.__dict__ for d in result.detections],
                "fallback_reason": result.fallback_reason,
            }
        )

    return {
        "mode": "prediction_only",
        "image_count": len(records),
        "model_loaded": detector.model_loaded,
        "mean_quality_score": float(np.mean(quality_scores)) if quality_scores else 0.0,
        "records": records,
    }


def yolo_dataset_report(args: argparse.Namespace) -> dict[str, Any]:
    dataset_root, images, names = resolve_split_images(args.data, args.split)
    if args.limit > 0:
        images = images[: args.limit]
    report: dict[str, Any] = {
        "mode": "yolo_detection_eval",
        "dataset": str(args.data),
        "split": args.split,
        "image_count": len(images),
        "iou_threshold": args.iou,
        "confidence_threshold": args.conf,
        "classes": names,
        "baselines": evaluate_lower_bounds(
            images=images,
            dataset_root=dataset_root,
            names=names,
            iou_threshold=args.iou,
            seed=args.seed,
        ),
        "models": {},
    }
    if args.weights:
        report["models"]["trained"] = evaluate_detector_on_yolo(
            detector=CardConditionDetector(args.weights, confidence_threshold=args.conf),
            images=images,
            dataset_root=dataset_root,
            names=names,
            iou_threshold=args.iou,
        )
    if args.base_weights:
        if args.base_weights.is_file():
            report["models"]["base"] = evaluate_detector_on_yolo(
                detector=CardConditionDetector(args.base_weights, confidence_threshold=args.conf),
                images=images,
                dataset_root=dataset_root,
                names=names,
                iou_threshold=args.iou,
            )
        else:
            report["models"]["base"] = {
                "skipped": True,
                "reason": f"base weights not found locally: {args.base_weights}",
            }
    return report


def main() -> int:
    args = parse_args()
    report = yolo_dataset_report(args) if args.data else prediction_only_report(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(f"report={args.output} mode={report['mode']} images={report['image_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
