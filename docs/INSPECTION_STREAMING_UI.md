# Inspection Streaming UI

This is the product/UI contract for turning Card Condition Vault from a checklist into a visible agentic inspection system.

## Product Rule

Every analysis step needs a visual counterpart. If the inspection agent crops, zooms, rotates, compares, detects, or saves evidence, the user should see that action happen on the card.

## Why This Direction

OpenAI's "Thinking with images" release describes models transforming uploaded images with tools such as crop, zoom, and rotate while reasoning. The Responses API also supports streaming semantic events and tool use for agentic applications. For our product, that maps to a concrete rule:

```text
CV tools produce the evidence.
The agent orchestrates inspection.
The UI renders every tool call as a visible event.
```

The LLM or pi-ai layer must not invent DINGs. It can request tool actions and explain outputs, but every visual claim must be grounded in detector, crop, compare, or evidence-manifest output.

## Event Model

Implemented as `apps/web/lib/inspection-events.ts`.

Current event shape:

```ts
type InspectionEvent = {
  id: string;
  type: "tool.started" | "tool.progress" | "tool.completed";
  tool:
    | "detect_card_boundary"
    | "normalize_card"
    | "crop_region"
    | "zoom_region"
    | "run_ding_detector"
    | "run_surface_anomaly"
    | "save_evidence";
  label: string;
  detail: string;
  status: "running" | "passed" | "warning" | "failed";
  target?: {
    imageId: string;
    bboxNorm?: [number, number, number, number];
    region?: string;
  };
  visual: {
    animation:
      | "card_outline"
      | "perspective_warp"
      | "crop_extract"
      | "zoom_lens"
      | "edge_sweep"
      | "surface_glare_scan"
      | "ding_box_appear"
      | "evidence_stamp";
    durationMs: number;
  };
  progress: number;
};
```

This is AG-UI-inspired but app-specific. We can later map it to AG-UI `TOOL_CALL_START`, `TOOL_CALL_RESULT`, `STATE_DELTA`, and custom events.

## Current UI Implementation

Implemented in:

- `apps/web/components/InspectionCanvas.tsx`
- `apps/web/components/AgentWorkspaceClient.tsx`
- `apps/web/app/globals.css`

The workspace now renders:

- Active tool target rectangle from `bboxNorm`.
- Zoom/crop preview panel for the inspected region.
- Scanline animation for edge and surface checks.
- Tool event timeline.
- DING overlay mapped back to full-card coordinates.

The current flow is still deterministic from the checklist steps. The next step is connecting the same event schema to a real SSE endpoint or pi-ai tool stream.

The controlled self-improvement loop is defined separately in `docs/INSPECTION_SKILL_EVOLUTION.md`. That document is the guardrail boundary for any agent-proposed crop/zoom/rotate method that might later be reused across users.

## Tool-To-UI Mapping

| Tool | Visual animation | User meaning |
|---|---|---|
| `detect_card_boundary` | card outline | The card frame is being located |
| `normalize_card` | perspective warp | The upload is being straightened |
| `crop_region` | crop extract | A corner or edge crop is being produced |
| `zoom_region` | zoom lens | A small suspicious region is being magnified |
| `run_ding_detector` | zoom lens + DING overlay | The detector is running on normalized/cropped views |
| `run_surface_anomaly` | glare scanline | The surface is being checked for reflection risk |
| `save_evidence` | evidence stamp | Hashes and report state are being saved |

## pi-ai Integration Design

The pi-ai report assistant should expose tools like:

```text
get_card_images(card_id)
normalize_card(image_id)
crop_region(image_id, bboxNorm, region)
zoom_region(image_id, bboxNorm, region)
rotate_image(image_id, degrees)
run_ding_detector(image_id, region)
run_surface_anomaly(image_id, region)
compare_regions(before_image_id, after_image_id, bboxNorm)
save_evidence_crop(report_id, image_id, bboxNorm)
update_report(report_id, patch)
```

Agent guardrails:

- Do not invent defects.
- Do not change detector outputs silently.
- If confidence is low, request a crop, zoom, compare, or retake.
- Every report explanation must cite tool outputs, report JSON, or evidence manifest data.
- Every tool call should emit an `InspectionEvent` so the UI can render it.

## QA Benchmarks

### Responsiveness

| Metric | Target |
|---|---:|
| Time to first status | < 300 ms |
| Time to first visual tool event | < 700 ms |
| Time to first crop preview | < 1500 ms |
| Time to report ready for sample card | < 5 s |
| Dead-air gaps over 1500 ms | 0 |

### Visual Correctness

| Assertion | Target |
|---|---:|
| Event `bboxNorm` maps to rendered target | within 8 px |
| Crop preview corresponds to source region | pass by screenshot/manual review |
| DING box remains in normalized card coordinates | pass |
| Tool event timeline matches active animation | pass |
| No generic spinner without status copy | pass |

### Agent Grounding

| Assertion | Failure condition |
|---|---|
| Agent claim has tool evidence | Claim mentions a DING not in tool/model output |
| Low confidence escalates | Agent gives confident answer without crop/retake warning |
| No official grade claim | Any PSA/TAG/CGC grade-like claim |
| Evidence manifest exists | Report explanation without hashes/timestamp/model version |

### Model Benchmarks

Continue using:

```powershell
pnpm eval:model
```

Required model metrics:

- Per-class precision/recall.
- Per-region precision/recall.
- Full-card detector vs crop-region detector.
- Clean-card false positive rate.
- Obvious-damage false negative rate.

## Dogfood Tests

Current Playwright coverage:

- `tests/e2e/workspace-agent-upload.spec.ts`
- Uses real file upload, not only sample button.
- Verifies the uploaded card preview appears.
- Verifies the inspection target, crop preview, tool event stream, DING detector event, report disclaimer, and screenshot.

Next tests:

1. Mock `zoom_region` event with known `bboxNorm`, then measure rendered overlay coordinates.
2. Mock low-confidence/glare response and require crop or retake guidance.
3. Mock no detections and fail if the agent invents defects.
4. Run before/after compare with synchronized zoom event.

## Production And OSS References

- OpenAI Thinking with images: models can crop, zoom, rotate, and manipulate images while reasoning.
- OpenAI Responses API streaming: semantic server-sent events and tool use for agentic apps.
- AG-UI: event-based agent/frontend protocol with tool calls, state deltas, custom events, and tool output streaming.
- assistant-ui: React chat primitives for streaming, tool calls, attachments, and AG-UI runtimes.
- CopilotKit: agent-native React apps with shared state, generative UI, and human-in-the-loop flows.
- Roboflow Annotate: zoom/pan, Label Assist, Smart Polygon, and model-assisted labeling.
- CVAT: mature image/video annotation and QA workbench.
- FiftyOne: visual dataset curation and detection evaluation, including COCO-style object detection evaluation.
- Storybook + Chromatic: component interaction tests, visual regression, viewport coverage, and Playwright/Cypress integration.
- Phoenix: open-source AI tracing and evaluation with tool-call visibility and OpenTelemetry/OpenInference instrumentation.

## Next Build Step

Build `/api/scan/inspect` as an SSE endpoint that emits the same `InspectionEvent` schema:

```text
upload received
card boundary found
normalize_card tool.started
normalize_card tool.completed
crop_region top_right tool.started
crop_region top_right tool.completed
run_ding_detector tool.started
run_ding_detector tool.completed
report.updated
save_evidence tool.completed
```

Then make the workspace consume real streamed events instead of deriving events from the local checklist.
