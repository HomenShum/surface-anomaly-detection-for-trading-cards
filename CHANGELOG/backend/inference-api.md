# Backend Inference API

## 2026-05-06 - Serve the real alpha DING checkpoint

The inference API now reports `mock: false`, loads `ding-detector-v0.pt`, exposes the Roboflow manifest hash and training run ID, and refuses silent mock output when real-model mode is required. This keeps public-alpha reports honest: empty detections mean no candidate exceeded the threshold, not that the card is clean.

**Commit**: `uncommitted local workspace`. **Author**: Codex.
**Touches**: `CHANGELOG/ml/roboflow-alpha-model.md`, `CHANGELOG/web/workspace-agent.md`

## 2026-10-16 - Align real-model demo setup with declared dependencies

The [root setup](../../README.md) and [same-laptop demo](../../docs/MVP_LAPTOP_DEMO_PLAN.md) now request `.[ml,test]` for the documented real-model image-analysis route. The root prerequisite note names Python 3.11+ and pnpm 10.15.0 from the existing manifests. The `ml` extra includes the declared YOLO runtime; `test` includes the test dependencies.

Author validation is source-only: no installation, image/model run, retraining, or performance verification was performed. Existing alpha limitations and historical results are retained. A later pull request or update is expected to invoke the existing Vercel preview workflow; configured CI/platform actions and their outcomes require separate admission and observation.

**Touches**: `README.md`, `docs/MVP_LAPTOP_DEMO_PLAN.md`
