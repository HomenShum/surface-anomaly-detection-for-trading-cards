from __future__ import annotations

import base64

from app.pipelines.evidence import build_evidence_item, build_manifest, decode_image, normalize_payload
from app.schemas import CompareDelta, CompareReport, CompareRequest, NormalizedScan


def _delta_from_hashes(baseline: NormalizedScan, candidate: NormalizedScan) -> list[CompareDelta]:
    if baseline.sha256 == candidate.sha256:
        return []
    return [
        CompareDelta(
            kind="image_hash",
            confidence=1.0,
            severity="medium",
            description="Normalized image evidence differs between baseline and candidate.",
        )
    ]


def compare_scans(request: CompareRequest) -> tuple[NormalizedScan, NormalizedScan, CompareReport]:
    baseline = normalize_payload(request.baseline)
    candidate = normalize_payload(request.candidate)

    try:
        from app.compare import compare_normalized_scans  # type: ignore

        raw_deltas = compare_normalized_scans(baseline.model_dump(), candidate.model_dump())
        deltas = [CompareDelta.model_validate(delta) for delta in raw_deltas]
    except Exception:
        deltas = _delta_from_hashes(baseline, candidate)

    baseline_bytes, _ = decode_image(request.baseline)
    candidate_bytes, _ = decode_image(request.candidate)
    baseline_normalized_bytes = base64.b64decode(baseline.image_base64)
    candidate_normalized_bytes = base64.b64decode(candidate.image_base64)
    items = [
        build_evidence_item(
            name="baseline_source",
            data=baseline_bytes,
            content_type=request.baseline.content_type or "application/octet-stream",
            metadata={"filename": request.baseline.filename} if request.baseline.filename else {},
        ),
        build_evidence_item(
            name="candidate_source",
            data=candidate_bytes,
            content_type=request.candidate.content_type or "application/octet-stream",
            metadata={"filename": request.candidate.filename} if request.candidate.filename else {},
        ),
        build_evidence_item(
            name="baseline_normalized",
            data=baseline_normalized_bytes,
            content_type=request.baseline.content_type or "application/octet-stream",
            metadata=baseline.metadata,
        ),
        build_evidence_item(
            name="candidate_normalized",
            data=candidate_normalized_bytes,
            content_type=request.candidate.content_type or "application/octet-stream",
            metadata=candidate.metadata,
        ),
    ]
    manifest = build_manifest(report_id=request.report_id, items=items)
    changed = bool(deltas)
    report = CompareReport(
        report_id=manifest.report_id,
        card_id=request.card_id,
        summary="Candidate differs from baseline." if changed else "Candidate matches baseline.",
        changed=changed,
        deltas=deltas,
        evidence_manifest=manifest,
    )
    return baseline, candidate, report
