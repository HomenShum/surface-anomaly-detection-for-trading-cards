import {
  appendSkillProposal,
  loadMethodTraces,
  loadSkills,
  loadSkillProposals,
  saveSkill,
  type MethodTraceRecord,
  type SkillProposalRecord,
} from "./skill-store";
import {
  createInspectionSkillCandidate,
  type InspectionSkillCandidate,
  type InspectionToolName,
} from "./inspection-skill-evolution";

/**
 * Trace clusterer.
 *
 * Reads candidates.jsonl, groups traces by signature, and emits draft skills
 * for any cluster that fires ≥ MIN_CLUSTER_SIZE times. Each draft skill goes
 * to data/skills/drafts/<skill_id>.json AND a SkillProposalRecord lands in
 * proposals.jsonl with rationale = "auto-clustered from N traces".
 *
 * The clusterer NEVER promotes skills. Drafts must pass the benchmark
 * harness AND human approval before they reach production.
 */

const MIN_CLUSTER_SIZE = 3;
const TOOL_WHITELIST: InspectionToolName[] = [
  "normalize_card",
  "crop_region",
  "zoom_region",
  "rotate_image",
  "enhance_contrast",
  "run_glare_check",
  "run_ding_detector",
  "run_surface_anomaly",
  "compare_regions",
  "save_evidence_crop",
  "explain_uncertainty",
];

function clusterSignature(trace: MethodTraceRecord): string {
  const intent = trace.reportContext.userIntentBucket;
  const finish = trace.reportContext.finishType ?? "unknown";
  const tools = [...new Set(trace.toolSequence.map((step) => step.tool))].sort();
  return `${intent}|${finish}|${tools.join(",")}`;
}

function toolNameToInspectionTool(toolName: string): InspectionToolName {
  if (TOOL_WHITELIST.includes(toolName as InspectionToolName)) {
    return toolName as InspectionToolName;
  }
  // Map our runtime tools to the inspection-skill-evolution tool taxonomy.
  if (toolName === "crop_finding") return "crop_region";
  if (toolName === "request_zoom_animation") return "zoom_region";
  if (toolName === "evaluate_glare_risk") return "run_glare_check";
  if (toolName === "rerun_detector_on_crop") return "run_ding_detector";
  if (toolName === "glare_check_on_crop") return "run_glare_check";
  if (toolName === "compare_to_baseline") return "compare_regions";
  if (toolName === "cite_evidence") return "save_evidence_crop";
  return "explain_uncertainty";
}

function buildSkillIdFromCluster(intent: string, finish: string, signatureSuffix: string): string {
  const safeIntent = intent.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const safeFinish = finish.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const stamp = signatureSuffix.slice(0, 6);
  return `auto_${safeFinish}_${safeIntent}_${stamp}_v1`;
}

function buildTitle(intent: string, finish: string, sampleSize: number): string {
  const intentClean = intent.replace(/_/g, " ");
  return `Auto-clustered: ${finish} cards · ${intentClean} (n=${sampleSize})`;
}

function dominantToolSequence(traces: MethodTraceRecord[]): InspectionToolName[] {
  const counts = new Map<string, number>();
  for (const trace of traces) {
    const tools = [...new Set(trace.toolSequence.map((step) => step.tool))];
    for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tool]) => toolNameToInspectionTool(tool));
}

export type ClusteringResult = {
  scannedTraces: number;
  clusters: Array<{
    signature: string;
    sampleSize: number;
    skillId: string;
    title: string;
    isNew: boolean;
  }>;
  newDrafts: number;
  existingProposalSkillIds: string[];
};

export function runClustering(): ClusteringResult {
  const traces = loadMethodTraces(2000);
  const groups = new Map<string, MethodTraceRecord[]>();
  for (const trace of traces) {
    const sig = clusterSignature(trace);
    const list = groups.get(sig) ?? [];
    list.push(trace);
    groups.set(sig, list);
  }

  const existingProposals = loadSkillProposals(500);
  const existingSkillIds = new Set([
    ...existingProposals.map((proposal) => proposal.proposed.skillId),
    ...loadSkills("drafts").map((skill) => skill.skillId),
    ...loadSkills("promoted").map((skill) => skill.skillId),
  ]);

  const result: ClusteringResult = {
    scannedTraces: traces.length,
    clusters: [],
    newDrafts: 0,
    existingProposalSkillIds: [...existingSkillIds],
  };

  for (const [signature, members] of groups.entries()) {
    if (members.length < MIN_CLUSTER_SIZE) continue;
    const sampleTrace = members[0];
    const intent = sampleTrace.reportContext.userIntentBucket;
    const finish = sampleTrace.reportContext.finishType ?? "unknown";
    const skillId = buildSkillIdFromCluster(intent, finish, signature.replace(/[^a-z0-9]/gi, ""));
    const isNew = !existingSkillIds.has(skillId);
    result.clusters.push({
      signature,
      sampleSize: members.length,
      skillId,
      title: buildTitle(intent, finish, members.length),
      isNew,
    });
    if (!isNew) continue;

    const tools = dominantToolSequence(members);
    const candidate: InspectionSkillCandidate = createInspectionSkillCandidate({
      skillId,
      title: buildTitle(intent, finish, members.length),
      trigger: {
        finishType: finish === "unknown" ? undefined : (finish as InspectionSkillCandidate["trigger"]["finishType"]),
        userQuestionIntent: intent,
      },
      steps: tools.map((tool) => ({
        tool,
        purpose: `Auto-clustered step from ${members.length} agent runs.`,
      })),
      sharesAcrossUsers: true,
      consentScope: "anonymized_method_stats",
    });
    saveSkill(candidate, "drafts");

    const proposal: SkillProposalRecord = {
      proposalId: `prop-cluster-${Date.now()}-${skillId}`,
      ts: new Date().toISOString(),
      source: "trace_clusterer",
      proposed: candidate,
      evidenceTraceIds: members.map((trace) => trace.traceId),
      rationale: `Trace clusterer matched ${members.length} runs sharing intent=${intent}, finish=${finish}, tools=[${tools.join(", ")}]. Posted as a DRAFT only — benchmark + human approval required for promotion.`,
    };
    appendSkillProposal(proposal);
    result.newDrafts += 1;
    existingSkillIds.add(skillId);
  }

  return result;
}
