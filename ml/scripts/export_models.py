from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export trained artifacts for inference-api deployment.")
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model-type", choices=["yolo", "patchcore"], default="yolo")
    parser.add_argument("--version", default="dev")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.weights.is_file():
        raise FileNotFoundError(f"weights not found: {args.weights}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_weights = args.output_dir / args.weights.name
    shutil.copy2(args.weights, output_weights)

    metadata = {
        "model_type": args.model_type,
        "version": args.version,
        "weights": output_weights.name,
    }
    metadata_path = args.output_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")
    print(f"exported={output_weights} metadata={metadata_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
