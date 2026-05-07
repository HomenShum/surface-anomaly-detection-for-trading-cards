#!/usr/bin/env python3
"""Create deterministic demo seed data for Card Condition Vault."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DEMO = ROOT / "public" / "demo"
SEED_PATH = PUBLIC_DEMO / "seed-data" / "cards.json"
STATE_PATH = PUBLIC_DEMO / "seed-data" / "demo-state.json"


CARDS = [
    {
        "id": "ccv-001",
        "title": "1999 Base Set Charizard",
        "set": "Pokemon Base Set",
        "collector": "Avery Chen",
        "declaredGrade": "Near Mint",
        "detectedCondition": "Light edge whitening",
        "confidence": 0.91,
        "riskFlags": ["edge-wear", "corner-softening"],
        "submissionStatus": "ready_for_review",
        "image": "/demo/gifs/card-front-placeholder.gif",
        "notes": "High-value sample with visible left-edge wear for demo triage.",
    },
    {
        "id": "ccv-002",
        "title": "2020 Panini Prizm Rookie",
        "set": "Panini Prizm Basketball",
        "collector": "Morgan Patel",
        "declaredGrade": "Mint",
        "detectedCondition": "Centering variance",
        "confidence": 0.87,
        "riskFlags": ["off-centering"],
        "submissionStatus": "needs_second_pass",
        "image": "/demo/gifs/card-back-placeholder.gif",
        "notes": "Good example for explaining why declared grade and model read differ.",
    },
    {
        "id": "ccv-003",
        "title": "1989 Upper Deck Ken Griffey Jr.",
        "set": "Upper Deck Baseball",
        "collector": "Sam Rivera",
        "declaredGrade": "Excellent",
        "detectedCondition": "Surface print lines",
        "confidence": 0.78,
        "riskFlags": ["surface-lines", "print-defect"],
        "submissionStatus": "manual_review",
        "image": "/demo/gifs/surface-scan-placeholder.gif",
        "notes": "Lower confidence item used to demonstrate reviewer escalation.",
    },
]


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    write_json(SEED_PATH, {"generatedAt": generated_at, "cards": CARDS})
    write_json(
        STATE_PATH,
        {
            "generatedAt": generated_at,
            "demoUser": "qa-dogfood-agent",
            "activeCardId": CARDS[0]["id"],
            "reviewQueue": [card["id"] for card in CARDS],
            "filters": {"status": "all", "riskFlag": "any"},
        },
    )
    print(f"Wrote {SEED_PATH}")
    print(f"Wrote {STATE_PATH}")


if __name__ == "__main__":
    main()
