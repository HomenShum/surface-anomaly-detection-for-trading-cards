import base64
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.main import app


client = TestClient(app)
REPO_ROOT = Path(__file__).resolve().parents[3]
SYNTHETIC_CHECKPOINT = REPO_ROOT / "services" / "inference-api" / "app" / "models" / "synthetic_ding_cnn.pt"
DISCLAIMER_TEXT = "not an official grade or legal guarantee"


def _payload(data: bytes = b"card-image") -> dict[str, str]:
    return {
        "image_base64": base64.b64encode(data).decode("ascii"),
        "filename": "card.jpg",
        "content_type": "image/jpeg",
    }


def _png_payload() -> dict[str, str]:
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")

    image = np.full((320, 224, 3), 235, dtype=np.uint8)
    cv2.rectangle(image, (20, 20), (204, 300), (30, 30, 30), 4)
    cv2.line(image, (48, 72), (176, 248), (180, 180, 180), 3)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return {
        "image_base64": base64.b64encode(encoded.tobytes()).decode("ascii"),
        "filename": "synthetic-card.png",
        "content_type": "image/png",
    }


def _assert_manifest_required_fields(manifest: dict) -> None:
    assert manifest["manifest_version"]
    assert manifest["report_id"]
    assert manifest["created_at"]
    assert manifest["manifest_sha256"]
    assert len(manifest["manifest_sha256"]) == 64
    assert manifest["model"]["ding_detector"]
    assert manifest["model"]["normalizer"]
    assert DISCLAIMER_TEXT in manifest["disclaimer"]
    assert manifest["items"]
    for item in manifest["items"]:
        assert item["name"]
        assert len(item["sha256"]) == 64
        assert item["content_type"]
        assert item["size_bytes"] > 0
        assert "metadata" in item


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_vercel_service_prefix_health() -> None:
    response = client.get("/_/inference-api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_models_current_reports_launch_metadata() -> None:
    response = client.get("/models/current")

    assert response.status_code == 200
    body = response.json()
    assert body["ding_detector"] == "ding-detector-v0"
    assert body["model_version"] == "ding-detector-v0"
    assert body["mock"] is False
    assert body["yolo_weights_loaded"] is True
    assert body["fallback_available"] is False
    assert body["allow_mock_detector"] is False
    assert body["require_real_model"] is True
    assert body["training_run_id"]
    assert len(body["weights_sha256"]) == 64
    assert len(body["dataset_manifest_hash"]) == 64
    assert body["dataset_manifest"] == "ml\\datasets\\manifests\\roboflow_alpha_manifest.jsonl"
    assert "scratch" in body["label_map"]
    assert DISCLAIMER_TEXT in body["disclaimer"]


def test_normalize_returns_sha256_manifest() -> None:
    response = client.post("/scan/normalize", json=_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["normalized"]["sha256"] == hashlib.sha256(b"card-image").hexdigest()
    _assert_manifest_required_fields(body["evidence_manifest"])
    assert {item["name"] for item in body["evidence_manifest"]["items"]} == {"source", "normalized"}


def test_normalize_can_persist_artifacts(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CARD_CONDITION_PERSIST_ARTIFACTS", "true")
    monkeypatch.setenv("CARD_CONDITION_STORAGE_ROOT", str(tmp_path))

    response = client.post("/scan/normalize", json=_payload(b"persist-me"))

    assert response.status_code == 200
    manifest = response.json()["evidence_manifest"]
    uris = [item["uri"] for item in manifest["items"]]
    assert all(uri for uri in uris)
    for uri in uris:
        assert (tmp_path / uri).is_file()


def test_evidence_verify_passes_for_matching_payload() -> None:
    normalize_response = client.post("/scan/normalize", json=_payload(b"verify-me"))
    assert normalize_response.status_code == 200
    manifest = normalize_response.json()["evidence_manifest"]

    response = client.post(
        "/evidence/verify",
        json={
            "manifest": {
                **manifest,
                "items": [item for item in manifest["items"] if item["name"] == "source"],
            },
            "files": [_payload(b"verify-me")],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is True
    assert body["missing_items"] == []
    assert body["checked_items"][0]["matched"] is True


def test_evidence_verify_fails_for_hash_mismatch() -> None:
    normalize_response = client.post("/scan/normalize", json=_payload(b"original"))
    assert normalize_response.status_code == 200
    manifest = normalize_response.json()["evidence_manifest"]

    response = client.post(
        "/evidence/verify",
        json={
            "manifest": {
                **manifest,
                "items": [item for item in manifest["items"] if item["name"] == "source"],
            },
            "files": [_payload(b"tampered")],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is False
    assert body["checked_items"][0]["matched"] is False
    assert body["checked_items"][0]["reason"] == "sha256 mismatch"


def test_analyze_returns_report_json() -> None:
    response = client.post("/scan/analyze", json={**_payload(), "card_id": "card-1", "report_id": "report-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["report"]["report_id"] == "report-1"
    assert body["report"]["card_id"] == "card-1"
    assert body["report"]["input_sha256"] == hashlib.sha256(b"card-image").hexdigest()
    assert len(body["report"]["analysis_job_key"]) == 64
    assert "condition_score" in body["report"]
    assert body["report"]["evidence_manifest"]["report_id"] == "report-1"
    _assert_manifest_required_fields(body["report"]["evidence_manifest"])


def test_analyze_uses_real_model_without_mock_output(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("torch")
    if not SYNTHETIC_CHECKPOINT.is_file():
        pytest.skip("synthetic checkpoint is not present in this checkout")

    monkeypatch.setenv("CARD_CONDITION_SYNTHETIC_WEIGHTS", str(SYNTHETIC_CHECKPOINT))
    monkeypatch.setenv(
        "CARD_CONDITION_YOLO_WEIGHTS",
        str(REPO_ROOT / "services" / "inference-api" / "app" / "models" / "ding-detector-v0.pt"),
    )
    monkeypatch.setenv("CARD_CONDITION_MODEL_VERSION", "ding-detector-v0")
    monkeypatch.setenv("ALLOW_MOCK_DETECTOR", "false")

    models_response = client.get("/models/current")
    assert models_response.status_code == 200
    assert models_response.json()["mock"] is False

    response = client.post(
        "/scan/analyze",
        json={**_png_payload(), "card_id": "checkpoint-card", "report_id": "checkpoint-report"},
    )

    assert response.status_code == 200
    body = response.json()
    findings = body["report"]["findings"]
    assert all("mock" not in str(finding.get("description", "")).lower() for finding in findings)
    manifest = body["report"]["evidence_manifest"]
    assert manifest["model"]["ding_detector"] == "ding-detector-v0"
    _assert_manifest_required_fields(manifest)


def test_report_filters_card_boundary_label_from_ding_findings(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.pipelines import detector as detector_module
    from app.pipelines import report as report_module
    from app.pipelines.detector import Detection, DetectorResult

    def fake_detect_card_condition(*args, **kwargs) -> DetectorResult:
        return DetectorResult(
            detections=[
                Detection("card", 0.92, (1.0, 2.0, 200.0, 300.0), "test"),
                Detection("scratch", 0.74, (12.0, 20.0, 48.0, 64.0), "test"),
            ],
            model_loaded=True,
            metadata={"test": True},
        )

    monkeypatch.setattr(detector_module, "detect_card_condition", fake_detect_card_condition)

    findings = report_module._detect_with_pipeline(_png_payload()["image_base64"])

    assert [finding.kind for finding in findings] == ["scratch"]


def test_compare_identical_scans() -> None:
    response = client.post(
        "/scan/compare",
        json={"baseline": _payload(b"same"), "candidate": _payload(b"same"), "report_id": "compare-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["report"]["report_id"] == "compare-1"
    assert body["report"]["changed"] is False
    assert body["report"]["deltas"] == []
    _assert_manifest_required_fields(body["report"]["evidence_manifest"])


def test_compare_changed_scans() -> None:
    response = client.post(
        "/scan/compare",
        json={"baseline": _payload(b"before"), "candidate": _payload(b"after")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["report"]["changed"] is True
    assert body["report"]["deltas"][0]["kind"] == "image_hash"
