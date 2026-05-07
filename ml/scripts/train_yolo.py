from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a YOLO defect detector.")
    parser.add_argument("--config", type=Path, default=Path("ml/configs/yolo_train.yaml"))
    parser.add_argument("--data", type=Path, help="YOLO data.yaml/dataset.yaml path.")
    parser.add_argument("--model", default=None, help="Base YOLO model, for example yolov8n.pt.")
    parser.add_argument("--imgsz", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", default=None, help="Batch size or 'auto'.")
    parser.add_argument("--device", default=None, help="CUDA device, cpu, or mps.")
    parser.add_argument("--project", default=None)
    parser.add_argument("--name", default=None)
    parser.add_argument("--model-version", default=None, help="Model version label to write into the metrics JSON.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("services/inference-api/app/models/ding-detector-v0.pt"),
        help="Where to copy the best trained weights.",
    )
    parser.add_argument(
        "--metrics",
        type=Path,
        default=Path("services/inference-api/app/models/ding-detector-v0.metrics.json"),
        help="Metadata JSON written after training.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate configuration without training.")
    return parser.parse_args()


def load_config(path: Path) -> dict:
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def merged_config(args: argparse.Namespace) -> dict:
    config = load_config(args.config)
    overrides = {
        "data": str(args.data) if args.data else None,
        "model": args.model,
        "imgsz": args.imgsz,
        "epochs": args.epochs,
        "batch": args.batch,
        "device": args.device,
        "project": args.project,
        "name": args.name,
    }
    return {**config, **{key: value for key, value in overrides.items() if value is not None}}


def _best_weights_path(result: object, project: str, name: str) -> Path | None:
    save_dir = Path(getattr(result, "save_dir", "") or "")
    candidates = [
        save_dir / "weights" / "best.pt",
        Path(project) / name / "weights" / "best.pt",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def batch_value(value: object) -> int | str:
    if isinstance(value, str):
        return value if value.lower() == "auto" else int(value)
    return int(value)


def main() -> int:
    args = parse_args()
    config = merged_config(args)
    model_name = str(config.get("model", "yolov8n.pt"))
    data_path = str(config.get("data", ""))
    project = str(config.get("project", "runs/card-condition"))
    name = str(config.get("name", "ding-detector-v0"))
    if args.dry_run:
        print(
            json.dumps(
                {
                    "config_ok": True,
                    "config": str(args.config),
                    "data": data_path,
                    "model": model_name,
                    "imgsz": int(config.get("imgsz", 896)),
                    "epochs": int(config.get("epochs", 50)),
                    "batch": config.get("batch", 8),
                    "device": config.get("device", "auto"),
                    "project": project,
                    "name": name,
                    "model_version": args.model_version or "ding-detector-v0",
                    "output": str(args.output),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if not data_path:
        raise ValueError("--data is required unless ml/configs/yolo_train.yaml sets data")

    try:
        from ultralytics import YOLO
    except Exception as exc:
        raise RuntimeError("Install ultralytics to train YOLO models") from exc

    model = YOLO(model_name)
    train_args = {
        "data": data_path,
        "epochs": int(config.get("epochs", 50)),
        "imgsz": int(config.get("imgsz", 896)),
        "batch": batch_value(config.get("batch", 8)),
        "project": project,
        "name": name,
    }
    if config.get("device") is not None:
        train_args["device"] = config["device"]
    result = model.train(**train_args)
    best_path = _best_weights_path(result, project, name)
    if best_path is None:
        raise FileNotFoundError("Training completed, but weights/best.pt was not found")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best_path, args.output)
    metrics = {
        "training_run_id": f"yolo-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        "model_version": args.model_version or "ding-detector-v0",
        "base_model": model_name,
        "data": data_path,
        "imgsz": int(config.get("imgsz", 896)),
        "epochs": int(config.get("epochs", 50)),
        "batch": config.get("batch", 8),
        "device": config.get("device", "auto"),
        "project": project,
        "name": name,
        "best_weights": str(best_path),
        "exported_weights": str(args.output),
    }
    args.metrics.parent.mkdir(parents=True, exist_ok=True)
    args.metrics.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
