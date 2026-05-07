# Production Ready Plan

This is the long-term production architecture for Card Condition Vault. It is intentionally separate from the no-cost MVP demo path in `docs/MVP_LAPTOP_DEMO_PLAN.md`.

## Decision

Adopt a four-layer production stack:

1. Vercel keeps the Next.js web shell.
2. AWS Fargate behind ALB + ACM hosts FastAPI inference and Temporal workers.
3. Temporal Cloud orchestrates the scan pipeline as durable workflows.
4. S3 Object Lock + DuckDB-on-Parquet provide immutable evidence storage and analytics.

Provision the cloud stack with Terraform. Keep Docker as the portable build artifact for inference and worker containers.

## Why This Stack

Temporal is the right primitive for scan orchestration because it persists workflow state and can resume after process, network, or infrastructure failures. The scan checklist should become workflow state, not local React timers.

AWS Fargate is the right first durable container host because it avoids Kubernetes operations while still supporting ECS services, autoscaling, and ALB-backed HTTP/HTTPS routing. AWS documentation states ECS services on Fargate support Application Load Balancers for HTTP/HTTPS traffic, and Fargate tasks use `awsvpc` networking with `ip` target groups.

S3 Object Lock gives evidence records a stronger trust story than hashes alone. AWS documents Object Lock as a WORM model that prevents object deletion or overwrite for a retention period, with compliance mode preventing even the root user from shortening retention.

DuckDB is a good analytics layer for this stage because its `httpfs` extension can read, write, and glob S3-backed Parquet files. This keeps catalog analytics and model-drift queries cheap before introducing a warehouse.

Terraform makes the AWS stack reproducible. The goal is not just "it works once"; the goal is that staging or a second region can be rebuilt from source-controlled infrastructure.

## Target Architecture

```text
Browser
  -> Vercel Next.js app
  -> /api/inference proxy for health and workflow enqueue
  -> ALB + ACM HTTPS endpoint
  -> ECS/Fargate inference-api service
  -> Temporal Cloud namespace
  -> ECS/Fargate temporal-worker service
  -> S3 evidence bucket with Object Lock + KMS
  -> S3 analytics bucket with partitioned Parquet
  -> DuckDB httpfs queries from API/worker tasks
  -> Convex for live UI subscriptions and operational records
```

## Workflow Shape

Production should replace the synchronous `/scan/analyze` path with a durable workflow:

```text
ScanWorkflow
  1. intake_activity
  2. quality_gates_activity
  3. normalize_activity
  4. ding_detect_activity
  5. confidence_score_activity
  6. build_evidence_activity
  7. catalog_update_activity
  8. analytics_append_activity
```

Workflow id:

```text
scan-{input_sha256}-{model_version}
```

The existing app already emits the required idempotency fields:

```text
scan_session_id
input_sha256
normalized_sha256
model_version
analysis_job_key
```

## Temporal Design

Use Temporal Cloud first. Self-hosting Temporal can come later if cost or lock-in becomes material.

Workflow rules:

- Each activity has a `start_to_close_timeout`.
- All external I/O happens in activities, not in workflow code.
- Activities are idempotent by `analysis_job_key`.
- Long model steps heartbeat progress so cancellation and retry are visible.
- Workflow queries expose the current checklist stage to the UI.
- Workflow start uses a stable workflow id so duplicate submissions attach to existing work instead of running twice.

Python pseudocode:

```python
@workflow.defn
class ScanWorkflow:
    @workflow.run
    async def run(self, scan: ScanInput) -> ScanResult:
        intake = await workflow.execute_activity(
            intake_activity,
            scan,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        quality = await workflow.execute_activity(quality_gates_activity, intake, ...)
        normalized = await workflow.execute_activity(normalize_activity, quality, ...)
        detections = await workflow.execute_activity(
            ding_detect_activity,
            normalized,
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        scored = await workflow.execute_activity(confidence_score_activity, detections, ...)
        manifest = await workflow.execute_activity(build_evidence_activity, scored, ...)
        catalog = await workflow.execute_activity(catalog_update_activity, manifest, ...)
        return ScanResult(manifest=manifest, catalog=catalog)
```

## Docker

Already implemented:

- `services/inference-api/Dockerfile`
- `docker-compose.yml`
- `render.yaml`

Production additions:

```text
services/temporal-worker/Dockerfile
services/temporal-worker/app/workflows.py
services/temporal-worker/app/activities.py
services/temporal-worker/app/main.py
```

Inference image policy:

- Bake `ding-detector-v0.pt` for small alpha images.
- Move weights to S3 at larger scale to avoid large ECR layer churn.
- Fail closed when `ALLOW_MOCK_DETECTOR=false` and weights are missing.

## AWS Fargate

Services:

