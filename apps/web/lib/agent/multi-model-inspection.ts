export type InspectionTask =
  | "report_explanation"
  | "hard_region_reinspection"
  | "surface_glare_analysis"
  | "before_after_comparison"
  | "method_discovery"
  | "human_review_assist"
  | "code_experiment_generation"
  | "cert_reference_analysis";

export type DataSensitivity =
  | "public_demo"
  | "vendor_private"
  | "user_private"
  | "gold_training_candidate"
  | "public_open_source_fixture";

export type ProviderPolicy =
  | "direct_openai"
  | "direct_google_gemini"
  | "openrouter_zdr_only"
  | "openrouter_allowed"
  | "kilo_research_only"
  | "local_only";

export type InspectionReleaseMode = "demo" | "certified_reference_alpha" | "trust_beta" | "production";

export type AnnotationSource =
  | "local_yolo"
  | "crop_yolo"
  | "surface_anomaly"
  | "gemini_visual_thinking"
  | "openai_visual_reasoning"
  | "openrouter_frontier"
  | "human_review";

export type AnnotationLabel =
  | "edge_wear"
  | "corner_wear"
  | "scratch"
  | "crease"
  | "dent"
  | "surface_contamination"
  | "print_line"
  | "glare_uncertain"
  | "no_material_ding"
  | "unknown_damage";

export type AnnotationSeverity = "minor" | "moderate" | "major" | "severe";
export type AnnotationMateriality = "not_material" | "material_ding" | "dominant_ding" | "uncertain";
export type BboxNorm = [number, number, number, number];

export type InspectionModelRoute = {
  task: InspectionTask;
  dataSensitivity: DataSensitivity;
  providerPolicy: ProviderPolicy;
  provider: "openai" | "google_gemini" | "openrouter" | "kilo" | "local";
  modelName: string;
  allowed: boolean;
  imageAllowed: boolean;
  researchOnly: boolean;
  reason: string;
};

export type EvidenceImage = {
  id: string;
  role: string;
  sha256: string;
  dataUrl?: string;
};

export type InspectionToolEvent = {
  id: string;
  type: "tool.started" | "tool.completed" | "tool.skipped" | "annotation.candidate" | "annotation.fused" | "human_review.created";
  tool: string;
  label: string;
  target?: {
    imageId?: string;
    bboxNorm?: BboxNorm;
    region?: string;
  };
  output?: Record<string, unknown>;
};

export type AnnotationCandidate = {
  id: string;
  source: AnnotationSource;
  modelName: string;
  toolChain: string[];
  imageId: string;
  region: string;
  bboxNorm?: BboxNorm;
  label: AnnotationLabel;
  confidence: number;
  severity?: AnnotationSeverity;
  materiality?: AnnotationMateriality;
  evidenceImageIds: string[];
  rationale: string;
  grounding: {
    toolOutputIds: string[];
    reportIds: string[];
    imageHashes: string[];
  };
};

export type FinalDingAnnotation = AnnotationCandidate & {
  source: "local_yolo" | "crop_yolo" | "surface_anomaly" | "human_review";
  supportingCandidateIds: string[];
  disagreementCandidateIds: string[];
  fusionDecision: "accepted" | "human_override" | "needs_review";
};

export type HumanReviewTask = {
  id: string;
  reason: string;
  priority: "low" | "medium" | "high";
  candidateIds: string[];
  region?: string;
  bboxNorm?: BboxNorm;
};

export type VisualInspectionInput = {
  runId?: string;
  scanSessionId: string;
  releaseMode: InspectionReleaseMode;
  dataSensitivity: DataSensitivity;
  providerPolicy?: ProviderPolicy;
  inputImages: EvidenceImage[];
  mlDetections: Array<{
    id?: string;
    type: string;
    zone: string;
    confidence: number;
    severity?: string;
    bbox: BboxNorm;
    source?: string;
  }>;
  qualityScores?: {
    glareScore?: number;
    surfaceScore?: number;
    edgeScore?: number;
    centeringScore?: number;
  };
  reportIds?: string[];
};

export type AgentRun = {
  runId: string;
  scanSessionId: string;
  releaseMode: InspectionReleaseMode;
  providerPolicy: ProviderPolicy;
  primaryModel: string;
  fallbackModels: string[];
  inputImages: EvidenceImage[];
  toolEvents: InspectionToolEvent[];
  annotationCandidates: AnnotationCandidate[];
  fusedAnnotations: FinalDingAnnotation[];
  humanReviewTasks: HumanReviewTask[];
  reportPatch: {
    visibleDingCount: number;
    modelConsensus: Array<{
      label: AnnotationLabel;
      region: string;
      confidence: number;
      sources: AnnotationSource[];
      decision: FinalDingAnnotation["fusionDecision"];
    }>;
  };
};

