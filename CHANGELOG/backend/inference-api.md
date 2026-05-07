# Backend Inference API

## 2026-05-06 - Serve the real alpha DING checkpoint

The inference API now reports `mock: false`, loads `ding-detector-v0.pt`, exposes the Roboflow manifest hash and training run ID, and refuses silent mock output when real-model mode is required. This keeps public-alpha reports honest: empty detections mean no candidate exceeded the threshold, not that the card is clean.

**Commit**: `uncommitted local workspace`. **Author**: Codex.
**Touches**: `CHANGELOG/ml/roboflow-alpha-model.md`, `CHANGELOG/web/workspace-agent.md`