```text
inference-api
  min: 1
  max: 4
  cpu: 2048
  memory: 4096
  health: /health

temporal-worker
  min: 1
  max: 8
  cpu: 1024
  memory: 2048
  launch type: Fargate or Fargate Spot for non-inference work
```

Networking:

- Public ALB with ACM cert for `infer.cardconditionvault.com`.
- Fargate tasks in private subnets.
- ALB target group target type `ip`.
- Security group allows ALB -> inference task on 8000.
- Worker has outbound access to Temporal Cloud, S3, Convex, and model storage.

## S3 Evidence Store

Bucket: `cv-evidence-{account}-{region}`.

Settings:

- Versioning enabled.
- Object Lock enabled at bucket creation.
- Compliance retention for production evidence.
- Governance retention in staging.
- KMS customer-managed key.
- Lifecycle transition to IA and Glacier.

Key layout:

```text
sha256/{first2}/{rest}.{ext}
reports/{yyyy}/{mm}/{dd}/{report_id}.json
overlays/{yyyy}/{mm}/{dd}/{report_id}.png
```

Verifier:

- Fetches S3 object bytes.
- Recomputes SHA-256.
- Compares to manifest.
- Returns `passed: true` only when all supplied or stored bytes match.

## DuckDB Analytics

Analytics bucket: `cv-analytics-{account}-{region}`.

Parquet layout:

```text
s3://cv-analytics/scans/year=YYYY/month=MM/day=DD/*.parquet
s3://cv-analytics/detections/year=YYYY/month=MM/day=DD/*.parquet
s3://cv-analytics/model_runs/year=YYYY/month=MM/day=DD/*.parquet
```

Query example:

```sql
INSTALL httpfs;
LOAD httpfs;

SELECT card_id, title, game, scanned_at, confidence, detections_count
FROM read_parquet('s3://cv-analytics/scans/year=*/month=*/*.parquet')
WHERE game = COALESCE($game, game)
ORDER BY scanned_at DESC
LIMIT 200;
```

Rules:

- One Temporal materialization workflow owns writes for a partition.
- API endpoints are read-only DuckDB queries.
- Convex keeps the live app state; DuckDB serves analytical views like drift, movers, and historical summaries.

## Terraform Modules

Planned tree:

```text
infra/terraform/
  main.tf
  modules/
    network/
    ecr/
    alb-https/
    fargate-service/
    s3-evidence/
    s3-analytics/
    temporal-cloud/
    observability/
    secrets/
  envs/
    staging/main.tf
    prod/main.tf
```

Guardrails:

- `prevent_destroy = true` on evidence buckets and KMS keys.
- Remote Terraform state in S3 with DynamoDB locking.
- Separate staging and prod state.
- No `terraform destroy` for evidence resources without explicit human approval.

## Phased Delivery

### Phase 1: Durable Inference

- Push inference image to ECR.
- Deploy ECS/Fargate service behind ALB + ACM.
- Set Vercel `INFERENCE_API_URL`.
- Run `pnpm qa:launch` against deployed web and inference.

Exit: `/models/current` returns `mock=false` from public HTTPS and scan analysis succeeds.

### Phase 2: Temporal

- Add worker image.
- Add `ScanWorkflow`.
- Add workflow enqueue/status endpoints.
- Drive the 14-stage checklist from workflow status.

Exit: kill a worker mid-scan; another worker resumes and completes it.

### Phase 3: S3 Evidence

- Write original and normalized bytes to Object-Locked S3.
- Store S3 URIs in manifests.
- Verify against S3 bytes.

Exit: verifier passes after reading evidence bytes back from S3.

### Phase 4: DuckDB Analytics

- Write scan and detection parquet.
- Add catalog/movers/drift endpoints.
- Replace landing mock tables with real query results.

Exit: landing "movers" and model drift use real scan data.

### Phase 5: Terraform + CI

- Add Terraform modules.
- Add deploy workflow.
- Require smoke tests before prod promotion.

Exit: a fresh AWS account can recreate the stack from Terraform.

## MVP Boundary

Do not implement this stack before the friend demo. For MVP, keep:

- Vercel or localhost web.
- Laptop-hosted FastAPI.
- Existing real `ding-detector-v0`.
- Existing health pill and `pnpm qa:launch`.

This plan becomes the next architecture milestone after the product story is validated.

## Sources Checked

- Temporal docs describe durable execution that resumes after crashes or outages: https://docs.temporal.io/
- Temporal Python SDK API includes `RetryPolicy` and workflow id conflict/reuse controls: https://python.temporal.io/
- AWS ECS docs state Fargate services support Application Load Balancers for HTTP/HTTPS and require `ip` target groups with `awsvpc`: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html
- AWS S3 Object Lock docs describe WORM retention and compliance mode immutability: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- DuckDB `httpfs` docs describe S3 reads, writes, globbing, and Parquet support: https://duckdb.org/docs/current/core_extensions/httpfs/s3api.html
