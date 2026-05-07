import {
  appendSkillProposal,
  intentBucketFor,
  matchPromotedSkills,
  type SkillProposalRecord,
} from "./skill-store";
import {
  createInspectionSkillCandidate,
  type InspectionSkillCandidate,
  type InspectionSkillTrigger,
  type InspectionToolName,
} from "./inspection-skill-evolution";
import {
  cropImage,
  glareCheckOnCrop,
  rerunDetectorOnCrop,
  type CropResult,
  type GlareCheckResult,
  type RerunDetectorResult,
} from "./image-ops";
import {
  exampleBySlug,
  exampleOutcomes,
  bandLabel,
  bandRange,
} from "../examples/registry";
import { loadAllCertifiedReferences } from "../cert-references";
import {
  loadLatestCertEvalReport,
  mapOfficialGradeToBand,
} from "../cert-references-eval";

/**
 * Inspection tool surface for the report-Q&A agent.
 *
 * Design principles (P0):
 * 1. Tools are text/data only. No raw image manipulation server-side yet —
 *    that comes once we wire `sharp` or extend FastAPI. For now, every tool
 *    works against the report JSON + frame-quality metadata the page already
 *    has. This means agent grounding is honest: tools either return data
 *    pulled from the report, or they explicitly say "no data".
 * 2. Every tool is auditable. Each call records its name + arg keys + outcome
 *    in the method trace, with no PII. The trace becomes the candidate skill
 *    feedstock.
 * 3. `propose_inspection_method` is the self-evolution hook. The agent calls
 *    it when it spots a reusable pattern. We LOG the proposal — we do NOT
 *    auto-promote. Promotion still requires benchmark + human approval.
 * 4. `request_zoom_animation` is the visible-action hook. When the agent
 *    decides to "look at" a region, it emits this tool call. The chat panel
 *    forwards the bbox to ZoomLensOverlay so the user *sees* the lens fire.
 */

// ---------- Tool input shapes (used as TypeBox at runtime via pi-ai Type) ----------

export type ToolInputs = {
  detect_card_boundary: {
    image_id?: string;
    view?: "front" | "back" | "unknown";
  };
  normalize_card: {
    image_id?: string;
    view?: "front" | "back" | "unknown";
    source_bbox?: [number, number, number, number];
  };
  get_finding_detail: { index: number };
  evaluate_glare_risk: { region: string; surface_score?: number; glare_hint?: number };
  recommend_retake: { reasons: string[] };
  cite_evidence: { index: number };
  lookup_promoted_skill: {
    finish_type?: "matte" | "glossy" | "holo" | "textured_foil" | "unknown";
    finding_type?: string;
    region?: string;
    user_intent?: string;
  };
  request_zoom_animation: {
    region:
      | "top_left_corner"
      | "top_right_corner"
      | "bottom_left_corner"
      | "bottom_right_corner"
      | "top_edge"
      | "bottom_edge"
      | "left_edge"
      | "right_edge"
      | "center"
      | "custom";
    bbox?: [number, number, number, number];
    label?: string;
  };
  compare_to_baseline: {
    region: string;
    finish_type: "matte" | "glossy" | "holo" | "textured_foil" | "unknown";
    observed_finding_type?: string;
  };
  propose_inspection_method: {
    skill_id: string;
    title: string;
    rationale: string;
    trigger: {
      finish_type?: "matte" | "glossy" | "holo" | "textured_foil" | "unknown";
      finding_type?: string;
      region?: string;
      user_question_intent?: string;
      max_confidence?: number;
      min_glare_score?: number;
    };
    steps: Array<{ tool: InspectionToolName; purpose: string; region?: string }>;
  };
  crop_finding: {
    index?: number;
    region?: string;
    bbox?: [number, number, number, number];
    padding_pct?: number;
  };
  rerun_detector_on_crop: { crop_id: string };
  glare_check_on_crop: { crop_id: string };
  run_severity_scorer: {
    finding_indices?: number[];
    materiality_threshold?: number;
  };
  create_human_review_task: {
    cert_id?: string;
    reason: string;
    priority?: "low" | "medium" | "high";
    finding_indices?: number[];
    notes?: string;
  };
  list_outcome_examples: {
    game?: "pokemon" | "one-piece" | "riftbound" | "mtg" | "sports" | "other";
    finish?: "matte" | "glossy" | "holo" | "textured_foil" | "etched_foil" | "unknown";
    tier?: "gold" | "silver_plus" | "silver" | "bronze" | "demo";
    failures_only?: boolean;
    limit?: number;
  };
  get_outcome_example: { slug: string };
  compare_to_known_outcome: { slug: string };
  compare_to_cert_reference: {
    /** Direct cert reference id, e.g. "psa_154378339". Preferred. */
    cert_id?: string;
    /** Alternative: provider + cert number. */
    provider?: "PSA" | "TAG" | "CGC" | "BGS";
    cert_number?: string;
  };
};

export type ToolName = keyof ToolInputs;

// ---------- Report shape the executor reads ----------

