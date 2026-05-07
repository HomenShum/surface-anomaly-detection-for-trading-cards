# Production Fault Tolerance

Card Condition Vault should not depend on a laptop tunnel for any real public launch. The production shape should make upload, analysis, evidence storage, and report generation recoverable even when one service is slow or offline.

## Current In-Repo Status

Implemented in this repo:

- FastAPI Docker image: `services/inference-api/Dockerfile`
- Render-style service contract: `render.yaml`
- Docker Compose real-model local run: `docker-compose.yml`
- Vercel proxy retries, timeout, idempotency-key forwarding, and structured upstream-down errors: `apps/web/app/api/inference/[...path]/route.ts`
- Analysis idempotency fields: `scan_session_id`, `input_sha256`, `normalized_sha256`, `model_version`, `analysis_job_key`
- Convex idempotency index: `scanSessions.by_analysis_job_key`
- Optional local artifact persistence: `CARD_CONDITION_PERSIST_ARTIFACTS=true`
- Executable launch check: `pnpm qa:launch`

Still external to the repo:

- Provisioning a durable HTTPS inference host.
- Setting production Vercel env vars to that host.
- Replacing local mounted storage with provider object storage if the chosen host does not provide durable volumes.
- Real-device iOS Safari and Android Chrome QA.

## Target Architecture

```text
User browser
  -> Vercel Next.js app
  -> Convex Cloud scan job + live status
  -> Object storage for originals, normalized images, overlays, packets
  -> Durable inference worker pool
  -> Convex report/evidence records
  -> Vercel UI subscribes to job status and renders the checklist
```

Use Vercel for the web app and API facade only. Do not run Torch/Ultralytics inside Vercel Functions. Host inference on a container platform that supports the model runtime cleanly, such as Modal, RunPod, Fly.io Machines, Render, Cloud Run, or a small dedicated GPU/CPU VM.

## Request Model

The public app should not block the browser on `/scan/analyze` for the full model run.

1. Browser uploads the selected still image to object storage.
2. Vercel creates a `scanJobs` record in Convex with `status: "queued"`.
3. Worker claims the job idempotently by `scanSessionId` and input image hash.
4. Worker updates statuses:
   - `uploaded`
   - `quality_check`
   - `normalizing`
   - `model_queued`
   - `model_running`
   - `hashing_evidence`
   - `report_ready`
   - `saved`
5. UI renders those updates as the live checklist.
6. If a step fails, the job stays visible with `status: "needs_retry"` or `status: "failed"`, not a blank report.

## Failure Policy

| Failure | User result | System behavior |
| --- | --- | --- |
| Inference worker down | Upload is saved, analysis shows pending | Job remains queued, worker health alarm fires |
| Model timeout | Checklist marks inference retrying | Retry with backoff, then fail with honest message |
| Convex write failure | Browser keeps local draft | Retry save and show unsynced state |
| Object storage write failure | Upload rejected before model run | No report is created without stored evidence |
| Partial report failure | Preserve normalized image and model output | Report builder can be retried idempotently |
| Missing weights | No fake detections | Launch mode fails closed unless demo mode is explicit |
| LLM agent outage | Deterministic explainer fallback | Report data remains authoritative |

## Idempotency

Every write path needs a stable key:

```text
scanSessionId = uuid
inputHash = sha256(original image bytes)
analysisJobKey = scanSessionId + inputHash + modelVersion
reportVersion = integer
```

Workers must be safe to rerun. If a retry sees the same `analysisJobKey`, it should reuse already-written artifacts or overwrite only the same deterministic output paths.

## Runtime Controls

Required production env:

```text
ALLOW_MOCK_DETECTOR=false
REQUIRE_REAL_MODEL=true
ENABLE_FULL_VIDEO_STORAGE=false
ENABLE_REPORT_DISCLAIMER=true
INFERENCE_API_URL=https://durable-inference-host.example.com
INFERENCE_API_TIMEOUT_MS=8000
INFERENCE_API_RETRIES=2
CARD_CONDITION_ALLOWED_ORIGINS=https://card-condition-vault.vercel.app
CARD_CONDITION_PERSIST_ARTIFACTS=true
CONVEX_DEPLOYMENT=<project-owned deployment>
OBJECT_STORAGE_BUCKET=<immutable evidence bucket>
```

The Vercel proxy uses short timeouts and returns structured degraded states:

```json
{
  "error": "inference_upstream_unavailable",
  "status": "degraded",
  "message": "Inference upstream timed out after 8000ms.",
  "upstream": "https://durable-inference-host.example.com",
  "attempts": 3,
  "retry_after_ms": 2000
}
```

## Observability

Track these metrics before public launch:

- upload success rate
- time from upload to `report_ready`
- inference timeout rate
- queue depth and oldest queued job age
- report generation success rate
- evidence manifest hash verification failures
- Convex write failures
- object storage write/read failures
- LLM assistant fallback rate

Page on:

- model worker health check failing for 3 consecutive probes
- oldest queued job older than 5 minutes
- report generation success below 98% over 30 minutes
- evidence hash mismatch count greater than 0

## Minimum Launch Upgrade

For a real public launch, replace the current tunnel-backed alpha with:

1. Convex Cloud deployment owned by this project.
2. Durable object storage for images and reports.
3. Containerized inference service with `/health`, `/models/current`, and `/scan/analyze`.
4. Queue-backed scan jobs with Convex live status.
5. UI checklist driven by persisted job status, not only local component state.
6. Replayable worker tests using the Roboflow sample fixtures.
