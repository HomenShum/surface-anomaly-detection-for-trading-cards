FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CARD_CONDITION_MODEL_VERSION=ding-detector-v0 \
    CARD_CONDITION_YOLO_WEIGHTS=/workspace/services/inference-api/app/models/ding-detector-v0.pt \
    CARD_CONDITION_STORAGE_ROOT=/workspace/storage \
    ALLOW_MOCK_DETECTOR=false \
    REQUIRE_REAL_MODEL=true

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY services/inference-api ./services/inference-api
COPY ml ./ml

RUN pip install ".[ml]"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "services/inference-api", "--host", "0.0.0.0", "--port", "8000"]