export type AgentReportContext = {
  cardId: string;
  reportSummary: string;
  conditionScore?: number;
  surfaceScore?: number;
  centeringScore?: number;
  edgeScore?: number;
  glareScore?: number;
  finishType?: InspectionSkillTrigger["finishType"];
  /**
   * Optional normalized image data URL. When present, the agent can call
   * crop_finding / rerun_detector_on_crop / glare_check_on_crop to inspect
   * pixels. When absent, those tools return a structured "no image attached"
   * error and the agent falls back to text-only reasoning.
   */
  imageDataUrl?: string;
  /**
   * Inference service base URL for re-running the detector on a crop.
   * Threaded through from the API route, defaults to NEXT_PUBLIC_INFERENCE_API_URL.
   */
  inferenceBaseUrl?: string;
  findings: Array<{
    type: string;
    confidence: number;
    severity: string;
    bbox: [number, number, number, number];
    zone: string;
    sha256?: string;
  }>;
  evidence: Array<{ role: string; sha256: string; path: string }>;
};

// ---------- Tool execution ----------

export type ToolCallTrace = {
  tool: ToolName;
  argsKeys: string[];
  durationMs: number;
  ok: boolean;
  resultSummary?: string;
};

export type ZoomUIAction = {
  kind: "zoom";
  region: string;
  bbox: [number, number, number, number];
  label?: string;
};

export type CropPreviewUIAction = {
  kind: "preview_crop";
  cropId: string;
  cropDataUrl: string;
  region: string;
  label?: string;
  width: number;
  height: number;
};

export type RerunPreviewUIAction = {
  kind: "rerun_result";
  cropId: string;
  findingsCount: number;
  modelVersion: string;
};

export type AgentUIAction = ZoomUIAction | CropPreviewUIAction | RerunPreviewUIAction;

export type ToolExecResultOk = {
  ok: true;
  content: Record<string, unknown>;
  trace: ToolCallTrace;
  uiAction?: AgentUIAction;
  proposedSkillId?: string;
};

export type ToolExecResultErr = {
  ok: false;
  content: { error: string };
  trace: ToolCallTrace;
};

export type ToolExecResult = ToolExecResultOk | ToolExecResultErr;