const PRIVATE_SENSITIVITY = new Set<DataSensitivity>(["vendor_private", "user_private", "gold_training_candidate"]);

const FOVEATED_REGION_BBOXES: Array<{ region: string; bboxNorm: BboxNorm; tool: "crop_corner" | "crop_edge_strip" | "crop_surface" }> = [
  { region: "top_left_corner", bboxNorm: [0, 0, 0.22, 0.22], tool: "crop_corner" },
  { region: "top_right_corner", bboxNorm: [0.78, 0, 1, 0.22], tool: "crop_corner" },
  { region: "bottom_right_corner", bboxNorm: [0.78, 0.78, 1, 1], tool: "crop_corner" },
  { region: "bottom_left_corner", bboxNorm: [0, 0.78, 0.22, 1], tool: "crop_corner" },
  { region: "top_edge", bboxNorm: [0, 0, 1, 0.12], tool: "crop_edge_strip" },
  { region: "right_edge", bboxNorm: [0.88, 0, 1, 1], tool: "crop_edge_strip" },
  { region: "bottom_edge", bboxNorm: [0, 0.88, 1, 1], tool: "crop_edge_strip" },
  { region: "left_edge", bboxNorm: [0, 0, 0.12, 1], tool: "crop_edge_strip" },
  { region: "surface_center", bboxNorm: [0.18, 0.18, 0.82, 0.82], tool: "crop_surface" },
];

const DEFAULT_MODELS: Record<ProviderPolicy, { provider: InspectionModelRoute["provider"]; modelName: string }> = {
  direct_openai: { provider: "openai", modelName: "openai-vision-direct" },
  direct_google_gemini: { provider: "google_gemini", modelName: "gemini-visual-direct" },
  openrouter_zdr_only: { provider: "openrouter", modelName: "openrouter-zdr-approved" },
  openrouter_allowed: { provider: "openrouter", modelName: "openrouter-approved-public" },
  kilo_research_only: { provider: "kilo", modelName: "kilo-auto/frontier" },
  local_only: { provider: "local", modelName: "local-tools-only" },
};

export class InspectionModelRouter {
  route(task: InspectionTask, dataSensitivity: DataSensitivity, preferredPolicy?: ProviderPolicy): InspectionModelRoute {
    const providerPolicy = preferredPolicy ?? this.defaultPolicyFor(task, dataSensitivity);
    const model = DEFAULT_MODELS[providerPolicy];
    const blockedPrivate =
      PRIVATE_SENSITIVITY.has(dataSensitivity) &&
      (providerPolicy === "openrouter_allowed" || providerPolicy === "kilo_research_only");
    const blockedRuntimeKilo = providerPolicy === "kilo_research_only" && task !== "code_experiment_generation";
    const allowed = !blockedPrivate && !blockedRuntimeKilo;

    return {
      task,
      dataSensitivity,
      providerPolicy,
      provider: model.provider,
      modelName: model.modelName,
      allowed,
      imageAllowed: allowed && providerPolicy !== "kilo_research_only",
      researchOnly: providerPolicy === "kilo_research_only",
      reason: allowed
        ? this.reasonForAllowed(task, dataSensitivity, providerPolicy)
        : blockedRuntimeKilo
          ? "Kilo Auto Model is dev/research-only and is blocked in production inspection runtime."
          : "Private/vendor/Gold data cannot be sent to free or non-ZDR broad routing providers.",
    };
  }

  defaultPolicyFor(task: InspectionTask, dataSensitivity: DataSensitivity): ProviderPolicy {
    if (task === "code_experiment_generation") return "kilo_research_only";
    if (PRIVATE_SENSITIVITY.has(dataSensitivity)) return "local_only";
    if (task === "surface_glare_analysis" || task === "hard_region_reinspection") return "direct_google_gemini";
    if (task === "report_explanation") return "direct_openai";
    return "local_only";
  }

  private reasonForAllowed(task: InspectionTask, dataSensitivity: DataSensitivity, providerPolicy: ProviderPolicy) {
    if (providerPolicy === "local_only") return "Local deterministic tools only; no external image sharing.";
    if (providerPolicy === "openrouter_zdr_only") return "Allowed only through a zero-data-retention provider route.";
    if (providerPolicy === "kilo_research_only") return "Allowed for sandboxed developer research, not user runtime.";
    return `${providerPolicy} allowed for ${dataSensitivity} ${task}.`;
  }
}

