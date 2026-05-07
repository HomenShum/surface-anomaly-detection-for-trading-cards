from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.schemas import (
    EvidenceItem,
    EvidenceManifest,
    EvidenceVerifyItem,
    EvidenceVerifyRequest,
    EvidenceVerifyResponse,
    ImagePayload,
    NormalizedScan,
)


def decode_image(payload: ImagePayload) -> tuple[bytes, list[str]]:
    warnings: list[str] = []
    try:
        return base64.b64decode(payload.image_base64, validate=True), warnings
    except Exception:
        warnings.append("image_base64 was not valid strict base64; attempted permissive decode")
        return base64.b64decode(payload.image_base64)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_evidence_item(
    *,
    name: str,
    data: bytes,
    content_type: str,
    uri: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> EvidenceItem:
    return EvidenceItem(
        name=name,
        sha256=sha256_bytes(data),
        content_type=content_type,
        size_bytes=len(data),
        uri=uri,
        metadata=metadata or {},
    )


def build_manifest(*, report_id: str | None, items: list[EvidenceItem]) -> EvidenceManifest:
    resolved_report_id = report_id or f"report_{uuid4().hex}"
    manifest_payload = {
        "manifest_version": "0.1",
        "report_id": resolved_report_id,
        "items": [item.model_dump(mode="json") for item in items],
        "model": {
            "ding_detector": os.environ.get("CARD_CONDITION_MODEL_VERSION", "ding-detector-v0"),
            "normalizer": "opencv-v0.1",
        },
    }
    manifest_bytes = json.dumps(manifest_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return EvidenceManifest(
        report_id=resolved_report_id,
        items=items,
        manifest_sha256=sha256_bytes(manifest_bytes),
        model=manifest_payload["model"],
    )


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _safe_path_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._") or "report"


def _persist_artifact(*, report_id: str, name: str, data: bytes, extension: str) -> str | None:
    if not _env_bool("CARD_CONDITION_PERSIST_ARTIFACTS", default=False):
        return None
    storage_root = Path(os.environ.get("CARD_CONDITION_STORAGE_ROOT", "storage"))
    relative = Path("scans") / _safe_path_part(report_id) / f"{_safe_path_part(name)}{extension}"
    target = storage_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return str(relative).replace("\\", "/")


def normalize_payload(payload: ImagePayload) -> NormalizedScan:
    raw_bytes, warnings = decode_image(payload)

    try:
        normalized_bytes, width, height, metadata, quality_warnings = _normalize_with_pipeline(raw_bytes)
        warnings.extend(quality_warnings)
    except Exception as exc:
        normalized_bytes = raw_bytes
        width = None
        height = None
        metadata = {"normalizer": "fallback"}
        warnings.append(f"normalization fallback used: {exc.__class__.__name__}")

    return NormalizedScan(
        width=width,
        height=height,
        image_base64=base64.b64encode(normalized_bytes).decode("ascii"),
        sha256=sha256_bytes(normalized_bytes),
        warnings=warnings,
        metadata=metadata,
    )


def _normalize_with_pipeline(raw_bytes: bytes) -> tuple[bytes, int | None, int | None, dict[str, Any], list[str]]:
    try:
        from app.pipelines.normalization import normalize_bytes  # type: ignore

        normalized = normalize_bytes(raw_bytes)
        return (
            normalized.get("bytes", raw_bytes),
            normalized.get("width"),
            normalized.get("height"),
            dict(normalized.get("metadata", {})),
            list(normalized.get("warnings", [])),
        )
    except ImportError:
        pass

    from app.pipelines.normalization import normalize_card_image

    try:
        import cv2  # type: ignore
        import numpy as np
    except Exception as exc:  # pragma: no cover - environment-dependent fallback
        raise RuntimeError("OpenCV and NumPy are required for pipeline normalization") from exc

    image_array = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_array is None:
        raise ValueError("unable to decode image bytes")

    result = normalize_card_image(image_array)
    ok, encoded = cv2.imencode(".png", result.image)
    if not ok:
        raise ValueError("unable to encode normalized image")

    height, width = result.image.shape[:2]
    metadata = {
        "normalizer": "app.pipelines.normalization.normalize_card_image",
        "quality": result.quality.__dict__,
        "transform": result.transform,
    }
    return BytesIO(encoded.tobytes()).getvalue(), width, height, metadata, list(result.quality.warnings)


def manifest_for_normalized_scan(
    *,
    report_id: str | None,
    source: ImagePayload,
    normalized: NormalizedScan,
    source_name: str = "source",
    normalized_name: str = "normalized",
) -> EvidenceManifest:
    resolved_report_id = report_id or f"report_{uuid4().hex}"
    source_bytes, _ = decode_image(source)
    normalized_bytes = base64.b64decode(normalized.image_base64)
    source_uri = _persist_artifact(
        report_id=resolved_report_id,
        name=source_name,
        data=source_bytes,
        extension=".bin",
    )
    normalized_uri = _persist_artifact(
        report_id=resolved_report_id,
        name=normalized_name,
        data=normalized_bytes,
        extension=".png",
    )
    items = [
        build_evidence_item(
            name=source_name,
            data=source_bytes,
            content_type=source.content_type or "application/octet-stream",
            uri=source_uri,
            metadata={"filename": source.filename} if source.filename else {},
        ),
        build_evidence_item(
            name=normalized_name,
            data=normalized_bytes,
            content_type=source.content_type or "application/octet-stream",
            uri=normalized_uri,
            metadata=normalized.metadata,
        ),
    ]
    return build_manifest(report_id=resolved_report_id, items=items)


def verify_evidence_payload(request: EvidenceVerifyRequest) -> EvidenceVerifyResponse:
    files_by_name: dict[str, ImagePayload] = {}
    for file_payload in request.files:
        if file_payload.filename:
            files_by_name[file_payload.filename] = file_payload

    checked: list[EvidenceVerifyItem] = []
    missing: list[str] = []

    for item in request.manifest.items:
        candidates = [item.name]
        filename = item.metadata.get("filename")
        if isinstance(filename, str):
            candidates.append(filename)

        payload = next((files_by_name[name] for name in candidates if name in files_by_name), None)
        if payload is None:
            checked.append(
                EvidenceVerifyItem(
                    name=item.name,
                    expected_sha256=item.sha256,
                    reason="matching file payload was not supplied",
                )
            )
            missing.append(item.name)
            continue

        data, _ = decode_image(payload)
        actual = sha256_bytes(data)
        checked.append(
            EvidenceVerifyItem(
                name=item.name,
                expected_sha256=item.sha256,
                actual_sha256=actual,
                matched=actual == item.sha256,
                reason=None if actual == item.sha256 else "sha256 mismatch",
            )
        )

    return EvidenceVerifyResponse(
        passed=bool(checked) and all(item.matched for item in checked),
        report_id=request.manifest.report_id,
        checked_items=checked,
        missing_items=missing,
    )