const REGION_BBOXES: Record<string, [number, number, number, number]> = {
  top_left_corner: [0, 0, 18, 14],
  top_right_corner: [82, 0, 100, 14],
  bottom_left_corner: [0, 86, 18, 100],
  bottom_right_corner: [82, 86, 100, 100],
  top_edge: [12, 0, 88, 8],
  bottom_edge: [12, 92, 88, 100],
  left_edge: [0, 14, 8, 86],
  right_edge: [92, 14, 100, 86],
  center: [22, 28, 78, 72],
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function severityBase(severity: string): number {
  const normalized = severity.toLowerCase();
  if (normalized.includes("major") || normalized.includes("high")) return 0.9;
  if (normalized.includes("moderate") || normalized.includes("medium")) return 0.65;
  if (normalized.includes("minor") || normalized.includes("low")) return 0.35;
  return 0.45;
}

function materialityMultiplier(region: string): number {
  if (region.includes("corner")) return 1.15;
  if (region.includes("edge")) return 1.08;
  if (region === "center") return 0.95;
  return 1;
}

function regionForFinding(bbox: [number, number, number, number]): string {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  if (cx < 18 && cy < 14) return "top_left_corner";
  if (cx > 82 && cy < 14) return "top_right_corner";
  if (cx < 18 && cy > 86) return "bottom_left_corner";
  if (cx > 82 && cy > 86) return "bottom_right_corner";
  if (cy < 8) return "top_edge";
  if (cy > 92) return "bottom_edge";
  if (cx < 8) return "left_edge";
  if (cx > 92) return "right_edge";
  return "center";
}

const BASELINE_PATTERNS: Record<string, Record<string, string>> = {
  holo: {
    glare_uncertain:
      "Holo finishes specular-reflect; high-confidence scratch claims need a low-glare alternate frame. Default to glare_uncertain unless surface_score>78 and finding overlaps a non-reflective region.",
    edge_wear:
      "Holo edges flake more than matte. Real edge_wear shows lifted foil or color desaturation, not just dim pixels. Require contrast-enhanced edge crop before calling production.",
    surface_anomaly:
      "On holos, vertical interference bands are a known false positive. Cross-check against the magnified crop's gradient direction before claiming surface damage.",
  },
  matte: {
    glare_uncertain:
      "Matte finishes barely reflect; persistent bright spots are usually wear, fingerprint residue, or printing defects rather than glare. Confidence floor can be lower.",
    edge_wear:
      "Matte edge_wear shows fiber lift on whitening. Strong indicator if edge_score<70 and confidence>0.55.",
  },
  glossy: {
    glare_uncertain:
      "Glossy finishes glare predictably along the light source axis. Tilt-frame retake usually resolves it.",
  },
  textured_foil: {
    surface_anomaly:
      "Textured foils have intentional pattern. Validate against background pattern map before claiming damage.",
  },
};

const RETAKE_GUIDANCE: Record<string, string> = {
  blurry: "Hold camera steady, brace elbows, tap-to-focus on the surface, capture at >= 1 / focal-length shutter.",
  glare: "Tilt the card 15-25 degrees away from the dominant light source; if indoors, move 90 deg to the lamp.",
  too_dark: "Add a second light source perpendicular to the first; avoid backlighting.",
  cropped: "Pull back so all four corners are visible with a 5% margin. Don't crop until normalize.",
  angled: "Rest the card flat. Camera 90 deg above. The frame-quality module flags angles > 8 deg.",
  motion: "Wait until the live frame-quality pill turns green for 6 stable frames.",
  low_surface_confidence: "Move closer or zoom optical (not digital). Aim for >900px on the longest edge.",
};

function emptyArgsKeys(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  return Object.keys(args as Record<string, unknown>);
}

export async function executeTool<N extends ToolName>(
  name: N,
  rawArgs: ToolInputs[N],
  ctx: AgentReportContext,
): Promise<ToolExecResult> {
  const argsKeys = emptyArgsKeys(rawArgs);
  const start = performance.now();
  try {
    let payload: Record<string, unknown>;
    let uiAction: AgentUIAction | undefined;
    let proposedSkillId: string | undefined;

    switch (name) {
      case "detect_card_boundary": {
        const args = rawArgs as ToolInputs["detect_card_boundary"];
        const hasImage = Boolean(ctx.imageDataUrl);
        payload = {
          status: hasImage ? "boundary_available_from_normalized_report" : "missing_image",
          image_id: args.image_id ?? ctx.cardId,
          view: args.view ?? "unknown",
          boundary_bbox_pct: hasImage ? ([0, 0, 100, 100] as [number, number, number, number]) : null,
          confidence: hasImage ? 0.55 : 0,
          coordinate_space: "normalized_percent",
          method:
            "Report-level normalized frame boundary. This records the agent trace; raw OpenCV/card-holder detection still belongs in the ML pipeline.",
          warning: hasImage
            ? "Boundary is inherited from the normalized report image, not recomputed from raw pixels in this TypeScript tool."
            : "No imageDataUrl is attached, so boundary detection is blocked and must create a review/image-intake task.",
          summary: hasImage ? "boundary recorded from normalized frame" : "boundary blocked: missing image",
        };
        break;
      }
      case "normalize_card": {
        const args = rawArgs as ToolInputs["normalize_card"];
        const hasImage = Boolean(ctx.imageDataUrl);
        payload = {
          status: hasImage ? "normalized_frame_available" : "missing_image",
          image_id: args.image_id ?? ctx.cardId,
          view: args.view ?? "unknown",
          source_bbox_pct: args.source_bbox ?? (hasImage ? [0, 0, 100, 100] : null),
          coordinate_space: "normalized_percent",
          normalized_image_attached: hasImage,
          foveation_regions: REGION_BBOXES,
          warning: hasImage
            ? "The scan/report pipeline supplied the normalized frame; this tool makes that state explicit for the agent trace."
            : "No normalized image is attached; collect certified/raw images before model eval can be replayed.",
          summary: hasImage ? "normalized coordinate frame available" : "normalization blocked: missing image",
        };
        break;
      }
      case "get_finding_detail": {
        const args = rawArgs as ToolInputs["get_finding_detail"];
        const finding = ctx.findings[args.index];
        if (!finding) {
          payload = { error: `No finding at index ${args.index}; report has ${ctx.findings.length}.` };
        } else {
          payload = {
            index: args.index,
            type: finding.type,
            confidence: finding.confidence,
            severity: finding.severity,
            bbox_pct: finding.bbox,
            region: regionForFinding(finding.bbox),
            zone: finding.zone,
            sha256: finding.sha256 ?? null,
          };
        }
        break;
      }
      case "evaluate_glare_risk": {
        const args = rawArgs as ToolInputs["evaluate_glare_risk"];
        const surface = args.surface_score ?? ctx.surfaceScore ?? null;
        const glare = args.glare_hint ?? ctx.glareScore ?? null;
        const finish = ctx.finishType ?? "unknown";
        const risk =
          finish === "holo" || finish === "glossy"
            ? glare !== null && glare > 0.35
              ? "high"
              : glare !== null && glare > 0.15
                ? "medium"
                : "low"
            : glare !== null && glare > 0.5
              ? "medium"
              : "low";
        payload = {
          region: args.region,
          finish_type: finish,
          surface_score: surface,
          glare_score: glare,
          risk,
          recommendation:
            risk === "high"
              ? "Retake with a tilt-frame to remove glare before claiming any surface damage in this region."
              : risk === "medium"
                ? "Treat surface findings here as glare_uncertain unless a low-glare frame confirms."
                : "Glare risk is low; surface findings here can be reported with normal confidence.",
        };
        break;
      }
      case "recommend_retake": {
        const args = rawArgs as ToolInputs["recommend_retake"];
        const items = args.reasons.map((reason) => ({
          reason,
          guidance: RETAKE_GUIDANCE[reason] ?? `No canonical guidance for "${reason}". Frame quality module may not flag this.`,
        }));
        payload = { items, summary: `${items.length} retake checklist item(s).` };
        break;
      }
      case "cite_evidence": {
        const args = rawArgs as ToolInputs["cite_evidence"];
        const finding = ctx.findings[args.index];
        if (!finding) {
          payload = { error: `No finding at index ${args.index}.` };
        } else {
          payload = {
            index: args.index,
            type: finding.type,
            bbox_pct: finding.bbox,
            sha256: finding.sha256 ?? "not_attached_to_finding",
            evidence_files: ctx.evidence.map((file) => ({ role: file.role, sha256: file.sha256 })),
            disclaimer: "AI-assisted condition signal. Not an official grade. Not legal proof.",
          };
        }
        break;
      }
      case "lookup_promoted_skill": {
        const args = rawArgs as ToolInputs["lookup_promoted_skill"];
        const matches = matchPromotedSkills({
          finishType: args.finish_type,
          findingType: args.finding_type,
          region: args.region,
          userIntent: args.user_intent,
          surfaceConfidence: ctx.surfaceScore !== undefined ? ctx.surfaceScore / 100 : undefined,
          glareScore: ctx.glareScore,
        });
        payload = {
          matched_count: matches.length,
          skills: matches.map((skill) => ({
            id: skill.skillId,
            title: skill.title,
            status: skill.status,
            steps: skill.steps,
          })),
        };
        break;
      }
      case "request_zoom_animation": {
        const args = rawArgs as ToolInputs["request_zoom_animation"];
        const bbox =
          args.region === "custom" && args.bbox
            ? args.bbox
            : (REGION_BBOXES[args.region] ?? REGION_BBOXES.center);
        payload = { region: args.region, bbox_pct: bbox, label: args.label ?? args.region };
        uiAction = { kind: "zoom", region: args.region, bbox, label: args.label };
        break;
      }
      case "compare_to_baseline": {
        const args = rawArgs as ToolInputs["compare_to_baseline"];
        const finishKey = args.finish_type;
        const findingKey = args.observed_finding_type ?? "general";
        const baseline =
          BASELINE_PATTERNS[finishKey]?.[findingKey] ??
          BASELINE_PATTERNS[finishKey]?.glare_uncertain ??
          "No baseline pattern recorded for this finish/finding combination.";
        payload = {
          finish_type: args.finish_type,
          region: args.region,
          observed_finding_type: args.observed_finding_type ?? null,
          baseline_pattern: baseline,
          source: "BASELINE_PATTERNS table; not a published authority. Treat as heuristic.",
        };
        break;
      }
      case "crop_finding": {
        const args = rawArgs as ToolInputs["crop_finding"];
        if (!ctx.imageDataUrl) {
          payload = { error: "No imageDataUrl is attached to this report context. Cannot crop." };
          break;
        }
        let bbox: [number, number, number, number] | null = null;
        let regionLabel = "custom";
        if (typeof args.index === "number") {
          const finding = ctx.findings[args.index];
          if (!finding) {
            payload = { error: `No finding at index ${args.index}.` };
            break;
          }
          bbox = finding.bbox;
          regionLabel = `finding_${args.index}_${finding.type}`;
        } else if (args.region && REGION_BBOXES[args.region]) {
          bbox = REGION_BBOXES[args.region];
          regionLabel = args.region;
        } else if (args.bbox && args.bbox.length === 4) {
          bbox = args.bbox;
          regionLabel = "custom";
        }
        if (!bbox) {
          payload = { error: "Provide either index, region, or bbox to crop_finding." };
          break;
        }
        const cropResult: CropResult = await cropImage({
          imageDataUrl: ctx.imageDataUrl,
          bboxPct: bbox,
          paddingPct: args.padding_pct ?? 4,
          region: regionLabel,
        });
        if (!cropResult.ok) {
          payload = { error: cropResult.error };
          break;
        }
        payload = {
          crop_id: cropResult.cropId,
          width: cropResult.width,
          height: cropResult.height,
          source_sha256: cropResult.sourceSha256,
          bbox_pct: bbox,
          bbox_px: cropResult.bboxPx,
          region: regionLabel,
          message: `Cropped ${cropResult.width}×${cropResult.height} region. Pass crop_id to rerun_detector_on_crop or glare_check_on_crop.`,
        };
        uiAction = {
          kind: "preview_crop",
          cropId: cropResult.cropId,
          cropDataUrl: cropResult.cropDataUrl,
          region: regionLabel,
          label: regionLabel,
          width: cropResult.width,
          height: cropResult.height,
        };
        break;
      }
      case "rerun_detector_on_crop": {
        const args = rawArgs as ToolInputs["rerun_detector_on_crop"];
        const baseUrl = ctx.inferenceBaseUrl ?? "http://localhost:8000";
        const result: RerunDetectorResult = await rerunDetectorOnCrop({
          cropId: args.crop_id,
          inferenceBaseUrl: baseUrl,
        });
        if (!result.ok) {
          payload = { error: result.error };
          break;
        }
        payload = {
          crop_id: args.crop_id,
          findings: result.findings,
          findings_count: result.findings.length,
          condition_score: result.conditionScore,
          model_version: result.modelVersion,
          summary: result.summary,
        };
        uiAction = {
          kind: "rerun_result",
          cropId: args.crop_id,
          findingsCount: result.findings.length,
          modelVersion: result.modelVersion,
        };
        break;
      }
      case "glare_check_on_crop": {
        const args = rawArgs as ToolInputs["glare_check_on_crop"];
        const result: GlareCheckResult = await glareCheckOnCrop(args.crop_id);
        if (!result.ok) {
          payload = { error: result.error };
          break;
        }
        payload = {
          crop_id: args.crop_id,
          glare_score: result.glareScore,
          bright_fraction: result.brightFraction,
          mean_luminance: result.meanLuminance,
          max_luminance: result.maxLuminance,
          finish_hint: result.finishHint,
          interpretation:
            result.finishHint === "high_glare"
              ? "Strong specular highlight present. Treat any surface finding in this crop as glare_uncertain."
              : result.finishHint === "moderate_glare"
                ? "Moderate glare. Cross-check with an alternate frame before high-confidence surface claims."
                : "Low glare. Surface findings here can be reported with normal confidence.",
        };
        break;
      }
      case "run_severity_scorer": {
        const args = rawArgs as ToolInputs["run_severity_scorer"];
        const threshold = Math.max(0.1, Math.min(0.95, args.materiality_threshold ?? 0.65));
        const selected =
          Array.isArray(args.finding_indices) && args.finding_indices.length > 0
            ? args.finding_indices
                .map((index) => ({ index, finding: ctx.findings[index] }))
                .filter((entry): entry is { index: number; finding: AgentReportContext["findings"][number] } =>
                  Boolean(entry.finding),
                )
            : ctx.findings.map((finding, index) => ({ index, finding }));
        const scored = selected.map(({ index, finding }) => {
          const region = regionForFinding(finding.bbox);
          const confidence = clamp01(finding.confidence);
          const base = severityBase(finding.severity);
          const materialityScore = clamp01((confidence * 0.55 + base * 0.45) * materialityMultiplier(region));
          const materialToGrade = materialityScore >= threshold;
          return {
            index,
            type: finding.type,
            zone: finding.zone,
            region,
            bbox_pct: finding.bbox,
            confidence,
            severity: finding.severity,
            severity_score: Number(materialityScore.toFixed(3)),
            material_to_condition_band: materialToGrade,
            rationale: materialToGrade
              ? "Finding crosses the current materiality threshold for condition-band calibration."
              : "Finding is logged as visible evidence but below the current materiality threshold.",
            sha256: finding.sha256 ?? null,
          };
        });
        payload = {
          threshold,
          finding_count: scored.length,
          material_count: scored.filter((finding) => finding.material_to_condition_band).length,
          uncertain_count: scored.filter((finding) => !finding.material_to_condition_band).length,
          findings: scored,
          summary: `${scored.length} finding(s) severity-scored; ${scored.filter((finding) => finding.material_to_condition_band).length} material.`,
          honesty_note:
            "This is a deterministic severity/materiality scorer for agent traces. It is not an official grading rubric.",
        };
        break;
      }
      case "create_human_review_task": {
        const args = rawArgs as ToolInputs["create_human_review_task"];
        const indices = args.finding_indices ?? ctx.findings.map((_finding, index) => index);
        const taskId = `review-${ctx.cardId}-${Date.now()}`;
        payload = {
          task_id: taskId,
          cert_id: args.cert_id ?? null,
          card_id: ctx.cardId,
          priority: args.priority ?? "medium",
          reason: args.reason,
          notes: args.notes ?? null,
          finding_indices: indices,
          finding_count: indices.length,
          required_outputs: [
            "confirm card identity/reference",
            "confirm raw or slab image provenance",
            "mark each DING bbox/type/severity/materiality",
            "state whether the model claim is supported, uncertain, or wrong",
          ],
          storage_contract:
            "Persist completed reviews through /api/cert-references/human-ding-reviews; this agent tool only drafts the task in the trace.",
          summary: `human review task drafted for ${args.cert_id ?? ctx.cardId}`,
        };
        break;
      }
      case "list_outcome_examples": {
        const args = rawArgs as ToolInputs["list_outcome_examples"];
        const limit = Math.max(1, Math.min(20, args.limit ?? 8));
        const filtered = exampleOutcomes
          .filter((entry) => !args.game || entry.game === args.game)
          .filter((entry) => !args.finish || entry.finish === args.finish)
          .filter((entry) => !args.tier || entry.tier === args.tier)
          .filter((entry) => !args.failures_only || Boolean(entry.failureMode))
          .slice(0, limit);
        payload = {
          count: filtered.length,
          total_in_library: exampleOutcomes.length,
          examples: filtered.map((entry) => ({
            slug: entry.slug,
            title: entry.title,
            game: entry.game,
            finish: entry.finish,
            tier: entry.tier,
            official_grade: entry.knownOutcome?.grade ?? null,
            our_band: bandLabel(entry.ourPrediction.band),
            matched: entry.ourPrediction.matchedKnownOutcome,
            failure_mode: entry.failureMode ?? null,
          })),
        };
        break;
      }
      case "get_outcome_example": {
        const args = rawArgs as ToolInputs["get_outcome_example"];
        const example = exampleBySlug(args.slug);
        if (!example) {
          payload = { error: `No example found at slug "${args.slug}".` };
          break;
        }
        payload = {
          slug: example.slug,
          title: example.title,
          game: example.game,
          finish: example.finish,
          tier: example.tier,
          trust_reason: example.trustBadgeReason,
          official_outcome: example.knownOutcome
            ? {
                grader: example.knownOutcome.grader,
                grade: example.knownOutcome.grade,
                cert_url: example.knownOutcome.certUrl,
                band_label: bandLabel(example.knownOutcome.band),
                band_range: bandRange(example.knownOutcome.band),
              }
            : null,
          our_prediction: {
            score: example.ourPrediction.benchmarkScore,
            band_label: bandLabel(example.ourPrediction.band),
            band_range: bandRange(example.ourPrediction.band),
            confidence: example.ourPrediction.confidence,
            matched: example.ourPrediction.matchedKnownOutcome,
            notes: example.ourPrediction.notes,
          },
          dings: example.dings.map((ding) => ({
            type: ding.type,
            bbox_pct: ding.bbox,
            severity: ding.severity,
            material_to_grade: ding.materialToGrade,
            note: ding.note,
            source: ding.source,
          })),
          failure_mode: example.failureMode ?? null,
          why_not_higher: example.whyThisGradeNotHigher ?? [],
          provenance: {
            identity_image_source: example.provenance.identityImageSource,
            identity_image_attribution: example.provenance.identityImageAttribution,
            external_reference_url: example.provenance.externalReferenceUrl ?? null,
          },
        };
        break;
      }
      case "compare_to_known_outcome": {
        const args = rawArgs as ToolInputs["compare_to_known_outcome"];
        const example = exampleBySlug(args.slug);
        if (!example) {
          payload = { error: `No example found at slug "${args.slug}".` };
          break;
        }
        const matched = example.ourPrediction.matchedKnownOutcome;
        payload = {
          slug: example.slug,
          official_grade: example.knownOutcome?.grade ?? null,
          official_band: example.knownOutcome ? bandLabel(example.knownOutcome.band) : null,
          our_score: example.ourPrediction.benchmarkScore,
          our_band: bandLabel(example.ourPrediction.band),
          confidence: example.ourPrediction.confidence,
          match_status: matched === true ? "matched" : matched === false ? "mismatched" : "no_official_outcome",
          why_not_higher: example.whyThisGradeNotHigher ?? [],
          honesty_note: matched
            ? "Our band lands the official outcome with documented DINGs."
            : matched === false
              ? "We did not match the official outcome. See failure_mode and why_not_higher."
              : "No official outcome attached — annotation provenance only.",
          failure_mode: example.failureMode ?? null,
        };
        break;
      }
      case "compare_to_cert_reference": {
        const args = rawArgs as ToolInputs["compare_to_cert_reference"];
        const refs = loadAllCertifiedReferences();
        const ref = args.cert_id
          ? refs.find((r) => r.id === args.cert_id)
          : args.provider && args.cert_number
            ? refs.find((r) => r.provider === args.provider && r.certNumber === args.cert_number)
            : null;
        if (!ref) {
          payload = {
            error:
              "Cert reference not found. Pass cert_id (e.g. psa_154378339) or provider + cert_number. Use list_outcome_examples with tier=silver_plus to find candidates.",
          };
          break;
        }
        const officialBand = mapOfficialGradeToBand(ref);
        const evalReport = loadLatestCertEvalReport("latest");
        const evalRow = evalReport?.rows.find((row) => row.certId === ref.id) ?? null;
        const ourPredictedBand = evalRow?.predictedBand ?? null;
        const bandAgreement = evalRow?.bandAgreement ?? "no_official_band";
        // Self-correction guidance — what the agent should consider doing when
        // the prediction does not match the cert reference. NOT prescriptive,
        // not auto-promoted, not a grade claim.
        const selfCorrectionHints: string[] = [];
        if (bandAgreement === "mismatch") {
          selfCorrectionHints.push(
            "Mismatch detected. Consider proposing an inspection method (propose_inspection_method) that re-runs glare_check_on_crop and rerun_detector_on_crop on the slab edges before scoring.",
          );
          if (ref.trustTier === "silver_plus") {
            selfCorrectionHints.push(
              "Silver+ slab — request a tilt-frame inspection on the slab face to separate slab-glare from material DINGs.",
            );
          }
        } else if (bandAgreement === "adjacent") {
          selfCorrectionHints.push(
            "Adjacent band — check whether sub-grade evidence (centering / edges / surface) explains the gap before claiming a different band.",
          );
        }
        payload = {
          cert_id: ref.id,
          provider: ref.provider,
          cert_number: ref.certNumber,
          trust_tier: ref.trustTier,
          official_grade: ref.officialGrade ?? null,
          official_band: officialBand,
          official_band_label: officialBand ? bandLabel(officialBand) : null,
          card_identity: ref.cardIdentity ?? null,
          our_predicted_band: ourPredictedBand,
          our_predicted_band_label: ourPredictedBand ? bandLabel(ourPredictedBand) : null,
          band_agreement: bandAgreement,
          band_distance: evalRow?.bandDistance ?? null,
          eval_model_version: evalReport?.modelVersion ?? null,
          eval_evaluated_at: evalReport?.evaluatedAt ?? null,
          self_correction_hints: selfCorrectionHints,
          honesty_note:
            "We compare our internal condition band against the official cert. We never claim to predict the exact grader grade.",
          training_allowed: ref.trainingAllowed,
          policy: ref.ingestionPolicy,
          warnings: ref.warnings,
        };
        break;
      }
      case "propose_inspection_method": {
        const args = rawArgs as ToolInputs["propose_inspection_method"];
        const candidate: InspectionSkillCandidate = createInspectionSkillCandidate({
          skillId: args.skill_id,
          title: args.title,
          trigger: {
            finishType: args.trigger.finish_type,
            findingType: args.trigger.finding_type,
            region: args.trigger.region,
            userQuestionIntent: args.trigger.user_question_intent,
            maxConfidence: args.trigger.max_confidence,
            minGlareScore: args.trigger.min_glare_score,
          },
          steps: args.steps,
        });
        const proposal: SkillProposalRecord = {
          proposalId: `prop-${Date.now()}-${candidate.skillId}`,
          ts: new Date().toISOString(),
          source: "agent_self_proposal",
          proposed: candidate,
          evidenceTraceIds: [],
          rationale: args.rationale,
        };
        appendSkillProposal(proposal);
        proposedSkillId = candidate.skillId;
        payload = {
          recorded: true,
          proposal_id: proposal.proposalId,
          skill_id: candidate.skillId,
          status: candidate.status,
          message:
            "Method proposal logged as a draft candidate. It is NOT active for users. Promotion to staging/canary/production requires benchmark + human approval.",
        };
        break;
      }
      default: {
        payload = { error: `Unknown tool ${String(name)}.` };
      }
    }

    const durationMs = Math.round(performance.now() - start);
    return {
      ok: true,
      content: payload,
      trace: {
        tool: name,
        argsKeys,
        durationMs,
        ok: !("error" in payload),
        resultSummary:
          typeof payload.summary === "string"
            ? payload.summary
            : typeof payload.message === "string"
              ? payload.message
              : undefined,
      },
      uiAction,
      proposedSkillId,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    return {
      ok: false,
      content: { error: error instanceof Error ? error.message : "tool execution failed" },
      trace: { tool: name, argsKeys, durationMs, ok: false },
    };
  }
}

/**
 * Build the pi-ai tool descriptors at runtime. Type is loaded from pi-ai
 * because the package owns its own TypeBox factory.
 */
export async function buildToolDescriptors() {
  const { Type } = await import("@mariozechner/pi-ai");
  return [
    {
      name: "detect_card_boundary" satisfies ToolName,
      description:
        "Record card-boundary detection state for the current report image. Returns normalized bbox when an image is attached, or an explicit missing-image state. Use before normalization/crops.",
      parameters: Type.Object({
        image_id: Type.Optional(Type.String()),
        view: Type.Optional(Type.String()),
      }),
    },
    {
      name: "normalize_card" satisfies ToolName,
      description:
        "Record the normalized card coordinate frame and foveation regions. Use after detect_card_boundary and before crop/zoom/detector tools.",
      parameters: Type.Object({
        image_id: Type.Optional(Type.String()),
        view: Type.Optional(Type.String()),
        source_bbox: Type.Optional(Type.Array(Type.Number())),
      }),
    },
    {
      name: "get_finding_detail" satisfies ToolName,
      description: "Fetch full info for one finding (DING) by index. Returns bbox, region, severity, sha256.",
      parameters: Type.Object({ index: Type.Integer() }),
    },
    {
      name: "evaluate_glare_risk" satisfies ToolName,
      description:
        "Estimate glare risk for a region using surface_score, glare_score, and finish_type. Use this before calling a scratch on a holo card.",
      parameters: Type.Object({
        region: Type.String(),
        surface_score: Type.Optional(Type.Number()),
        glare_hint: Type.Optional(Type.Number()),
      }),
    },
    {
      name: "recommend_retake" satisfies ToolName,
      description:
        "Build a retake checklist. reasons must be a subset of: blurry, glare, too_dark, cropped, angled, motion, low_surface_confidence.",
      parameters: Type.Object({ reasons: Type.Array(Type.String()) }),
    },
    {
      name: "cite_evidence" satisfies ToolName,
      description:
        "Return the SHA-256 hash and bbox attached to a finding. Use this when the user asks for proof or audit trail.",
      parameters: Type.Object({ index: Type.Integer() }),
    },
    {
      name: "lookup_promoted_skill" satisfies ToolName,
      description:
        "Search the promoted skill registry for a method that matches the current context. Use this BEFORE proposing a new method.",
      parameters: Type.Object({
        finish_type: Type.Optional(Type.String()),
        finding_type: Type.Optional(Type.String()),
        region: Type.Optional(Type.String()),
        user_intent: Type.Optional(Type.String()),
      }),
    },
    {
      name: "request_zoom_animation" satisfies ToolName,
      description:
        "Tell the UI to fire the zoom-lens overlay on a region. The user sees the inspection happen. Use this to make your reasoning visible — call it BEFORE you describe what you observe in that region.",
      parameters: Type.Object({
        region: Type.String(),
        bbox: Type.Optional(Type.Array(Type.Number())),
        label: Type.Optional(Type.String()),
      }),
    },
    {
      name: "compare_to_baseline" satisfies ToolName,
      description:
        "Compare a region's finding against the baseline pattern table for that finish_type. Returns heuristic guidance only.",
      parameters: Type.Object({
        region: Type.String(),
        finish_type: Type.String(),
        observed_finding_type: Type.Optional(Type.String()),
      }),
    },
    {
      name: "crop_finding" satisfies ToolName,
      description:
        "Crop a region from the normalized card image. Provide either index (a finding's bbox), region (corner/edge name), or bbox (raw [x1,y1,x2,y2] in percent). Returns crop_id you can pass to rerun_detector_on_crop or glare_check_on_crop. The user sees the crop preview in the chat.",
      parameters: Type.Object({
        index: Type.Optional(Type.Integer()),
        region: Type.Optional(Type.String()),
        bbox: Type.Optional(Type.Array(Type.Number())),
        padding_pct: Type.Optional(Type.Number()),
      }),
    },
    {
      name: "rerun_detector_on_crop" satisfies ToolName,
      description:
        "Re-run the DING detector on a previously cropped region. Use this to disambiguate a low-confidence finding by giving the model a closer look. Requires the inference service to be online.",
      parameters: Type.Object({ crop_id: Type.String() }),
    },
    {
      name: "glare_check_on_crop" satisfies ToolName,
      description:
        "Compute a quantitative glare score for a cropped region using pixel statistics. Returns glare_score (0..1), finish_hint (high_glare / moderate_glare / low_glare), and interpretation guidance. Use this BEFORE calling a scratch on a holo or glossy card.",
      parameters: Type.Object({ crop_id: Type.String() }),
    },
    {
      name: "run_severity_scorer" satisfies ToolName,
      description:
        "Convert detector findings into deterministic severity/materiality scores for condition-band calibration. Use before condition-band comparison and before making any claim about material DINGs.",
      parameters: Type.Object({
        finding_indices: Type.Optional(Type.Array(Type.Integer())),
        materiality_threshold: Type.Optional(Type.Number()),
      }),
    },
    {
      name: "create_human_review_task" satisfies ToolName,
      description:
        "Draft a human DING-review task when the evidence is missing, low-confidence, or mismatched against a certified reference. Persist completed reviews through /api/cert-references/human-ding-reviews.",
      parameters: Type.Object({
        cert_id: Type.Optional(Type.String()),
        reason: Type.String(),
        priority: Type.Optional(Type.String()),
        finding_indices: Type.Optional(Type.Array(Type.Integer())),
        notes: Type.Optional(Type.String()),
      }),
    },
    {
      name: "list_outcome_examples" satisfies ToolName,
      description:
        "Browse the Verified Outcome Library — real card examples with official outcomes (PSA cert references), open Roboflow training annotations, and synthetic failure cases. Filter by game, finish, trust tier, or failures-only. Use this when the user asks 'show me examples like this card' or 'how does the model do on holos?'",
      parameters: Type.Object({
        game: Type.Optional(Type.String()),
        finish: Type.Optional(Type.String()),
        tier: Type.Optional(Type.String()),
        failures_only: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Integer()),
      }),
    },
    {
      name: "get_outcome_example" satisfies ToolName,
      description:
        "Fetch a single Verified Outcome Library entry by slug. Returns official outcome (if any), our model's prediction, DING annotations with material-to-grade flags, failure_mode, why_not_higher reasons, and provenance.",
      parameters: Type.Object({ slug: Type.String() }),
    },
    {
      name: "compare_to_known_outcome" satisfies ToolName,
      description:
        "Compare our model's prediction against the official outcome for a library example. Returns match_status (matched / mismatched / no_official_outcome), why_not_higher reasons, and an honesty_note. Use this to ground a claim like 'this card looks like a Mint 9' against verified data.",
      parameters: Type.Object({ slug: Type.String() }),
    },
    {
      name: "compare_to_cert_reference" satisfies ToolName,
      description:
        "Compare our internal predicted band against an official PSA/TAG/CGC/BGS cert reference. Pass either cert_id (preferred) or provider + cert_number. Returns official_band, our_predicted_band, band_agreement (match / adjacent / mismatch / no_official_band), and self_correction_hints — practical inspection-method ideas the agent should consider proposing when the prediction does not match. This is the self-correction loop entry point. Never claims to predict the exact grader grade.",
      parameters: Type.Object({
        cert_id: Type.Optional(Type.String()),
        provider: Type.Optional(Type.String()),
        cert_number: Type.Optional(Type.String()),
      }),
    },
    {
      name: "propose_inspection_method" satisfies ToolName,
      description:
        "Log a candidate reusable inspection method. Use this when you discover a workflow that worked well and could help future inspections. The proposal is saved as a draft — it is NOT activated. Benchmark + human approval are required before promotion.",
      parameters: Type.Object({
        skill_id: Type.String(),
        title: Type.String(),
        rationale: Type.String(),
        trigger: Type.Object({
          finish_type: Type.Optional(Type.String()),
          finding_type: Type.Optional(Type.String()),
          region: Type.Optional(Type.String()),
          user_question_intent: Type.Optional(Type.String()),
          max_confidence: Type.Optional(Type.Number()),
          min_glare_score: Type.Optional(Type.Number()),
        }),
        steps: Type.Array(
          Type.Object({
            tool: Type.String(),
            purpose: Type.String(),
            region: Type.Optional(Type.String()),
          }),
        ),
      }),
    },
  ];
}

export { intentBucketFor, REGION_BBOXES };
