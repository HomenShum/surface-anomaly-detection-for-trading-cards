#!/usr/bin/env python
"""Create local dataset source folders and document external download requirements.

This script intentionally does not scrape or download third-party card images.
Every external source must have license and redistribution rights verified first.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DATASET_SOURCES = [
    {
        "name": "internal_seed",
        "kind": "manual",
        "license": "proprietary/internal",
        "license_status": "verified",
        "instructions": "Place approved internal captures under raw/internal_seed/images.",
    },
    {
        "name": "synthetic_defects_v0",
        "kind": "generated",
        "license": "project-generated",
        "license_status": "verified",
        "instructions": "Place generated renders under raw/synthetic_defects_v0/images and keep render metadata.",
    },
    {
        "name": "public_candidate_placeholder",
        "kind": "external",
        "license": "unknown",
        "license_status": "verify before commercial use",
        "instructions": "Do not download or train commercially until source rights are verified.",
    },
]


def write_source_readme(root: Path, source: dict[str, str]) -> None:
    source_dir = root / "raw" / source["name"]
    images_dir = source_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    text = f"""# {source['name']}

Kind: {source['kind']}
License: {source['license']}
License status: {source['license_status']}

{source['instructions']}
"""
    (source_dir / "README.md").write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets-root", default="ml/datasets", help="Dataset staging root.")
    parser.add_argument("--list", action="store_true", help="Print source inventory as JSON.")
    parser.add_argument("--init", action="store_true", help="Create raw source folders and README files.")
    args = parser.parse_args()

    if args.list:
        print(json.dumps(DATASET_SOURCES, indent=2, sort_keys=True))

    if args.init:
        root = Path(args.datasets_root)
        for source in DATASET_SOURCES:
            write_source_readme(root, source)
        print(json.dumps({"initialized": [source["name"] for source in DATASET_SOURCES]}, indent=2))

    if not args.list and not args.init:
        parser.print_help()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
