from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelArtifact:
    path: Path | None
    kind: str
    exists: bool


def resolve_model_artifact(path: str | Path | None, *, kind: str) -> ModelArtifact:
    if path is None or str(path).strip() == "":
        return ModelArtifact(path=None, kind=kind, exists=False)

    artifact_path = Path(path).expanduser()
    return ModelArtifact(path=artifact_path, kind=kind, exists=artifact_path.is_file())
