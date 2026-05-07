#!/usr/bin/env python3
"""Build a readable QA snapshot report from demo seed data."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = ROOT / "public" / "demo" / "seed-data" / "cards.json"
REPORT_PATH = ROOT / "docs" / "qa" / "snapshot-report.md"
SNAPSHOT_JSON_PATH = ROOT / "docs" / "submissions" / "card-condition-vault-snapshot.json"


def load_cards() -> list[dict]:
    if not SEED_PATH.exists():
        raise SystemExit(
            f"Missing {SEED_PATH}. Run scripts/demo/seed_card_condition_vault.py first."
        )
    payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return list(payload.get("cards", []))


def main() -> None:
    cards = load_cards()
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    status_counts = Counter(card["submissionStatus"] for card in cards)
    risk_counts = Counter(flag for card in cards for flag in card.get("riskFlags", []))
    average_confidence = round(
        sum(float(card.get("confidence", 0)) for card in cards) / max(len(cards), 1),
        3,
    )

    seed_display_path = SEED_PATH.relative_to(ROOT).as_posix()
    snapshot = {
        "generatedAt": generated_at,
        "source": seed_display_path,
        "cardCount": len(cards),
        "averageConfidence": average_confidence,
        "statusCounts": dict(sorted(status_counts.items())),
        "riskCounts": dict(sorted(risk_counts.items())),
        "cards": cards,
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# Card Condition Vault QA Snapshot",
        "",
        f"Generated: `{generated_at}`",
        f"Source seed: `{seed_display_path}`",
        "",
        "## Summary",
        "",
        f"- Cards seeded: {len(cards)}",
        f"- Average confidence: {average_confidence}",
        "",
        "## Submission Status",
        "",
    ]
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(status_counts.items()))
    lines.extend(["", "## Risk Flags", ""])
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(risk_counts.items()))
    lines.extend(["", "## Review Queue", ""])
    for card in cards:
        flags = ", ".join(card.get("riskFlags", [])) or "none"
        lines.append(
            f"- `{card['id']}` {card['title']} - {card['detectedCondition']} "
            f"(confidence {card['confidence']}, flags: {flags})"
        )

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    SNAPSHOT_JSON_PATH.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")
    print(f"Wrote {SNAPSHOT_JSON_PATH}")


if __name__ == "__main__":
    main()
