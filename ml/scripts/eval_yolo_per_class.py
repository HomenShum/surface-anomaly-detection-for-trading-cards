"""
Per-class YOLO evaluation for the DING detector.

Runs the trained `ding-detector-v0.pt` model against a Roboflow validation
split, parses ultralytics' per-class precision / recall / mAP output, and
writes a structured JSON report to:

    data/benchmarks/yolo_eval/<timestamp>.json

The web app reads the most recent report from `/benchmarks` and renders a
per-class table. If no report exists, the page falls back to a clearly
labeled "synthetic placeholder" entry that ships with the repo.

Usage
-----

    python ml/scripts/eval_yolo_per_class.py \\
        --weights services/inference-api/app/models/ding-detector-v0.pt \\
        --data ml/datasets/yolo/roboflow_alpha/dataset.yaml \\
        --imgsz 640 \\
        --conf 0.25 \\
        --iou 0.5

Args default to repo-relative paths so the script can be run from any
working directory. Requires the `ultralytics` package; if it isn't
available the script writes a stub report explaining how to install.

This file documents the contract between the training pipeline and the
public benchmarks page. Anyone who improves the model can drop a fresh
report into `data/benchmarks/yolo_eval/` and the website picks it up.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WEIGHTS = REPO_ROOT / "services" / "inference-api" / "app" / "models" / "ding-detector-v0.pt"
DEFAULT_DATA = REPO_ROOT / "ml" / "datasets" / "yolo" / "roboflow_alpha" / "dataset.yaml"
OUTPUT_DIR = REPO_ROOT / "data" / "benchmarks" / "yolo_eval"


def _now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _write_stub(reason: str, weights: Path, data: Path) -> Path:
    _ensure_output_dir()
    payload: dict[str, Any] = {
        "report_id": f"yolo-eval-stub-{_now_stamp()}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": str(weights.relative_to(REPO_ROOT)) if weights.is_file() else str(weights),
        "dataset_version": str(data.relative_to(REPO_ROOT)) if data.is_file() else str(data),
        "imgsz": 640,
        "conf": 0.25,
        "iou": 0.5,
        "passed": False,
        "is_stub": True,
        "reason": reason,
        "summary": {
            "precision": None,
            "recall": None,
            "mAP_50": None,
            "mAP_50_95": None,
            "fitness": None,
        },
        "per_class": [],
        "per_region": [],
        "limitations": [
            "This is a stub. Run `python ml/scripts/eval_yolo_per_class.py` with the trained weights "
            "and Roboflow dataset.yaml to produce real numbers.",
            "Per-region splits require region-bbox metadata on each detection; not yet wired in the "
            "ultralytics output. Hand-author per_region entries until we ship that loop.",
        ],
    }
    out_path = OUTPUT_DIR / f"yolo-eval-stub-{_now_stamp()}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


def _try_import_ultralytics() -> Any | None:
    try:
        from ultralytics import YOLO  # type: ignore[import]

        return YOLO
    except ImportError:
        return None


def _format_metric(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _per_class_from_results(results: Any, names: dict[int, str] | list[str] | None) -> list[dict[str, Any]]:
    """
    Pull per-class metrics from ultralytics results.

    The `Metrics` object exposes `.box.maps`, `.box.p`, `.box.r`, etc. Each is
    a numpy array indexed by class. We convert to a list of plain dicts so
    the JSON can be loaded by Node without numpy round-trips.
    """
    rows: list[dict[str, Any]] = []
    box = getattr(results, "box", None) or getattr(getattr(results, "metrics", None), "box", None)
    if box is None:
        return rows
    p = getattr(box, "p", None)
    r = getattr(box, "r", None)
    map50 = getattr(box, "ap50", None)
    map5095 = getattr(box, "ap", None)

    if names is None:
        return rows
    name_iter = (names.values() if isinstance(names, dict) else names) or []

    for idx, name in enumerate(name_iter):
        rows.append(
            {
                "class": str(name),
                "precision": _format_metric(p[idx] if p is not None and idx < len(p) else None),
                "recall": _format_metric(r[idx] if r is not None and idx < len(r) else None),
                "mAP_50": _format_metric(map50[idx] if map50 is not None and idx < len(map50) else None),
                "mAP_50_95": _format_metric(
                    map5095[idx] if map5095 is not None and idx < len(map5095) else None
                ),
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Per-class YOLO eval → JSON report.")
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--device", type=str, default="cpu")
    parser.add_argument(
        "--allow-stub",
        action="store_true",
        default=True,
        help="If ultralytics or the dataset is unavailable, write a stub report instead of failing.",
    )
    args = parser.parse_args(argv)

    weights: Path = args.weights
    data: Path = args.data

    if not weights.is_file():
        if not args.allow_stub:
            print(f"weights not found: {weights}", file=sys.stderr)
            return 2
        path = _write_stub(f"Weights file missing at {weights}.", weights, data)
        print(f"wrote stub: {path}")
        return 0

    if not data.is_file():
        if not args.allow_stub:
            print(f"dataset.yaml not found: {data}", file=sys.stderr)
            return 2
        path = _write_stub(f"Dataset YAML missing at {data}.", weights, data)
        print(f"wrote stub: {path}")
        return 0

    YOLO = _try_import_ultralytics()
    if YOLO is None:
        if not args.allow_stub:
            print("ultralytics not installed; pip install ultralytics", file=sys.stderr)
            return 2
        path = _write_stub("ultralytics package not installed in this env.", weights, data)
        print(f"wrote stub: {path}")
        return 0

    _ensure_output_dir()
    started = time.time()
    model = YOLO(str(weights))
    results = model.val(
        data=str(data),
        imgsz=args.imgsz,
        conf=args.conf,
        iou=args.iou,
        device=args.device,
        verbose=False,
    )
    duration_s = round(time.time() - started, 2)

    box = getattr(results, "box", None)
    summary = {
        "precision": _format_metric(getattr(box, "mp", None)),
        "recall": _format_metric(getattr(box, "mr", None)),
        "mAP_50": _format_metric(getattr(box, "map50", None)),
        "mAP_50_95": _format_metric(getattr(box, "map", None)),
        "fitness": _format_metric(getattr(results, "fitness", None)),
    }
    names = getattr(model, "names", None) or getattr(results, "names", None)
    per_class = _per_class_from_results(results, names)

    report: dict[str, Any] = {
        "report_id": f"yolo-eval-{_now_stamp()}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": str(weights.relative_to(REPO_ROOT)) if weights.is_relative_to(REPO_ROOT) else str(weights),
        "dataset_version": str(data.relative_to(REPO_ROOT)) if data.is_relative_to(REPO_ROOT) else str(data),
        "imgsz": args.imgsz,
        "conf": args.conf,
        "iou": args.iou,
        "device": args.device,
        "duration_s": duration_s,
        "passed": (summary["mAP_50"] or 0.0) >= 0.30,
        "is_stub": False,
        "reason": None,
        "summary": summary,
        "per_class": per_class,
        "per_region": [],  # reserved for region-aware split when we wire it
        "limitations": [
            "Per-region splits not produced by ultralytics by default — fill in once we tag detections with region.",
            "Backside scans are sparse in the open Roboflow datasets; recall on back-edge classes is honest-low.",
        ],
    }

    out_path = OUTPUT_DIR / f"{report['report_id']}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote report: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
