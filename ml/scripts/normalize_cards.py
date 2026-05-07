from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = ROOT / "services" / "inference-api"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.pipelines.normalization import normalize_card_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize card sample images for model training.")
    parser.add_argument("--input", required=True, type=Path, help="Input image file or directory.")
    parser.add_argument("--output", required=True, type=Path, help="Output directory.")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=896)
    parser.add_argument("--manifest", type=Path, help="Optional JSONL manifest path.")
    return parser.parse_args()


def iter_images(path: Path) -> list[Path]:
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    if path.is_file():
        return [path]
    return sorted(p for p in path.rglob("*") if p.suffix.lower() in extensions)


def main() -> int:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.manifest or args.output / "normalization_manifest.jsonl"

    records = []
    for image_path in iter_images(args.input):
        relative_name = image_path.name if args.input.is_file() else str(image_path.relative_to(args.input))
        output_path = args.output / relative_name
        result = normalize_card_file(image_path, output_path, output_size=(args.width, args.height))
        records.append(
            {
                "input": str(image_path),
                "output": str(output_path),
                "quality": result.quality.__dict__,
                "transform": result.transform,
            }
        )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True) + "\n")

    print(f"normalized={len(records)} manifest={manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
