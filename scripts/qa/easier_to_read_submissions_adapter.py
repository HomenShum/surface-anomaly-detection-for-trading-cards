#!/usr/bin/env python3
"""Adapter for optional easier-to-read-submissions integration.

The upstream package may be private or unavailable. This module first tries to
use an installed package and then falls back to the local vendor interface.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


try:
    from easier_to_read_submissions import render_submission_markdown  # type: ignore
except Exception:  # pragma: no cover - fallback path is the expected dogfood path.
    import sys

    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT / "vendor"))
    from easier_to_read_submissions import render_submission_markdown


def render(payload: dict[str, Any]) -> str:
    return render_submission_markdown(payload)
