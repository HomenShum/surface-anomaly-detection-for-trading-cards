# Card Condition Vault

Local-first, laptop-friendly MVP for scanning trading cards, detecting visible DINGS, saving catalog records, and generating timestamped evidence reports.

This is not an official PSA, TAG, CGC, or BGS grade. It is an AI-assisted condition catalog and evidence vault.

## What ships in the MVP

- Mobile-first scanner with selected still-frame capture, not full video storage by default.
- FastAPI inference service with card normalization, `ding-detector-v0` served by default, no silent mock detections in launch mode, YOLO fine-tune path, and evidence manifest generation.
- Card catalog, condition report, DING correction flow, and before/after comparison surfaces.
- Dataset ingestion scripts and a universal DING ontology.
- Dogfood scripts that seed demo data, capture demo artifacts, and generate submission-ready docs.

## 3-minute demo

Controlled-alpha URL:

```text
https://card-condition-vault.vercel.app/workspace
```

The public web app is a controlled alpha. The repo now includes the durable inference container contract, retrying Vercel proxy, Convex idempotency keys, local artifact persistence, and an executable launch-blocker check. A public SaaS launch still requires setting the production `INFERENCE_API_URL` to a durable HTTPS container host and using a project-owned Convex deployment.

```bash
pnpm install
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[test]"
pnpm demo:seed
pnpm dev:api
pnpm dev
```

Then open `http://localhost:3000`, choose **Try Sample Card**, run analysis, save the catalog entry, open the evidence report, and run the before/after demo.

## Common commands

```bash
pnpm dev              # Next.js web app
pnpm dev:api          # FastAPI inference API
pnpm dev:api:reload   # API with reload when your shell allows file watchers
pnpm test:api         # API and CV smoke tests
pnpm dogfood          # product + demo QA checklist
pnpm showcase:packet  # generate easier-to-read QA packet from local templates
pnpm showcase:remotion:render  # render public/demo/card-condition-vault-showcase.mp4
pnpm demo:submission  # generate submission package docs
pnpm qa:launch         # verify health, real model, sample analysis, hashes, and Next proxy
pnpm demo:laptop:check # same launch-blocker check, named for the friend demo
pnpm eval:model        # object-level baseline/per-class/per-region eval for ding-detector-v0
pnpm qa:evolution      # verify controlled agent skill-evolution promotion gates
pnpm qa:methods        # verify open-source methods have benchmark proof before public credit
python ml/scripts/ingest_roboflow.py               # download/manifest verified Roboflow alpha sources with ROBOFLOW_API_KEY
python ml/scripts/train_yolo.py --data ml/datasets/yolo/roboflow_alpha/dataset.yaml --model yolov8n.pt --imgsz 512 --epochs 8 --batch 4 --device cpu --project runs/ding-detector-v0 --name roboflow-alpha-cpu-8-512 --output services/inference-api/app/models/ding-detector-v0.pt --metrics services/inference-api/app/models/ding-detector-v0.metrics.json
```

For a no-cost friend demo that runs from your laptop, follow `docs/MVP_LAPTOP_DEMO_PLAN.md`. Keep `docs/PRODUCTION_READY_PLAN.md` for the later fault-tolerant AWS/Temporal/S3/DuckDB stack.

Served alpha model proof:

- Model: `ding-detector-v0`
- Training run: `yolo-20260506T124111Z`
- Dataset manifest hash: `24e62f76baf046c7d3ec83d147bbe4fb0a252b4cd06c77cd7ac13e61add28fa2`
- Weights hash: `7b9e0f62007b6d595d9aa7e9eb9596a19e9a2e51dfe7f9433abe74a9febe1a2d`
- Metrics: mAP50 `0.46374`, mAP50-95 `0.27864`, precision `0.62639`, recall `0.44897`

## Controlled alpha launch gates

- `ALLOW_MOCK_DETECTOR=false`
- `REQUIRE_REAL_MODEL=true`
- `/models/current` must return `mock=false`, a weights hash, dataset manifest hash, training run ID, and visible limitations.
- `ROBOFLOW_API_KEY` is required to download the verified Roboflow Card Grader v5 and Pokemon Surface Damage Detection v2 exports. The repo does not fake those records when the key is missing.
- `OPENROUTER_API_KEY` enables the pi-ai/OpenRouter Gemma report assistant. Without it, the app uses a deterministic local explainer that still refuses grading/legal claims.

See `docs/PRODUCTION_FAULT_TOLERANCE.md` before inviting public traffic. The current alpha URL is useful for demos, but durable production needs Convex Cloud, object storage, a containerized inference worker, queued scan jobs, retries, and health checks.

`docs/INSPECTION_SKILL_EVOLUTION.md` defines the controlled self-improvement loop for pi-ai-proposed crop, zoom, glare, and reinspection methods. The agent can propose candidates, but shared skills require benchmark records and human-approved production promotion.

The public community layer is `/methods`. It showcases benchmarked open-source inspection methods, contributor rewards, and bounties. The source registry lives under `inspection-methods/`, and `pnpm qa:methods` blocks verified/canary/production status when benchmark proof or safety checks are missing.

## Inference deployment

The FastAPI service is containerized at `services/inference-api/Dockerfile`. For local container testing:

```bash
docker compose up --build inference-api
```

For a hosted alpha, deploy the same Dockerfile to a container host and set these web env vars:

```text
INFERENCE_API_URL=https://<durable-inference-host>
INFERENCE_API_TIMEOUT_MS=8000
INFERENCE_API_RETRIES=2
NEXT_PUBLIC_CONVEX_URL=https://<convex-deployment>
CONVEX_URL=https://<convex-deployment>
```

The Next proxy at `/api/inference/*` fails closed in production when `INFERENCE_API_URL` is missing, but falls back to `http://127.0.0.1:8000` for localhost dogfood.

## Design harness

The product uses `nexu-io/open-design` as the design discipline: Modern minimal + Tech utility for the app shell, Editorial for evidence reports, honest placeholders, P0/P1/P2 QA gates, and artifact lint before docs or screenshots are accepted.

Vendor setup:

```bash
git submodule add https://github.com/nexu-io/open-design vendor/open-design
git submodule add https://github.com/HomenShum/easier-to-read-submissions vendor/easier-to-read-submissions
```

If `HomenShum/easier-to-read-submissions` is private or unavailable, the local scripts in `scripts/demo` provide a compatible fallback interface for repo descriptions, demo GIFs, and step-by-step demo docs.

## Licensing notes

Roboflow Card Grader v5 and Pokemon Surface Damage Detection v2 are tracked as CC BY 4.0 alpha sources in `docs/DATASETS.md`; export access still requires a Roboflow API key. Other public datasets such as PSA Baseball Grades, MVTec AD, MVTec AD 2, Anomalib examples, and future forks need source-specific review before shipping beyond private prototype use.

Ultralytics YOLO is documented by Ultralytics as AGPL-3.0 with enterprise licensing options. Treat YOLO training and trained weights as prototype-only until legal review confirms the commercial path.

## No-secrets rule

Copy `.env.example` to `.env.local` or `.env` and keep provider secrets local. No secrets should be committed.
