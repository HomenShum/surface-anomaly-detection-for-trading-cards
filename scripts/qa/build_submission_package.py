#!/usr/bin/env python3
"""Generate a dogfood submission package for Card Condition Vault."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from easier_to_read_submissions_adapter import render


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_PATH = ROOT / "docs" / "submissions" / "card-condition-vault-snapshot.json"
OUTPUT_MD = ROOT / "docs" / "submissions" / "card-condition-vault-submission-package.md"
OUTPUT_JSON = ROOT / "docs" / "submissions" / "card-condition-vault-submission-package.json"
OUTPUT_ZIP = ROOT / "docs" / "submissions" / "card-condition-vault-submission-package.zip"
README_SNIPPETS = ROOT / "docs" / "demo" / "README_SNIPPETS.md"


def load_snapshot() -> dict:
    if not SNAPSHOT_PATH.exists():
        raise SystemExit(f"Missing {SNAPSHOT_PATH}. Run scripts/qa/snapshot_report.py first.")
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def main() -> None:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    snapshot = load_snapshot()
    payload = {
        "title": "Card Condition Vault Dogfood Submission",
        "generatedAt": generated_at,
        "summary": {
            "goal": "Verify the demo review flow, readable submission notes, and QA artifacts.",
            "cardCount": snapshot["cardCount"],
            "averageConfidence": snapshot["averageConfidence"],
        },
        "artifacts": [
            "public/demo/seed-data/cards.json",
            "public/demo/seed-data/demo-state.json",
            "public/demo/gifs/manifest.json",
            "docs/qa/snapshot-report.md",
            "docs/qa/CHECKLIST.md",
            "docs/demo/DEMO_STEPS.md",
        ],
        "reviewQueue": snapshot["cards"],
        "integrationNotes": [
            "Uses a local fallback when easier-to-read-submissions is unavailable.",
            "Open Design notes are captured in docs/demo/OPEN_DESIGN_INTEGRATION.md.",
        ],
    }

    OUTPUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    OUTPUT_MD.write_text(render(payload), encoding="utf-8")

    snippets = [
        "# README Snippets",
        "",
        "## Demo Seed",
        "",
        "```bash",
        "python scripts/demo/seed_card_condition_vault.py",
        "pnpm demo:gifs",
        "```",
        "",
        "## QA Snapshot",
        "",
        "```bash",
        "python scripts/qa/snapshot_report.py",
        "python scripts/qa/build_submission_package.py",
        "```",
        "",
        "## Submission Artifact",
        "",
        "The generated package lives at `docs/submissions/card-condition-vault-submission-package.md`.",
    ]
    README_SNIPPETS.write_text("\n".join(snippets) + "\n", encoding="utf-8")

    with zipfile.ZipFile(OUTPUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in payload["artifacts"]:
            path = ROOT / relative
            if path.exists():
                archive.write(path, relative)
        archive.write(OUTPUT_MD, OUTPUT_MD.relative_to(ROOT))
        archive.write(OUTPUT_JSON, OUTPUT_JSON.relative_to(ROOT))
        archive.write(README_SNIPPETS, README_SNIPPETS.relative_to(ROOT))

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MD}")
    print(f"Wrote {README_SNIPPETS}")
    print(f"Wrote {OUTPUT_ZIP}")


if __name__ == "__main__":
    main()
