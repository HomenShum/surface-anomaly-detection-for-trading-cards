#!/usr/bin/env python3
"""Generate dependency-free placeholder GIF assets for demo and submission docs."""

from __future__ import annotations

import base64
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GIF_DIR = ROOT / "public" / "demo" / "gifs"
MANIFEST_PATH = GIF_DIR / "manifest.json"

# Small valid GIF89a image. The file is intentionally simple: these are visual
# placeholders, not production captures.
PLACEHOLDER_GIF = base64.b64decode(
    "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=="
)

GIFS = [
    {
        "file": "01-sample-card-analysis.gif",
        "label": "Sample card analysis",
        "usage": "Landing to report flow with DING overlay and evidence hashes.",
    },
    {
        "file": "02-scanner-quality-gate.gif",
        "label": "Scanner quality gate",
        "usage": "Guided scanner accepts selected still frames and rejects poor frames.",
    },
    {
        "file": "03-ding-correction.gif",
        "label": "DING correction",
        "usage": "User marks false positives, changes labels, and adds missed DINGS.",
    },
    {
        "file": "04-before-after-dispute.gif",
        "label": "Before/after dispute",
        "usage": "Side-by-side condition comparison and evidence packet export.",
    },
    {
        "file": "card-front-placeholder.gif",
        "label": "Card front capture placeholder",
        "usage": "Demo inventory card front and README screenshot slot.",
    },
    {
        "file": "card-back-placeholder.gif",
        "label": "Card back capture placeholder",
        "usage": "Back-side review state for submission walkthrough.",
    },
    {
        "file": "surface-scan-placeholder.gif",
        "label": "Surface anomaly scan placeholder",
        "usage": "QA snapshot and anomaly review docs.",
    },
]


def main() -> None:
    GIF_DIR.mkdir(parents=True, exist_ok=True)
    for item in GIFS:
        path = GIF_DIR / item["file"]
        path.write_bytes(PLACEHOLDER_GIF)
        print(f"Wrote {path}")

    MANIFEST_PATH.write_text(json.dumps({"gifs": GIFS}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
