# Card Condition Vault Dogfood Runbook

## Purpose

This runbook describes the local QA and dogfood flow for Card Condition Vault.
It is designed to work even when optional private integrations are unavailable.

## Generate Demo Artifacts

```bash
pnpm demo:seed
pnpm demo:gifs
```

Outputs:

- `public/demo/seed-data/cards.json`
- `public/demo/seed-data/demo-state.json`
- `public/demo/gifs/manifest.json`

`pnpm demo:gifs` builds the web app, starts a temporary production server on
`http://127.0.0.1:3100`, records seven descriptive browser flows, mirrors the
GIFs into `apps/web/public/demo/gifs`, and keeps the legacy `01` through `04`
GIF filenames as aliases for older docs.

## Generate QA Snapshot

```bash
pnpm qa:snapshots
```

Outputs:

- `docs/qa/snapshot-report.md`
- `docs/submissions/card-condition-vault-snapshot.json`

## Build Submission Package

```bash
pnpm demo:submission
```

Outputs:

- `docs/submissions/card-condition-vault-submission-package.md`
- `docs/submissions/card-condition-vault-submission-package.json`
- `docs/submissions/card-condition-vault-submission-package.zip`
- `docs/demo/README_SNIPPETS.md`

## Private Integration Fallback

The package builder imports `easier_to_read_submissions` if it is installed.
When it is not available, it uses `vendor/easier_to_read_submissions`, which
implements the minimal `render_submission_markdown(payload)` interface.

## Run Product Locally

```bash
pnpm install
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[test]"
pnpm dev:api
pnpm dev
```

Open `http://localhost:3000` and use `/demo`, `/scan`, `/cards`, and `/compare`.

Use `pnpm dev:api:reload` when local file watching is allowed. In restricted shells on Windows, reload mode can fail on named-pipe permissions, so the default API command runs without reload.

## Run Convex Locally

```bash
npx convex dev --once --typecheck=enable
```

Convex writes `CONVEX_URL` to `.env.local`. Copy that value into `NEXT_PUBLIC_CONVEX_URL` for browser-side Convex subscriptions:

```text
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
```

## Train Alpha Detector

```bash
python ml/scripts/create_verified_seed_dataset.py
python ml/scripts/verify_annotated_dataset.py
python ml/scripts/train_synthetic_ding_detector.py --epochs 6 --train-samples 1440 --val-samples 450 --batch 64 --architecture synthetic-ding-cnn-v0.2-large
python ml/scripts/train_synthetic_ding_detector.py --architecture synthetic-ding-cnn-v0.3-xlarge --epochs 5 --train-samples 720 --val-samples 180 --batch 48 --lr 0.0008 --output services/inference-api/app/models/synthetic_ding_cnn_xlarge.pt --metrics services/inference-api/app/models/synthetic_ding_cnn_xlarge.metrics.json
```

Output:

- `services/inference-api/app/models/synthetic_ding_cnn.pt`
- `services/inference-api/app/models/synthetic_ding_cnn.metrics.json`
- `services/inference-api/app/models/ding-detector-v0.pt` after promotion for launch serving

This synthetic checkpoint is retained for fallback experiments. The served alpha model is the Roboflow-trained YOLO checkpoint at `services/inference-api/app/models/ding-detector-v0.pt`.

## Public Roboflow Alpha Fine-Tune

```powershell
$env:ROBOFLOW_API_KEY="replace-with-key"
python ml/scripts/ingest_roboflow.py --force
python ml/scripts/convert_labels.py --manifest ml/datasets/manifests/roboflow_alpha_manifest.jsonl --out ml/datasets/yolo/roboflow_alpha --label-map ml/configs/alpha_label_map.yaml --copy-images
python ml/scripts/train_yolo.py --data ml/datasets/yolo/roboflow_alpha/dataset.yaml --model yolov8n.pt --imgsz 416 --epochs 2 --batch 8 --device cpu --project runs/ding-detector-v0 --name roboflow-alpha-cpu --output services/inference-api/app/models/ding-detector-v0.pt --metrics services/inference-api/app/models/ding-detector-v0.metrics.json
```

If no Roboflow key is available, do not create fake data. Put manually downloaded YOLOv8 exports under `ml/datasets/raw/roboflow/<source_id>/` and run:

```powershell
python ml/scripts/ingest_roboflow.py --skip-download
```

Launch mode uses `ALLOW_MOCK_DETECTOR=false` and `REQUIRE_REAL_MODEL=true`. Missing weights should produce no fake DING boxes.

## Deploy Targets

- Vercel serves the Next.js app from `apps/web` using root `vercel.json`.
- Convex stores users, cards, images, scans, detections, reports, manifests, chat messages, and agent jobs.
- FastAPI inference should run as a separate service with `CARD_CONDITION_SYNTHETIC_WEIGHTS` or `CARD_CONDITION_YOLO_WEIGHTS` configured.
