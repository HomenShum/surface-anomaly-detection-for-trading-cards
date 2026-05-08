# Deploy guide — Card Condition Vault

Target: **Render.com** (vendor-pilot scale: 10 active vendors, persistent
disk, always-on web service, $7/mo plan).

This guide assumes you can hand the URL `https://card-condition-vault-web.onrender.com`
(or your custom domain) to your friend and the vendors they bring — the
server runs without your laptop being open.

---

## What you get

- Public app at `https://<service>.onrender.com`
- Each visitor gets an isolated vault (anon cookie or signed-in account)
- Daily cron emails / pings you when **active owners > 10** so you know
  when to scale up
- All record / image data survives deploys via persistent disk
- HTTPS + security headers (HSTS, CSP, X-Frame, etc.) on every route

## What you need before deploying

1. **GitHub repo connected to Render** (Render reads `render.yaml`)
2. **Google OAuth credentials** for sign-in (10 min in Google Cloud Console)
3. **A webhook URL for the 10-user alert** (Discord, Slack, or Resend email — pick one)
4. **API keys** for the LLM that powers the agent dock (you already have these in your local `.env.local`)
5. **Roboflow workspace + uploaded DING model** for AI auto-DING detection (see "Roboflow setup" below — ~15 min)

---

## Step 1 — Connect to Render via blueprint

