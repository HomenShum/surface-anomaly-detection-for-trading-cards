"""Readable submission rendering fallback.

This intentionally mirrors the small surface area needed by the QA scripts. If
the real package is installed later, scripts can keep the same adapter call.
"""

from __future__ import annotations

from typing import Any


def render_submission_markdown(payload: dict[str, Any]) -> str:
    title = payload.get("title", "Submission")
    summary = payload.get("summary", {})
    artifacts = payload.get("artifacts", [])
    review_queue = payload.get("reviewQueue", [])
    integration_notes = payload.get("integrationNotes", [])

    lines = [
        f"# {title}",
        "",
        f"Generated: `{payload.get('generatedAt', 'unknown')}`",
        "",
        "## Summary",
        "",
    ]
    for key, value in summary.items():
        lines.append(f"- {key}: {value}")

    lines.extend(["", "## Artifacts", ""])
    lines.extend(f"- `{artifact}`" for artifact in artifacts)

    lines.extend(["", "## Review Queue", ""])
    for card in review_queue:
        lines.append(
            f"- `{card.get('id')}` {card.get('title')} - "
            f"{card.get('detectedCondition')} ({card.get('submissionStatus')})"
        )

    lines.extend(["", "## Integration Notes", ""])
    lines.extend(f"- {note}" for note in integration_notes)
    return "\n".join(lines) + "\n"
