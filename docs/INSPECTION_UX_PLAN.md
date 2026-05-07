# Inspection UX + Agent Streaming Plan

Strategic plan capturing the full vision for visual agent streaming, tool-call animations, and dogfood evaluation — *and* the minimum-wedge MVP path that ships against the constraint **"MVP, friend demo on a laptop, $0 incremental cost."**

Last reviewed: 2026-05-06.

---

## 0. Framing

Two principles drive everything below:

1. **Scale-imbalance principle (Telescope-derived)** — defects are tiny relative to the card. The pipeline must magnify defect-prone zones (corners, edges, surface) before asking a model to find anything.
2. **Visible-action principle (OpenAI "Thinking with Images" derived)** — every analytical step must have a visible visual counterpart. If the agent crops, zooms, rotates, compares, or detects, the user must see that action happen on the card.

These are durable. Everything else is implementation.

---

## 1. Architectural decision

**Detector outputs facts. Agent outputs interpretation.**

```
camera / upload
  → normalization tools             (CV, deterministic)
  → region crops                    (CV, deterministic)
  → defect detection tools          (model)
  → anomaly tools                   (model, optional)
  → agentic image manipulations     (pi-ai, only when needed)
  → structured report               (deterministic from above)
  → agent explanation               (pi-ai over structured report)
  → catalog + evidence vault        (storage)
```

Agent never invents detections. Agent never overwrites detector output. Agent never claims an official grade. These are immutable rules.

---

## 2. Pi-ai tool belt

Tools the agent can call. None of them invent visual results — each one performs a real CV/model operation and returns structured output.

```ts
const tools = {
  detect_card_boundary,    // returns 4 corners in image space
  normalize_card,          // returns normalized 1024x1024 crop
  crop_corner,             // returns 9% corner tile
  crop_edge,               // returns edge ribbon strip
  crop_surface_region,     // returns arbitrary bbox
  zoom_region,             // returns enlarged crop with bbox metadata
  rotate_image,            // returns rotated variant
  enhance_contrast,        // returns enhanced variant
  run_ding_detector,       // calls /scan/analyze on a crop
  run_surface_anomaly,     // calls anomaly tool (PatchCore future)
  compare_regions,         // before/after diff for a region
  save_evidence_crop,      // writes hashed crop to manifest
  update_report,           // patches structured ConditionReport
};
```

Agent orchestration prompt:
- You are an inspection orchestrator.
- You may request image transformations and model tools.
- You must not invent DINGs.
- Every visual claim must come from a tool output.
- When confidence is low, request a better crop or mark uncertainty.
- Emit a user-visible event for every tool call.

---

## 3. Two-loop orchestration

**Loop 1 — Fast perception (always runs):** card detect → quality gates → normalize → corner extract → edge extract → run detector → assemble report.

**Loop 2 — Agentic inspection (runs when loop-1 confidence is low or user asks):** zoom into ambiguous region → re-run detector on enhanced crop → compare with another frame → escalate or accept.

Loop 1 powers the responsive checklist. Loop 2 powers the agent's selective deep dives.

---

## 4. Inspection event schema

Internal protocol. Bridge between FastAPI/pi-ai and the React canvas.

```ts
type InspectionEvent =
  | { type: "stage.started"; stageId: string; label: string }
  | {
      type: "tool.started";
      toolCallId: string;
      tool: "crop_region" | "zoom_region" | "rotate_image" | "run_ding_detector" | "compare_region";
      label: string;
      target?: {
        imageId: string;
        bboxNorm?: [number, number, number, number];
        region?: "top_left_corner" | "top_right_corner" | "bottom_left_corner"
                | "bottom_right_corner" | "left_edge" | "right_edge"
                | "top_edge" | "bottom_edge" | "center";
      };
    }
  | { type: "tool.progress"; toolCallId: string; progress: number; message: string }
  | {
      type: "tool.completed";
      toolCallId: string;
      output: {
        imageId?: string;
        detections?: DingDetection[];
        confidence?: number;
        warning?: string;
      };
    }
  | { type: "stage.completed"; stageId: string; status: "passed" | "warning" | "failed" | "skipped"; message?: string }
  | { type: "report.updated"; reportPatch: Partial<ConditionReport> };
```

Transport: SSE on `/api/scan/inspect` (or pi-ai-equivalent). React maintains a state machine that consumes events and drives the canvas.

---

## 5. Tool-call → animation map

