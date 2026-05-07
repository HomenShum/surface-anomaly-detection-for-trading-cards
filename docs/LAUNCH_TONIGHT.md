# Real-User Alpha Launch Plan

## Current Alpha Cut

- Vercel serves the Next.js app.
- Convex owns persistent records and file metadata.
- FastAPI owns image normalization and DING inference.
- `ding-detector-v0` is the served real trained local checkpoint.
- pi-ai/OpenRouter powers the report and workspace assistant when `OPENROUTER_API_KEY` is configured; local fallback keeps the app usable without the key.

## Verified Locally

- Next.js production build passes.
- FastAPI health and `/models/current` pass with `mock=false`, `synthetic_weights_loaded=true`, a weights hash, dataset manifest hash, and training run ID.
- FastAPI QA includes tests for synthetic checkpoint analyze routing, evidence manifest required fields, and official-grade/legal-guarantee disclaimers.
- Convex functions typecheck locally.
- API and web type checks pass through `pnpm test`.
- The in-app browser can load `/demo` and `/workspace`.
- The workspace supports chat-sidebar upload, analysis, and approved save flow.

## Must Be Finished Before Inviting A Real User

- Create and configure a real Convex cloud deployment, then set `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_URL`, and `CONVEX_DEPLOYMENT` in Vercel.
- Create and configure a Vercel project, then add all web, auth, Convex, API, and Inflection environment variables.
- Host the FastAPI inference service somewhere reachable from Vercel, or keep the first alpha on a tunnel/VPN-hosted local machine with a stable `NEXT_PUBLIC_API_BASE_URL`.
- Add `OPENROUTER_API_KEY` and verify the pi-ai/OpenRouter Gemma report assistant against the live provider.
- Verify Google OAuth redirect URLs against the deployed Vercel domain.
- Run one seeded user through the full deployed flow: `/workspace` upload, analyze, save to Convex, open catalog, open report, compare before/after.
- Keep the launch copy clear that `ding-detector-v0` is alpha and trained on generated data plus the first-party verified seed set. Do not claim real-card grading accuracy until the Roboflow alpha fine-tune passes manual QA.

## Real Model Status

`ding-detector-v0` is a real checkpoint trained in this repo and is suitable for a working demo loop. It has 1,380,053 parameters, 9 DING labels, and includes the verified first-party seed annotations in training. It is not yet a real-world card damage model. The next model gate is a YOLO fine-tune on Roboflow Card Grader v5 and Pokemon Surface Damage Detection v2, followed by a 50-100 image manual card review set.

## Required Environment

Vercel:

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_CONVEX_URL
NEXTAUTH_URL
NEXTAUTH_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
CARD_AGENT_PROVIDER=openrouter
CARD_AGENT_MODEL=google/gemma-4-26b-a4b
OPENROUTER_API_KEY
```

Convex:

```text
CONVEX_DEPLOYMENT
```

Inference host:

```text
CARD_CONDITION_MODEL_VERSION=ding-detector-v0
CARD_CONDITION_SYNTHETIC_WEIGHTS=services/inference-api/app/models/ding-detector-v0.pt
CARD_CONDITION_YOLO_WEIGHTS=services/inference-api/app/models/ding-detector-v0.pt
ALLOW_MOCK_DETECTOR=false
REQUIRE_REAL_MODEL=true
```

## Tonight Demo Script

1. Open `/workspace`.
2. Upload a card image in the agent sidebar.
3. Click **Analyze upload**.
4. Confirm DING boxes render over the normalized card.
5. Ask: `save this to the catalog and explain the evidence packet`.
6. Click **Save reviewed card**.
7. Open `/cards` and verify the card persists locally or through Convex.
8. Open `/compare` for before/after positioning.

## Production Cut Lines

- Do not claim real-world grading accuracy.
- Do not expose broad public signup until Convex auth/user isolation is fully verified.
- Do not store full video by default.
- Do not use unverified public datasets for commercial claims.
- Keep `ding-detector-v0` labeled as an alpha model until YOLO is fine-tuned on licensed real-card DING labels.
