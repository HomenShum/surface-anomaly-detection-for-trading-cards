from __future__ import annotations

import hashlib

from app.pipelines.evidence import manifest_for_normalized_scan, normalize_payload
from app.pipelines.model_metadata import env_bool
from app.pipelines.model_metadata import current_model_metadata
from app.schemas import AnalyzeRequest, DefectFinding, NormalizedScan, Report


NON_DING_LABELS = {
    "card",
    "trading_card",
    "trading-card",
    "card_front",
    "card_back",
    "slab",
    "label",
    "psa_label",
}


def _is_ding_label(label: str | None) -> bool:
    normalized = str(label or "").strip().lower().replace(" ", "_")
    return normalized not in NON_DING_LABELS


def _fallback_findings(normalized_sha256: str) -> list[DefectFinding]:
    marker = int(normalized_sha256[:2], 16)
    if marker < 32:
        return [
            DefectFinding(
                kind="surface",
                confidence=0.35,
                severity="low",
                description="Fallback detector flagged a possible low-severity surface variation.",
            )
        ]
    return []


def detect_findings(normalized_image_base64: str, normalized_sha256: str) -> list[DefectFinding]:
    try:
        from app.detectors import detect_surface_anomalies  # type: ignore

        raw_findings = detect_surface_anomalies(normalized_image_base64)
        findings = [DefectFinding.model_validate(finding) for finding in raw_findings]
        return [finding for finding in findings if _is_ding_label(finding.kind)]
    except Exception:
        pass

    try:
        return _detect_with_pipeline(normalized_image_base64)
    except Exception:
        if not env_bool("ALLOW_MOCK_DETECTOR", default=False):
            return []
        return _fallback_findings(normalized_sha256)


def _detect_with_pipeline(normalized_image_base64: str) -> list[DefectFinding]:
    import base64
    import os

    import cv2  # type: ignore
    import numpy as np

    from app.pipelines.detector import detect_card_condition

    raw_bytes = base64.b64decode(normalized_image_base64)
    image_array = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_array is None:
        raise ValueError("unable to decode normalized image bytes")

    result = detect_card_condition(
        image_array,
        weights_path=os.environ.get("CARD_CONDITION_YOLO_WEIGHTS", "services/inference-api/app/models/ding-detector-v0.pt"),
    )
    findings: list[DefectFinding] = []
    for detection in result.detections:
        if not _is_ding_label(detection.label):
            continue
        severity = "medium" if detection.confidence >= 0.5 else "low"
        findings.append(
            DefectFinding(
                kind=detection.label,
                confidence=detection.confidence,
                severity=severity,
                bbox=list(detection.bbox),
                description=f"{detection.label} detected by {detection.source}.",
            )
        )
    return findings


def build_report(request: AnalyzeRequest) -> tuple[NormalizedScan, Report]:
    normalized = normalize_payload(request)
    findings = detect_findings(normalized.image_base64, normalized.sha256)
    score = max(0.0, 100.0 - sum({"low": 5.0, "medium": 15.0, "high": 30.0}[f.severity] for f in findings))
    summary = (
        "No DING candidates exceeded the current model threshold; this is not proof the card is clean."
        if not findings
        else f"{len(findings)} possible DING candidate(s) detected."
    )
    manifest = manifest_for_normalized_scan(report_id=request.report_id, source=request, normalized=normalized)
    source_item = next((item for item in manifest.items if item.name == "source"), None)
    input_sha256 = source_item.sha256 if source_item is not None else None
    model_version = str(current_model_metadata().get("model_version", "ding-detector-v0"))
    scan_session_id = request.scan_session_id or request.report_id or manifest.report_id
    analysis_job_key = (
        hashlib.sha256(f"{scan_session_id}:{input_sha256}:{model_version}".encode("utf-8")).hexdigest()
        if input_sha256
        else None
    )
    return normalized, Report(
        report_id=manifest.report_id,
        card_id=request.card_id,
        scan_session_id=request.scan_session_id,
        input_sha256=input_sha256,
        normalized_sha256=normalized.sha256,
        model_version=model_version,
        analysis_job_key=analysis_job_key,
        summary=summary,
        condition_score=score,
        findings=findings,
        evidence_manifest=manifest,
    )
