# Dogfood Checklist

## P0

- [ ] `pnpm demo:seed` creates sample data.
- [ ] `pnpm dev:api` starts FastAPI.
- [ ] `pnpm dev` starts the web app.
- [ ] `/demo` can open a sample card path.
- [ ] `/scan` supports camera and upload fallback.
- [ ] `/scan/analyze` returns report JSON and evidence hashes.
- [ ] DING overlay renders on a normalized card image.
- [ ] Evidence manifest includes timestamp, hashes, model version, and disclaimer.
- [ ] No full video is stored by default.
- [ ] Reports state that this is not an official grade or legal guarantee.
- [ ] API test verifies `/scan/analyze` uses `ding-detector-v0` when `services/inference-api/app/models/ding-detector-v0.pt` exists.
- [ ] API test verifies evidence manifest required fields on normalize, analyze, and compare responses.
- [ ] API test verifies model and manifest disclaimers include "not an official grade or legal guarantee".

## P1

- [ ] Google OAuth env variables are documented.
- [ ] User correction flow persists locally.
- [ ] Missing model weights produce no fake DING boxes unless `ALLOW_MOCK_DETECTOR=true`.
- [ ] Own upload path works without camera access.
- [ ] Before/after compare highlights possible new defects.
- [ ] Submission docs and demo media can be generated.
- [x] Certified reference import UI exists at `/certs/import`.
- [x] PSA/TAG seed references exist under `data/cert-references/seed.json`.
- [x] `pnpm eval:certrefs` writes a readiness report without claiming deployability.

## P2

- [ ] PatchCore heatmap appears behind YOLO detections.
- [ ] Premium evidence packet export includes crops and JSON.
- [x] PSA cert link field exists.
- [ ] Batch upload is supported.
