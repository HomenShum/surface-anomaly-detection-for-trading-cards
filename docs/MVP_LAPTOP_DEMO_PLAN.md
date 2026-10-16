# MVP Laptop Demo Plan

This is the no-additional-cost path for showing Card Condition Vault to a friend while the product is still in MVP alpha. It uses the real local model and the existing health-gated UI, but does not require AWS, Temporal Cloud, S3, or paid infrastructure.

## Goal

Show this working end to end:

```text
Upload or use sample card
-> live checklist
-> local FastAPI inference
-> real ding-detector-v0
-> condition report
-> catalog save
-> evidence manifest
-> evidence hash verification
```

The demo should be presented as:

```text
Controlled alpha: AI-assisted condition evidence records. Not an official grade.
```

## Recommended Demo Mode

Use upload-first or sample-first. Camera scan is useful, but upload is the most reliable path for a friend demo because browser camera support depends on secure contexts and device permissions.

### Option A: Same Laptop

Use this when your friend is watching your laptop or screen share.

```powershell
pnpm install
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[ml,test]"
pnpm demo:seed
pnpm dev:api
```

In a second terminal:

```powershell
pnpm dev
```

In a third terminal:

```powershell
pnpm qa:launch
```

Open:

```text
http://127.0.0.1:3000/workspace
```

Pass condition:

- The inference health pill is green.
- `/models/current` reports `mock=false`.
- `pnpm qa:launch` passes.
- The sample or uploaded card produces a report.
- Evidence verification returns passed.

### Option B: Friend On Same Wi-Fi

Use this only if you want your friend to open the app from their own phone or laptop on the same local network.

Run the web app and API bound to your LAN interface:

```powershell
pnpm dev:api -- --host 0.0.0.0
pnpm --filter @card-condition-vault/web dev --hostname 0.0.0.0
```

Then share your laptop LAN address:

```text
http://<your-laptop-lan-ip>:3000/workspace
```

Notes:

- Upload flow should work over LAN.
- Camera capture may fail on a non-HTTPS LAN origin. Use upload mode if camera permission is blocked.
- Windows Firewall may ask to allow Node.js or Python. Allow private networks only.

### Option C: Public Website While Laptop Is On

Use this only for a temporary demo. It is not production fault tolerance.

Flow:

1. Run FastAPI locally on the laptop.
2. Expose port `8000` through a temporary HTTPS tunnel you already have available.
3. Set the Vercel environment variable:

```text
INFERENCE_API_URL=https://<temporary-tunnel-host>
```

4. Redeploy or refresh the preview deployment after the env change.
5. Open the Vercel app and wait for the inference health pill to turn green.

Risks:

- Tunnels can disconnect.
- The laptop must stay awake.
- Upload-first is still the reliable demo path.
- This does not replace the Fargate/Temporal/S3 plan in `docs/PRODUCTION_READY_PLAN.md`.

## Exact Friend Demo Script

1. Open `/workspace`.
2. Point out the `ALPHA V0.1` badge and `Not an official grade` language.
3. Confirm the inference health pill is green.
4. Click the sample card or upload a real card image.
5. Watch the live checklist:

```text
Card detected
Edges visible
Blur check passed
Glare check passed
Perspective normalized
Corner regions extracted
Edge regions extracted
DING detection running
Confidence scoring
Building condition report
Saving evidence manifest
Updating catalog
```

6. Save the reviewed card from the workspace or scan result.
7. Open the report.
8. Show the DING overlay and confidence warnings.
9. Open the Evidence tab.
10. Click Verify evidence.
11. Open before/after compare if using the sample dispute demo.

## Launch-Blocker Check

Run this before every demo:

```powershell
pnpm qa:launch
```

Expected:

```text
PASS contract files
PASS API health
PASS real model metadata
PASS real sample analysis
PASS evidence hash verification
PASS Next proxy smoke
```

Do not demo the real-user path if:

- `/models/current` reports `mock=true`.
- The health pill is red or amber.
- The model file is missing.
- Evidence verification fails.
- The report disclaimer is missing.

## Current MVP Proof Points

The current alpha should prove:

- Real model weights are present at `services/inference-api/app/models/ding-detector-v0.pt`.
- Mock fallback is disabled in launch mode.
- The API returns model hash, dataset manifest hash, training run id, and known limitations.
- Every report includes hashes and an analysis job key.
- The web proxy fails closed in production when no inference host is configured.
- Localhost dogfood can still use `http://127.0.0.1:8000`.

## Troubleshooting

### Health Pill Offline

Start the API:

```powershell
pnpm dev:api
```

Then wait up to 30 seconds for the web health hook to poll again, or refresh the page.

### Health Pill Degraded

The API is reachable but reporting mock mode. Check:

```text
ALLOW_MOCK_DETECTOR=false
REQUIRE_REAL_MODEL=true
```

Restart FastAPI after changing env vars.

### Upload Works But Analysis Fails

Run:

```powershell
pnpm qa:launch
```

If API health passes but sample analysis fails, restart the API so it reloads the current model and schema.

### Vercel Website Shows Offline

Check:

- `INFERENCE_API_URL` points to the current HTTPS tunnel or durable host.
- The tunnel is still connected.
- The laptop has not gone to sleep.
- FastAPI is running on port `8000`.

### Camera Permission Fails

Use upload mode. Browser camera APIs require a secure context such as HTTPS or localhost, and phone browsers are stricter on LAN origins.

## What Not To Promise

Do not describe this MVP as:

- An official grade.
- Legal proof.
- Public SaaS durability.
- Guaranteed defect detection.
- Production-scale infrastructure.

Use this language instead:

```text
This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee.
```

## After The Friend Demo

If the friend demo validates the product story, move to the next plan:

```text
docs/PRODUCTION_READY_PLAN.md
```

That is where Temporal, Docker, Terraform, AWS Fargate, S3 Object Lock, and DuckDB become worth implementing.
