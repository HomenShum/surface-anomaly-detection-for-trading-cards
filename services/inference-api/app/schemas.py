from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


class ImagePayload(BaseModel):
    image_base64: str = Field(..., description="Base64 encoded image bytes.")
    filename: str | None = Field(default=None, description="Optional original filename.")
    content_type: str | None = Field(default=None, description="Optional MIME content type.")


class NormalizeRequest(ImagePayload):
    pass


class AnalyzeRequest(ImagePayload):
    card_id: str | None = None
    report_id: str | None = None
    scan_session_id: str | None = None


class CompareRequest(BaseModel):
    baseline: ImagePayload
    candidate: ImagePayload
    card_id: str | None = None
    report_id: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str = "card-condition-vault-inference-api"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ModelsCurrentResponse(BaseModel):
    ding_detector: str
    normalizer: str
    mock: bool = False
    model_version: str
    weights_path: str | None = None
    weights_sha256: str | None = None
    dataset_manifest: str | None = None
    dataset_manifest_hash: str | None = None
    training_run_id: str
    label_map: list[str] = Field(default_factory=list)
    known_limitations: list[str] = Field(default_factory=list)
    yolo_weights_loaded: bool
    synthetic_weights_loaded: bool = False
    fallback_available: bool = False
    allow_mock_detector: bool = False
    require_real_model: bool = True
    disclaimer: str = (
        "This is a timestamped condition evidence record and AI-assisted condition estimate. "
        "It is not an official grade or legal guarantee."
    )


class EvidenceItem(BaseModel):
    name: str
    sha256: str
    content_type: str
    size_bytes: int
    uri: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvidenceManifest(BaseModel):
    manifest_version: str = "0.1"
    report_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    items: list[EvidenceItem]
    manifest_sha256: str
    model: dict[str, str] = Field(
        default_factory=lambda: {
            "ding_detector": "ding-detector-v0",
            "normalizer": "opencv-v0.1",
        }
    )
    disclaimer: str = (
        "This is a timestamped condition evidence record and AI-assisted condition estimate. "
        "It is not an official grade or legal guarantee."
    )


class NormalizedScan(BaseModel):
    width: int | None = None
    height: int | None = None
    image_base64: str
    sha256: str
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class NormalizeResponse(BaseModel):
    normalized: NormalizedScan
    evidence_manifest: EvidenceManifest


class EvidenceVerifyRequest(BaseModel):
    manifest: EvidenceManifest
    files: list[ImagePayload] = Field(default_factory=list)


class EvidenceVerifyItem(BaseModel):
    name: str
    expected_sha256: str
    actual_sha256: str | None = None
    matched: bool = False
    reason: str | None = None


class EvidenceVerifyResponse(BaseModel):
    passed: bool
    report_id: str
    checked_items: list[EvidenceVerifyItem]
    missing_items: list[str] = Field(default_factory=list)


class DefectFinding(BaseModel):
    kind: str
    confidence: float = Field(ge=0.0, le=1.0)
    severity: Literal["low", "medium", "high"] = "low"
    bbox: list[float] | None = Field(default=None, description="[x, y, width, height] in pixels.")
    description: str | None = None


class Report(BaseModel):
    report_id: str
    card_id: str | None = None
    scan_session_id: str | None = None
    input_sha256: str | None = None
    normalized_sha256: str | None = None
    model_version: str | None = None
    analysis_job_key: str | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    summary: str
    condition_score: float = Field(ge=0.0, le=100.0)
    findings: list[DefectFinding] = Field(default_factory=list)
    evidence_manifest: EvidenceManifest


class AnalyzeResponse(BaseModel):
    normalized: NormalizedScan
    report: Report


class CompareDelta(BaseModel):
    kind: str
    confidence: float = Field(ge=0.0, le=1.0)
    severity: Literal["low", "medium", "high"] = "low"
    description: str


class CompareReport(BaseModel):
    report_id: str
    card_id: str | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    summary: str
    changed: bool
    deltas: list[CompareDelta] = Field(default_factory=list)
    evidence_manifest: EvidenceManifest


class CompareResponse(BaseModel):
    baseline: NormalizedScan
    candidate: NormalizedScan
    report: CompareReport
