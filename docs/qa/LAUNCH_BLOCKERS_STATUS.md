# Launch Blockers Status

Generated: 2026-05-07T06:59:00.025Z

Inference endpoint: `http://127.0.0.1:8000`
Web endpoint: `http://127.0.0.1:3000`

| Status | Check | Detail |
| --- | --- | --- |
| PASS | Contract file services/inference-api/Dockerfile | services/inference-api/Dockerfile |
| PASS | Contract file render.yaml | render.yaml |
| PASS | Contract file docker-compose.yml | docker-compose.yml |
| PASS | Contract file convex/schema.ts | convex/schema.ts |
| PASS | Contract file convex/cards.ts | convex/cards.ts |
| PASS | Contract file docs/PRODUCTION_FAULT_TOLERANCE.md | docs/PRODUCTION_FAULT_TOLERANCE.md |
| FAIL | Production accuracy readiness | deployable=false, realRows=1, gold=0, P0=7 |
| PASS | Inference health | GET /health -> 200 |
| PASS | Real model metadata | mock=false, version=ding-detector-v0, training=yolo-20260506T124111Z |
| PASS | Real sample analysis | status=200, findings=0 |
| PASS | Evidence hash verification | status=200, passed=true |
| PASS | Vercel/Next proxy smoke | http://127.0.0.1:3000/api/inference/health -> 200 |

## Verdict

1 launch check(s) failed. Do not call this public-launch ready until these are green.