export class AnnotationFusionEngine {
  fuse(candidates: AnnotationCandidate[]): { annotations: FinalDingAnnotation[]; humanReviewTasks: HumanReviewTask[] } {
    const accepted: FinalDingAnnotation[] = [];
    const reviewTasks: HumanReviewTask[] = [];
    const used = new Set<string>();

    for (const candidate of sortedCandidates(candidates)) {
      if (used.has(candidate.id)) continue;
      const group = candidates.filter((other) => !used.has(other.id) && candidatesOverlap(candidate, other));
      group.forEach((item) => used.add(item.id));

      const human = group.find((item) => item.source === "human_review");
      const local = group.find((item) => item.source === "local_yolo" || item.source === "crop_yolo" || item.source === "surface_anomaly");
      const llmOnly = !local && !human;
      const disagreeing = group.filter((item) => !labelsCompatible(item.label, candidate.label));

      if (human) {
        accepted.push(toFinal(human, group, disagreeing, "human_override"));
        continue;
      }

      if (llmOnly || disagreeing.length > 0 || isLowConfidenceGroup(group)) {
        reviewTasks.push({
          id: `review-${candidate.id}`,
          reason: llmOnly
            ? "LLM/frontier-only candidate cannot become a final DING without human review."
            : disagreeing.length > 0
              ? "Candidate disagreement across inspection sources."
              : "Low-confidence or glare-sensitive candidate needs review.",
          priority: candidate.label === "scratch" || candidate.label === "glare_uncertain" ? "high" : "medium",
          candidateIds: group.map((item) => item.id),
          region: candidate.region,
          bboxNorm: candidate.bboxNorm,
        });
        if (local) accepted.push(toFinal(local, group, disagreeing, "needs_review"));
        continue;
      }

      if (local) accepted.push(toFinal(local, group, disagreeing, "accepted"));
    }

    return { annotations: accepted, humanReviewTasks: reviewTasks };
  }
}

export class VisualInspectionAgentRuntime {
  private router: InspectionModelRouter;
  private fusion: AnnotationFusionEngine;

  constructor(options: { router?: InspectionModelRouter; fusion?: AnnotationFusionEngine } = {}) {
    this.router = options.router ?? new InspectionModelRouter();
    this.fusion = options.fusion ?? new AnnotationFusionEngine();
  }