1. Push this repo to GitHub (private is fine).
2. Go to [Render → New → Blueprint](https://dashboard.render.com/blueprints/new).
3. Pick your repo. Render reads `render.yaml` and proposes three services:
   - `card-condition-vault-inference` (Python DING detector — already in render.yaml)
   - `card-condition-vault-web` (the Next.js dealer-OS — added by this guide)
   - `dealer-heartbeat-alert` (cron job — fires daily at 14:00 UTC)
4. Click **Apply**. Render will start building but the web service will
   fail until you fill in the env vars in Step 2.

## Step 2 — Set the secret env vars

In the Render dashboard, click into `card-condition-vault-web` → **Environment**.
Set these (others are auto-generated or have safe defaults):

| Key | Where to get it |
|---|---|
| `NEXTAUTH_URL` | `https://card-condition-vault-web.onrender.com` (or your custom domain) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs. Authorized redirect URIs must include `<NEXTAUTH_URL>/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | Same panel, "Client secret" |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey (free tier works) |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys (optional, falls back to Gemini) |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (optional) |
| `ROBOFLOW_API_KEY` | See "Roboflow setup" below |
| `ROBOFLOW_MODEL_ID` | See "Roboflow setup" below — format `workspace/project/version` |
| `ADMIN_ALERT_WEBHOOK_URL` | See Step 3 |

`NEXTAUTH_SECRET` and `ADMIN_HEARTBEAT_TOKEN` are generated automatically
by Render (`generateValue: true` in the blueprint).

For the cron service `dealer-heartbeat-alert`:
| Key | Value |
|---|---|
| `DEALER_BASE_URL` | Same as `NEXTAUTH_URL` |
| `ADMIN_HEARTBEAT_TOKEN` | **Copy from the web service env** — these must match |

## Step 3 — Pick a notification channel for the 10-user alert

You'll get a webhook POST when the daily cron sees > 10 active owners.
Pick the easiest:

### Option A: Discord (recommended — 30 seconds)
1. Open Discord, go to a server you own → Server Settings → Integrations → Webhooks → New Webhook.
2. Pick a channel, click "Copy Webhook URL".
3. Paste as `ADMIN_ALERT_WEBHOOK_URL`.

The cron's POST body uses Discord's `content` field — alerts arrive as messages.

### Option B: Slack
1. Slack → Apps → "Incoming Webhooks" → Add to Slack → pick channel → copy URL.
2. Paste as `ADMIN_ALERT_WEBHOOK_URL`.

The webhook payload includes a `content` field; Slack ignores extra keys gracefully but the notification text is in `content`. For prettier formatting, swap to Slack's "blocks" format later.

### Option C: Email via Resend (more setup)
1. Sign up at resend.com (100 emails/day free).
2. Verify a domain you own (or use the resend.dev test domain).
3. Build a tiny relay: a free Cloudflare Worker that accepts the webhook
   POST and re-formats it as a Resend send. Pin the relay URL as
   `ADMIN_ALERT_WEBHOOK_URL`.

If you're not sure, **pick Discord**. It's free, instant, and works.

## Roboflow setup — DING auto-detection backend

The Python YOLO detector (`services/inference-api/`) is **not** deployed
on Render. Hosting PyTorch + ultralytics on Render Starter would OOM
at first inference (the runtime needs ~1.2GB RAM and Starter is 512MB);
moving to Standard would cost +$25/mo. Instead, the dealer-OS calls
**Roboflow Hosted Inference** which is pay-per-call (free tier covers
1000 inferences/mo, then ~$0.40 per 1000) and ~50ms p50.

If `ROBOFLOW_API_KEY` and `ROBOFLOW_MODEL_ID` aren't set, the dealer-OS
still works — records land in the workbench awaiting **manual** DING
flagging. Roboflow is only required if you want AI auto-detection.

### Step R1 — Create a Roboflow account

1. Sign up free at https://roboflow.com.
2. Create a new workspace if prompted (private OK).
3. Create a new project with **Object Detection** as the type.

### Step R2 — Upload the DING model weights

The trained model lives at `services/inference-api/app/models/ding-detector-v0.pt`
in this repo. Roboflow won't ingest a `.pt` file directly, so you have two
paths — pick the one you can do quickest:

#### Option R2-A: Re-train in Roboflow (recommended, 30–60 min)

1. In your project, click **Upload Data** → select all images and YOLO-format
   labels from your training dataset (under `data/datasets/` in this repo).
2. Click **Generate** → choose preprocessing/augmentation defaults → click
   **Train**. Pick `roboflow-3.0` or `roboflow-2.0` recipe.
3. Wait ~15–45 min for training to complete.
4. Open the **Versions** tab. Your trained model gets a version number
   (typically `1`). Click **Use Hosted API**.

#### Option R2-B: Bring-your-own weights via custom Roboflow Inference

1. Roboflow's "Bring Your Own Weights" UI accepts YOLOv8 `.pt` files
   directly. Upload `ding-detector-v0.pt` to your project.
2. Wait for Roboflow to validate + deploy (~5 min).
3. Open the **Versions** tab to confirm the upload landed.

Either way, Roboflow will surface the deployment as
`<workspace>/<project>/<version>` — that's your `ROBOFLOW_MODEL_ID`.

### Step R3 — Get your API key

1. Roboflow dashboard → click your account avatar (top right) → **Settings**.
2. **API Key** section → copy the **Private API Key**. (Not the publishable
   key — Hosted Inference needs the private one.)

### Step R4 — Set the env vars on Render

In the `card-condition-vault-web` service env settings:

```
ROBOFLOW_API_KEY=<paste private API key>
ROBOFLOW_MODEL_ID=<workspace>/<project>/<version>
```

Examples of valid `ROBOFLOW_MODEL_ID`:
- `homen-ccv/ding-detector/3`
- `homen-ccv/ding-detector` (defaults version to `1`)

### Step R5 — Verify

After redeploying with the Roboflow vars set:

```bash
# Upload the seed Pokemon TCG image and check the detector path
curl -X POST https://card-condition-vault-web.onrender.com/api/dealer/intake \
  -H "Content-Type: application/json" \
  --data-raw '{"imageBase64":"<base64 of a card photo>","filename":"test.jpg"}'

# Then attach the image to one of the resulting records and watch the
# response include modelVersion: "roboflow:<workspace>/<project>/<version>"
```

In the dealer-OS UI, every workbench row that came through Roboflow shows
the model version at the bottom of the audit-trail event.

### Backend resolution order

The detector tries backends in this order on each call:
1. **Roboflow** — when `ROBOFLOW_API_KEY` AND `ROBOFLOW_MODEL_ID` are set
2. **Self-hosted FastAPI** at `INFERENCE_API_URL` — only attempted in dev
   (`NODE_ENV !== "production"`) OR when `INFERENCE_API_URL` is explicitly
   set in prod (escape hatch if you ever do deploy the Python service)
3. **Curated fixture** — for one specific demo image hash, so the open
   DING fixture screenshot in `examples/` always has annotations

If all three fail, the attach-image route persists the image anyway and
marks the record `image_attached` lane so the workbench can flag DINGs
manually. **No record is ever lost on detector failure.**

### When Roboflow isn't worth it

If your friend's vendors mostly want manual DING review (they trust their
eyes more than the model), you can skip the Roboflow setup entirely. Leave
`ROBOFLOW_API_KEY` unset. The workbench still works — every uploaded card
just lands in the human-review lane awaiting a manual DING pass.

---

## Step 4 — First deploy + verification

After saving env vars, click **Manual Deploy → Deploy latest commit**.
Watch the build log for `Build succeeded` (~2–4 min).

Once `Status: Live`:

```bash
# 1. Public health check (anyone can call)
curl https://card-condition-vault-web.onrender.com/api/health
# → {"ok":true,"service":"card-condition-vault","ts":"...","uptime":N}

# 2. Admin heartbeat (token-protected)
curl -H "Authorization: Bearer $ADMIN_HEARTBEAT_TOKEN" \
  https://card-condition-vault-web.onrender.com/api/admin/heartbeat
# → {"totalOwners":1,"activeOwners":1,"threshold":10,"thresholdExceeded":false,...}

# 3. The dealer surface itself
open https://card-condition-vault-web.onrender.com/dealer
```

Visit `/dealer`. Your sidebar identity chip should read **"anonymous vendor · #abcdef · sign in"**. Click around — drop a card, accept a workbench decision, edit cost basis. Each browser session is its own isolated vault.

## Step 5 — Hand the URL to your friend

Send them `https://card-condition-vault-web.onrender.com/dealer`. They can:
- Use it anonymously (cookie-based vault, persists on their browser)
- Sign in with Google for a durable account
- After signing in, the banner at the top will offer to claim their anonymous vault into their account

When their vendor friends visit, each one gets their own isolated namespace. No data leaks across.

## What happens when active users > 10

Each day at 14:00 UTC the cron hits `/api/admin/heartbeat?notify=1&threshold=10`. If more than 10 owner namespaces have written or uploaded in the last 7 days, the configured webhook fires:

> 🚨 Card Condition Vault: 12 active owners exceeds threshold of 10 (total 18, 4 signed in).

You can change the threshold by editing the cron's `startCommand` in `render.yaml` (or test it manually):

```bash
curl -H "Authorization: Bearer $ADMIN_HEARTBEAT_TOKEN" \
  "https://<your-url>/api/admin/heartbeat?notify=1&threshold=5"
```

Cooldown: the alert fires once per 24h even if the threshold stays exceeded — you won't get spammed.

## Storage caps (per owner)

Each owner namespace is capped at:
- 1000 records
- 100MB total uploaded image bytes
- 10,000 audit events

Hitting any cap returns 413 to the client. To raise caps, edit `apps/web/lib/dealer/quota.ts`.

## Logs

Render → your service → **Logs** tab. Every API request emits a single
JSON line with `route`, `requestId`, `ms`, `event` (start/success/failure).
Filter examples:
- `"event":"failure"` — every error
- `"route":"cost-basis.write"` — every cost-basis save
- `"ms":[100 TO *]` — slow requests

## Backup

Persistent disk lives on Render's infrastructure but it's a single VM.
For paranoia:

```bash
# Once a week, copy the whole data dir off-Render
ssh render-shell-for-card-condition-vault-web \
  "tar czf - -C /opt/render/project/src/data ." \
  > vault-backup-$(date +%F).tar.gz
```

Or set up a weekly Render cron that uploads to S3 / R2 / Backblaze. Skipped here because at vendor-pilot scale the data is reproducible from CSV exports.

## Updating

```bash
# Push to main → Render auto-deploys
git push origin main
```

The build runs `pnpm install && pnpm build` and zero-downtime swaps the
new container in. Old persistent disk is reattached so no data loss.

## Roll back

Render → service → **Manual Deploy → Rollback** → pick a previous commit.

## When this stops being enough

You'll know it's time to migrate to a real database when:
- Active owners regularly exceed 50 (JSONL parse hurts)
- Single-process bottleneck (Render Starter is one container)
- You want multi-region deploys (filesystem doesn't replicate)

Migration path: `data/dealer/owners/<id>/records.jsonl` → SQLite (one table,
ownerId column, one row per record). The store API already takes ownerId
through every call, so the swap is mechanical.
