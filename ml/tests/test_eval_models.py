from __future__ import annotations

from ml.scripts.eval_models import (
    LabeledBox,
    class_prior_predictions,
    iou_xyxy,
    match_predictions,
    random_baseline_predictions,
    region_for_box,
)


def test_iou_and_region_helpers() -> None:
    assert iou_xyxy((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou_xyxy((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    assert round(iou_xyxy((0, 0, 10, 10), (5, 5, 15, 15)), 4) == 0.1429

    image_shape = (100, 100)
    assert region_for_box((0, 0, 10, 10), image_shape) == "corner"
    assert region_for_box((45, 0, 55, 10), image_shape) == "edge"
    assert region_for_box((45, 45, 55, 55), image_shape) == "center"


def test_match_predictions_reports_per_class_and_region_counts() -> None:
    image_shape = (100, 100)
    ground_truth = [
        LabeledBox(1, "edge_wear", (0, 40, 15, 60)),
        LabeledBox(2, "corner_wear", (80, 80, 99, 99)),
    ]
    predictions = [
        LabeledBox(1, "edge_wear", (0, 40, 15, 60), confidence=0.9),
        LabeledBox(2, "corner_wear", (40, 40, 60, 60), confidence=0.8),
    ]

    summary = match_predictions(ground_truth, predictions, image_shape=image_shape, iou_threshold=0.5)

    assert summary["overall"]["tp"] == 1
    assert summary["overall"]["fp"] == 1
    assert summary["overall"]["fn"] == 1
    assert summary["overall"]["precision"] == 0.5
    assert summary["overall"]["recall"] == 0.5
    assert summary["per_class"]["edge_wear"]["tp"] == 1
    assert summary["per_class"]["corner_wear"]["fp"] == 1
    assert summary["per_class"]["corner_wear"]["fn"] == 1
    assert summary["per_region"]["edge"]["tp"] == 1
    assert summary["per_region"]["center"]["fp"] == 1
    assert summary["per_region"]["corner"]["fn"] == 1


def test_baseline_generators_are_deterministic_shape() -> None:
    names = {0: "card", 1: "edge_wear", 2: "corner_wear"}
    prior = class_prior_predictions((200, 100), names, [2, 1], count=3)
    assert [box.label for box in prior] == ["corner_wear", "edge_wear", "corner_wear"]
    assert len(prior) == 3

    import random

    rng = random.Random(5)
    random_predictions = random_baseline_predictions((200, 100), names, count=4, rng=rng)
    assert len(random_predictions) == 4
    assert {box.label for box in random_predictions}.issubset(set(names.values()))
