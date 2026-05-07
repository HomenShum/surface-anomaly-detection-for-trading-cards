from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
XLARGE_CHECKPOINT = ROOT / "services/inference-api/app/models/synthetic_ding_cnn_xlarge.pt"
XLARGE_METRICS = ROOT / "services/inference-api/app/models/synthetic_ding_cnn_xlarge.metrics.json"


def test_xlarge_checkpoint_loads_when_present() -> None:
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")

    if not XLARGE_CHECKPOINT.is_file():
        pytest.skip("xlarge synthetic checkpoint has not been trained")

    from app.models.synthetic_ding import predict_with_checkpoint

    image = np.full((320, 224, 3), 238, dtype=np.uint8)
    cv2.rectangle(image, (20, 20), (204, 300), (40, 45, 48), 4)
    cv2.line(image, (58, 130), (168, 158), (60, 60, 60), 2)

    prediction = predict_with_checkpoint(image, str(XLARGE_CHECKPOINT))

    assert prediction.label
    assert 0.0 <= prediction.confidence <= 1.0
    left, top, right, bottom = prediction.bbox_xyxy
    assert right > left
    assert bottom > top
    assert XLARGE_METRICS.is_file()