  inspect(input: VisualInspectionInput): AgentRun {
    const runId = input.runId ?? `agent-run-${input.scanSessionId}`;
    const providerPolicy = input.providerPolicy ?? this.router.defaultPolicyFor("hard_region_reinspection", input.dataSensitivity);
    const route = this.router.route("hard_region_reinspection", input.dataSensitivity, providerPolicy);
    const events: InspectionToolEvent[] = [];
    const reportIds = input.reportIds ?? [];
    const image = input.inputImages[0] ?? { id: "normalized_front", role: "front_normalized", sha256: "missing" };
    const candidates = candidatesFromLocalDetections(input, image, reportIds);

    events.push({
      id: `tool-normalize-${runId}`,
      type: "tool.completed",
      tool: "normalize_card",
      label: "Normalized card coordinate frame established",
      target: { imageId: image.id },
      output: {
        imageHash: image.sha256,
        foveationRegions: FOVEATED_REGION_BBOXES.map((region) => region.region),
      },
    });

    for (const region of FOVEATED_REGION_BBOXES) {
      const hits = input.mlDetections.filter((detection) => {
        const source = String(detection.source ?? "");
        return detection.zone === region.region || source.includes(`:crop:${region.region}`);
      });
      events.push({
        id: `tool-foveate-${region.region}`,
        type: "tool.completed",
        tool: region.tool,
        label: `${region.region.replaceAll("_", " ")} inspected`,
        target: { imageId: image.id, bboxNorm: region.bboxNorm, region: region.region },
        output: {
          candidates: hits.length,
          detector: hits.length > 0 ? "crop_yolo" : "no_candidate_above_threshold",
        },
      });
    }

    for (const detection of input.mlDetections) {
      const bboxNorm = coerceBboxNorm(detection.bbox);
      const region = detection.zone;
      const lowConfidence = detection.confidence < 0.7;
      const glareRisk = (input.qualityScores?.glareScore ?? 0) > 0.3 || detection.type === "scratch";

      events.push({
        id: `tool-crop-${detection.id ?? region}`,
        type: "tool.started",
        tool: "crop_region",
        label: `Cropping ${region}`,
        target: { imageId: image.id, bboxNorm, region },
      });

      if (glareRisk) {
        events.push({
          id: `tool-glare-${detection.id ?? region}`,
          type: route.allowed ? "tool.started" : "tool.skipped",
          tool: "generate_glare_mask",
          label: route.allowed ? `Checking glare in ${region}` : `Glare reinspection blocked by provider policy`,
          target: { imageId: image.id, bboxNorm, region },
          output: { providerPolicy: route.providerPolicy, reason: route.reason },
        });
      }

      if (lowConfidence || glareRisk) {
        events.push({
          id: `tool-review-${detection.id ?? region}`,
          type: "tool.completed",
          tool: "create_human_review_task",
          label: `Queued ${region} for review when confidence is low or glare-sensitive`,
          target: { imageId: image.id, bboxNorm, region },
        });
      }
    }

    const fused = this.fusion.fuse(candidates);
    for (const candidate of candidates) {
      events.push({
        id: `candidate-${candidate.id}`,
        type: "annotation.candidate",
        tool: candidate.toolChain[candidate.toolChain.length - 1] ?? "unknown",
        label: `${candidate.source}: ${candidate.label} ${Math.round(candidate.confidence * 100)}%`,
        target: { imageId: candidate.imageId, bboxNorm: candidate.bboxNorm, region: candidate.region },
        output: { candidateId: candidate.id, modelName: candidate.modelName },
      });
    }
    for (const task of fused.humanReviewTasks) {
      events.push({
        id: task.id,
        type: "human_review.created",
        tool: "create_human_review_task",
        label: task.reason,
        target: { bboxNorm: task.bboxNorm, region: task.region },
        output: { priority: task.priority, candidateIds: task.candidateIds },
      });
    }

    return {
      runId,
      scanSessionId: input.scanSessionId,
      releaseMode: input.releaseMode,
      providerPolicy: route.providerPolicy,
      primaryModel: route.modelName,
      fallbackModels: route.allowed ? ["ding-detector-v0", "crop-yolo-v0"] : ["local-tools-only"],
      inputImages: input.inputImages,
      toolEvents: events,
      annotationCandidates: candidates,
      fusedAnnotations: fused.annotations,
      humanReviewTasks: fused.humanReviewTasks,
      reportPatch: {
        visibleDingCount: fused.annotations.length,
        modelConsensus: fused.annotations.map((annotation) => ({
          label: annotation.label,
          region: annotation.region,
          confidence: annotation.confidence,
          sources: candidates
            .filter((candidate) => annotation.supportingCandidateIds.includes(candidate.id))
            .map((candidate) => candidate.source),
          decision: annotation.fusionDecision,
        })),
      },
    };
  }
}

export function candidatesFromLocalDetections(
  input: VisualInspectionInput,
  image: EvidenceImage,
  reportIds: string[] = [],
): AnnotationCandidate[] {
  return input.mlDetections.map((detection, index) => {
    const label = normalizeLabel(detection.type);
    const confidence = clamp01(detection.confidence);
    const severity = normalizeSeverity(detection.severity, confidence);
    const source = candidateSourceForDetection(detection.source);
    const toolChain = toolChainForDetectionSource(detection.source);
    return {
      id: detection.id ?? `local-${index}`,
      source,
      modelName: source === "human_review" ? "human-review" : source === "crop_yolo" ? "ding-detector-v0:foveated" : "ding-detector-v0",
      toolChain,
      imageId: image.id,
      region: detection.zone,
      bboxNorm: coerceBboxNorm(detection.bbox),
      label,
      confidence,
      severity,
      materiality: materialityFor(severity, confidence),
      evidenceImageIds: [image.id],
      rationale: `${label.replaceAll("_", " ")} detected in ${detection.zone} at ${Math.round(confidence * 100)}% confidence by ${toolChain.at(-1)}.`,
      grounding: {
        toolOutputIds: [detection.id ?? `local-${index}`],
        reportIds,
        imageHashes: [image.sha256],
      },
    };
  });
}

function candidateSourceForDetection(rawSource: string | undefined): AnnotationSource {
  const source = String(rawSource ?? "").toLowerCase();
  if (source === "user" || source.includes("human")) return "human_review";
  if (source.includes(":crop:")) return source.includes("surface") ? "surface_anomaly" : "crop_yolo";
  if (source.includes("surface")) return "surface_anomaly";
  return "local_yolo";
}