| Tool | Animation | User copy |
|---|---|---|
| `detect_card_boundary` | Outline locks onto card | Card boundary found |
| `normalize_card` | Perspective warp tween | Straightening the card |
| `crop_corner(top_right)` | Box slides into zoom panel | Inspecting top-right corner |
| `zoom_region` | Lens zooms into bbox | Zooming into possible issue |
| `rotate_image` | Card tilts, returns | Checking from another angle |
| `run_ding_detector` | Scanning pulse over crop | Checking for visible DINGs |
| `run_surface_anomaly` | Heatmap fades in | Checking surface irregularities |
| `compare_region` | Before/after split slider | Comparing before and after |
| `save_evidence_crop` | Stamp/check animation | Evidence saved with hash |

---

## 6. UI components (full vision)

Eventually:

```
InspectionCanvas       — owns normalized card, viewport transform, overlays
ZoomLensOverlay        — animated zoom into bbox + crop preview panel
CropPreviewPanel       — floating tile showing the active crop
ToolCallTimeline       — bottom timeline: tool, region, duration, status, output
StreamingChecklist     — current 14-stage list
DingOverlayLayer       — already exists
EvidenceStamp          — animation when manifest is signed
BeforeAfterDiffLayer   — synchronized zoom + diff
AgentInspectionCard    — agent's current explanation
ConfidenceToast        — non-blocking warning when confidence drops
```

Layout:

