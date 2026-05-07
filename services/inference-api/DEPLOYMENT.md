# Inference API Deployment

The inference API is the public-launch critical service. Do not route real users to a laptop tunnel.

## Required Health Contract

The deployed service must expose:

- `GET /health`
- `GET /models/current`
- `POST /scan/analyze`
- `POST /evidence/verify`

`/models/current` must report `mock=false`, `allow_mock_detector=false`, `require_real_model=true`, a weights hash, a dataset manifest hash, and the training run ID.

## Container

Build from the repo root:

```bash
docker build -f services/inference-api/Dockerfile -t card-condition-vault-inference .
docker run --rm -p 8000:8000 \
  -e ALLOW_MOCK_DETECTOR=false \
  -e REQUIRE_REAL_MODEL=true \
  -e CARD_CONDITION_PERSIST_ARTIFACTS=true \
  -e CARD_CONDITION_ALLOWED_ORIGINS=https://card-condition-vault.vercel.app \
  card-condition-vault-inference
```

## Vercel Link

Set these on the Vercel web app:

```text
INFERENCE_API_URL=https://<durable-inference-host>
INFERENCE_API_TIMEOUT_MS=8000
INFERENCE_API_RETRIES=2
NEXT_PUBLIC_CONVEX_URL=https://<convex-deployment>
CONVEX_URL=https://<convex-deployment>
```

For browser-direct local testing you can also set `NEXT_PUBLIC_INFERENCE_API_URL`, but production should normally use the Vercel proxy at `/api/inference` so retries, timeout, and structured degraded errors stay server-side.

## Persistence

The container supports local artifact persistence with:

```text
CARD_CONDITION_PERSIST_ARTIFACTS=true
CARD_CONDITION_STORAGE_ROOT=/workspace/storage
```

For a public launch, mount that path on durable storage or replace it with provider object storage. Reports remain honest if storage fails, but no launch should claim evidence-vault durability without mounted or remote storage.
