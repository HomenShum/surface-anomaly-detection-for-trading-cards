from __future__ import annotations

import argparse
from pathlib import Path

import yaml


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train PatchCore-style anomaly model skeleton.")
    parser.add_argument("--config", type=Path, default=Path("ml/configs/patchcore_train.yaml"))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with args.config.open("r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle) or {}

    if args.dry_run:
        print(f"config_ok={args.config} backbone={config.get('backbone', 'wide_resnet50_2')}")
        return 0

    raise NotImplementedError(
        "PatchCore training requires selecting the production anomaly library. "
        "This CLI validates config shape and reserves the entry point."
    )


if __name__ == "__main__":
    raise SystemExit(main())