```
┌─────────────────────────────────────────────────────────┐
│ Top: scan session status                                 │
├──────────────────────────────┬──────────────────────────┤
│ Left: InspectionCanvas        │ Right: StreamingChecklist│
│  - normalized card            │                          │
│  - animated overlays          │                          │
│  - crop preview               │                          │
├──────────────────────────────┴──────────────────────────┤
│ Bottom: ToolCallTimeline                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Dogfood evaluation matrix

Four orthogonal eval axes:

### A. UX responsiveness budgets
- `time_to_first_status` < 300 ms
- `time_to_first_visual_action` < 700 ms
- `time_to_first_crop` < 1500 ms
- `time_to_report_ready` < 5 s for sample card
- `dead_air_gaps_over_1500ms` = 0

### B. Animation correctness
- Tool event `bboxNorm` matches animated screen bbox within 8 px tolerance
- Crop preview source region equals declared bbox (pixel-diff)
- DING boxes after zoom remap correctly to normalized card coordinates
- Animation completes before `tool.completed` *or* gracefully waits

### C. Model quality (already started in `MODEL_COMPARISON_TELESCOPE.md`)
- Per-class precision/recall (already added: `card`, `corner_wear`, `crease`, `edge_wear`, `heavy_wear`, `scratch`, `tear_or_hole`)
- Per-region precision/recall (already added: center, corner, edge — edge recall is the visible weakness at 0.241)
- Full-card vs cropped-region detector A/B (planned for `card_foveation_v0.1`)
- Clean-card false-positive rate (planned)

### D. Agent rigor
- `tool_call_success_rate`
- `tool_call_latency_p50/p95`
- `agent_claim_without_tool_evidence` — must equal 0 (hard fail)
- `agent_missed_low_confidence_escalation_rate`
- `agent_unnecessary_zoom_rate`

---

## 8. Reference stack

| Layer | Tool | Why |
|---|---|---|
| Component stories | Storybook | Isolate canvas + overlay states |
| Visual regression | Playwright `toHaveScreenshot()` or Chromatic | Catch animation regressions per state |
| End-to-end flow | Playwright | We already have e2e specs |
| Agent traces | Phoenix or OpenAI Agents SDK tracing | Pi-ai tool-call audit |
| CV dataset inspection | FiftyOne | Curate eval splits |
| Annotation review | CVAT or Roboflow | Human correction + active learning |
| Demo GIFs | Existing `easier-to-read-submissions` flow | Already wired |

| Inspiration | Why |
|---|---|
| AG-UI Protocol | Event schema for agent→frontend streaming |
| assistant-ui | Streaming, tool calls, attachments, retries |
| CopilotKit | Generative UI + shared state + human-in-loop |
| Roboflow Annotate | Zoom + label assist UX (closest visual ref to ours) |
| CVAT | Mature OSS annotation + QA + automation |

We will *not* adopt any of these as dependencies in MVP. They are reference patterns only.

---

## 9. **MVP wedge — what to ship for the friend demo**

This is the section that gates implementation. Everything above is the durable target. Everything below is what actually ships in the next session against the constraint **"MVP, laptop demo, $0."**

### 9a. What we already have (do not rebuild)

- 14-stage streaming checklist on `/scan` and `/workspace`
- Real frame-quality signals (`blurScore`, `glareRisk`, `edgeCoverage`, `surfaceMode`)
- Real DING detector (`ding-detector-v0`, 6 MB, on FastAPI)
- DingOverlay component already renders bboxes on the normalized card
- Evidence manifest with SHA-256 + verifier route
- Health-pill + alpha badge on every shell
- Sample card autostarts the full pipeline from `?mode=sample`

### 9b. What ships next (one wedge, one week)

**Goal: prove the "visible-action" principle on ONE step. Not all 14.**

The wedge is **"Inspecting the corners" animation**, plugged into the existing `/scan` checklist between `corner-regions` and `surface-scan`:

1. **One CSS-only animated zoom-lens overlay** over the existing `DingOverlay` canvas. Takes a normalized bbox `[x1, y1, x2, y2]` plus a label.
2. **Sequence the four corner crops** as a 4-step micro-flow inside the existing `Corner regions extracted` checklist row. Each step:
   - Pulse glow on the corner bbox (0.4 s)
   - Animate a "lens" tile out to the side panel showing the magnified crop (0.6 s)
   - Render the existing DING bbox overlays *that already came from the v0 detector* in that crop region (0.3 s)
   - Stamp a tiny check mark and slide back (0.2 s)
3. **Reuse the existing `/scan/analyze` output** — bbox-filter the v0 detector's findings into per-corner subsets. No new endpoints, no SSE, no pi-ai tool calls yet.
4. **One sample card** (the existing Tauros). The animation runs identically every time. Friend can see it on a laptop with the FastAPI service running.

**Hard timebox: 7 days. Hard ship-date: end of week.**

**Kill criteria:** if the animation isn't done by day 5, drop the lens animation and ship just the pulse-glow on each corner. Pulse-glow alone proves the principle.

### 9c. What we explicitly do NOT build in MVP

- SSE `/api/scan/inspect` endpoint
- Pi-ai tool-call orchestration / Loop 2
- `InspectionCanvas` component refactor
- `ToolCallTimeline` component
- Phoenix / OpenAI Agents SDK tracing
- Storybook / Chromatic visual regression
- AG-UI protocol adoption
- Card Foveation v0.1 model retraining
- DINOv2 / SAM2 / CLIP backbones
- Active-learning queue
- CVAT export

These are all in §1-§7 of this plan. They wait until after a real user is using the system.

---

## 10. After the friend demo lands

In priority order, picking up §1–§7:

1. **Card Foveation v0.1 model wedge** (per `MODEL_COMPARISON_TELESCOPE.md` §"Recommended next ML wedge"): OpenCV region proposer + crop-level YOLO + region-specific eval. The eval matrix in §7C tells us if this materially helps before we commit to deeper model changes.
2. **SSE inspection event stream** with the schema in §4. Connect to existing 14-stage checklist; emit one event per current stage transition.
3. **Loop 2 wired through pi-ai**. Start with one trigger: `surface_mode === "holo" && glareRisk > 35` → agent requests `rotate_image` + `run_ding_detector` on the rotated variant, and shows the user.
4. **Tool-call timeline component** at the bottom of `/scan`.
5. **Playwright animation-correctness tests** per §7B.
6. **Phoenix tracing** for pi-ai runs.

---

## 11. North-star sentence

For the team:

> Every analysis step must have a visible visual counterpart. If the agent crops, zooms, rotates, compares, or detects, the user must see that action happen on the card.

For the user:

> The app does not "use AI." The app *inspects your card*: normalizes it, magnifies the corners and edges, runs a defect detector, and saves a timestamped evidence record.

---

## 12. Open questions to resolve before §10

- Which pi-ai event/SSE primitive do we use? (Need to read pi-ai docs for streaming tool-call shape.)
- Where do crops physically live? Local FS in MVP; S3 only when production fault tolerance lands per `PRODUCTION_FAULT_TOLERANCE.md`.
- Do we want `assistant-ui` as the chat UX foundation, or stay with our hand-rolled rail? Decide before §10.3.
- Animation accessibility: prefers-reduced-motion path needs a fallback that still shows what the agent is doing (text + bbox highlight, no motion).
