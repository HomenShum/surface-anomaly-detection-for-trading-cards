from __future__ import annotations

import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import base64

from pydantic import BaseModel, Field

from app.pipelines.compare import compare_scans
from app.pipelines.evidence import manifest_for_normalized_scan, normalize_payload, verify_evidence_payload
from app.pipelines.labels import detect_labels_in_bytes
from app.pipelines.report import build_report
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CompareRequest,
    CompareResponse,
    EvidenceVerifyRequest,
    EvidenceVerifyResponse,
    HealthResponse,
    ImagePayload,
    ModelsCurrentResponse,
    NormalizeRequest,
    NormalizeResponse,
)

app = FastAPI(title="Card Condition Vault Inference API", version="1.0.0")
router = APIRouter()

default_allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3006",
    "http://127.0.0.1:3006",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
]
configured_allowed_origins = [
    origin.strip()
    for origin in os.environ.get("CARD_CONDITION_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_allowed_origins or default_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/models/current", response_model=ModelsCurrentResponse)
def models_current() -> ModelsCurrentResponse:
    from app.pipelines.model_metadata import current_model_metadata

    return ModelsCurrentResponse.model_validate(current_model_metadata())


@router.post("/scan/normalize", response_model=NormalizeResponse)
def normalize_scan(request: NormalizeRequest) -> NormalizeResponse:
    normalized = normalize_payload(request)
    manifest = manifest_for_normalized_scan(report_id=None, source=request, normalized=normalized)
    return NormalizeResponse(normalized=normalized, evidence_manifest=manifest)


@router.post("/evidence/verify", response_model=EvidenceVerifyResponse)
def verify_evidence(request: EvidenceVerifyRequest) -> EvidenceVerifyResponse:
    return verify_evidence_payload(request)


@router.post("/scan/analyze", response_model=AnalyzeResponse)
def analyze_scan(request: AnalyzeRequest) -> AnalyzeResponse:
    normalized, report = build_report(request)
    return AnalyzeResponse(normalized=normalized, report=report)


@router.post("/scan/compare", response_model=CompareResponse)
def compare_scan(request: CompareRequest) -> CompareResponse:
    baseline, candidate, report = compare_scans(request)
    return CompareResponse(baseline=baseline, candidate=candidate, report=report)


# ─── Cert label detection ─────────────────────────────────────────────────


class DetectCertLabelsRequest(ImagePayload):
    run_ocr: bool = Field(default=True, description="Run Tesseract OCR on each crop.")
    include_thumbnails: bool = Field(default=True, description="Return base64 thumbnails of each crop.")


class DetectedCertLabel(BaseModel):
    index: int
    bbox: list[int]
    crop_base64: str | None = None
    ocr_text: str = ""
    candidate_certs: list[str] = Field(default_factory=list)
    candidate_grades: list[str] = Field(default_factory=list)


class DetectCertLabelsResponse(BaseModel):
    image_size: list[int]
    labels: list[DetectedCertLabel]
    ocr_run: bool
    unique_certs: list[str]


@router.post("/certs/detect-labels", response_model=DetectCertLabelsResponse)
def detect_cert_labels(request: DetectCertLabelsRequest) -> DetectCertLabelsResponse:
    try:
        image_bytes = base64.b64decode(request.image_base64)
    except Exception as exc:  # noqa: BLE001 - friendly API surface
        raise ValueError(f"invalid base64 image payload: {exc}") from exc
    result = detect_labels_in_bytes(
        image_bytes,
        run_ocr=request.run_ocr,
        include_thumbnails=request.include_thumbnails,
    )
    return DetectCertLabelsResponse(
        image_size=list(result.image_size),
        labels=[
            DetectedCertLabel(
                index=label.index,
                bbox=list(label.bbox),
                crop_base64=label.crop_base64,
                ocr_text=label.ocr_text,
                candidate_certs=label.candidate_certs,
                candidate_grades=label.candidate_grades,
            )
            for label in result.labels
        ],
        ocr_run=result.ocr_run,
        unique_certs=result.unique_certs,
    )


app.include_router(router)
app.include_router(router, prefix="/_/inference-api")