function toolChainForDetectionSource(rawSource: string | undefined): string[] {
  const source = String(rawSource ?? "").toLowerCase();
  if (source === "user" || source.includes("human")) return ["human_ding_review"];
  if (source.includes(":crop:")) {
    return ["detect_card_boundary", "normalize_card", "crop_region", "run_ding_detector_on_crop"];
  }
  return ["detect_card_boundary", "normalize_card", "run_ding_detector"];
}

export function normalizeLabel(type: string): AnnotationLabel {
  const normalized = type.toLowerCase();
  if (normalized.includes("edge")) return "edge_wear";
  if (normalized.includes("corner")) return "corner_wear";
  if (normalized.includes("scratch")) return "scratch";
  if (normalized.includes("crease")) return "crease";
  if (normalized.includes("dent")) return "dent";
  if (normalized.includes("contamination") || normalized.includes("stain")) return "surface_contamination";
  if (normalized.includes("print")) return "print_line";
  if (normalized.includes("glare")) return "glare_uncertain";
  if (normalized.includes("clean") || normalized.includes("no_material")) return "no_material_ding";
  return "unknown_damage";
}

function normalizeSeverity(severity: string | undefined, confidence: number): AnnotationSeverity {
  const normalized = String(severity ?? "").toLowerCase();
  if (normalized.includes("severe")) return "severe";
  if (normalized.includes("major")) return "major";
  if (normalized.includes("moderate")) return "moderate";
  if (normalized.includes("minor")) return "minor";
  if (confidence >= 0.9) return "major";
  if (confidence >= 0.7) return "moderate";
  return "minor";
}

function materialityFor(severity: AnnotationSeverity, confidence: number): AnnotationMateriality {
  if (severity === "severe") return "dominant_ding";
  if (severity === "major") return "material_ding";
  if (severity === "moderate" && confidence >= 0.72) return "material_ding";
  if (confidence < 0.55) return "uncertain";
  return "not_material";
}

function toFinal(
  candidate: AnnotationCandidate,
  group: AnnotationCandidate[],
  disagreeing: AnnotationCandidate[],
  decision: FinalDingAnnotation["fusionDecision"],
): FinalDingAnnotation {
  const supporting = group.filter((item) => labelsCompatible(item.label, candidate.label));
  const confidenceBoost = Math.min(0.12, Math.max(0, supporting.length - 1) * 0.04);
  return {
    ...candidate,
    source:
      candidate.source === "human_review"
        ? "human_review"
        : candidate.source === "crop_yolo"
          ? "crop_yolo"
          : candidate.source === "surface_anomaly"
            ? "surface_anomaly"
            : "local_yolo",
    confidence: clamp01(candidate.confidence + confidenceBoost),
    supportingCandidateIds: supporting.map((item) => item.id),
    disagreementCandidateIds: disagreeing.map((item) => item.id),
    fusionDecision: decision,
  };
}

function candidatesOverlap(a: AnnotationCandidate, b: AnnotationCandidate) {
  if (a.id === b.id) return true;
  if (a.region && b.region && a.region === b.region) return true;
  if (!a.bboxNorm || !b.bboxNorm) return false;
  return iou(a.bboxNorm, b.bboxNorm) >= 0.35;
}

function labelsCompatible(a: AnnotationLabel, b: AnnotationLabel) {
  if (a === b) return true;
  const wear = new Set<AnnotationLabel>(["edge_wear", "corner_wear", "unknown_damage"]);
  if (wear.has(a) && wear.has(b)) return true;
  if ((a === "scratch" && b === "glare_uncertain") || (a === "glare_uncertain" && b === "scratch")) return false;
  return false;
}

function isLowConfidenceGroup(group: AnnotationCandidate[]) {
  return Math.max(...group.map((item) => item.confidence)) < 0.62;
}

function sortedCandidates(candidates: AnnotationCandidate[]) {
  return [...candidates].sort((a, b) => {
    if (a.source === "human_review" && b.source !== "human_review") return -1;
    if (b.source === "human_review" && a.source !== "human_review") return 1;
    return b.confidence - a.confidence;
  });
}

function iou(a: BboxNorm, b: BboxNorm) {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function coerceBboxNorm(bbox: BboxNorm): BboxNorm {
  const divisor = bbox.some((value) => Math.abs(value) > 1) ? 100 : 1;
  return bbox.map((value) => clamp01(value / divisor)) as BboxNorm;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
