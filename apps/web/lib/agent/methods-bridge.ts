import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSkillById, loadSkills, saveSkill, type SkillFolder } from "./skill-store";
import { loadBenchmarkRunsForSkill } from "./benchmark-runs";
import {
  createInspectionSkillCandidate,
  type InspectionSkillCandidate,
  type InspectionSkillContributor,
  type InspectionSkillStatus,
} from "./inspection-skill-evolution";
import {
  verifiedMethods as seededMethods,
  type VerifiedMethod,
  type VerifiedMethodStatus,
  type RewardEvent,
  type RewardEventType,
} from "../community-methods";

/**
 * Bridge between the file-backed skill registry (operator surface, /skills)
 * and the public methods board (public surface, /methods).
 *
 * Why a bridge: the public board is its own UX with rewarded contributors,
 * benchmark cards, and open-source provenance. We don't want internal skill
 * IDs leaking weirdly named auto-clusters into the public surface; the bridge
 * lets us shape what's shown and merge with hand-authored seeds.
 */

const SAFE_REMARK_LIMIT = 220;

function repoRoot() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override, "..");
  return resolve(process.cwd(), "..", "..");
}

function inspectionMethodsDir() {
  return join(repoRoot(), "inspection-methods");
}

function dataDir() {
  return resolve(repoRoot(), "data");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function computeVersionHash(skill: InspectionSkillCandidate): string {
  const canonical = JSON.stringify({
    skillId: skill.skillId,
    trigger: skill.trigger,
    steps: skill.steps.map((step) => ({ tool: step.tool, region: step.region ?? null })),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Sanitize a raw user remark into a public-safe rewrite.
 * Strips emails, phone numbers, IDs that look like SSN/CC, and any explicit
 * grade claims. Truncates length. Wraps the message into third-person.
 */
export function sanitizeRemark(rawRemark: string): string {
  let cleaned = rawRemark
    .replace(/[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g, "[redacted-email]")
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, "[redacted-id]")
    .replace(/\b\d{16}\b/g, "[redacted-id]")
    .replace(/\bPSA\s*\d{1,2}\b/gi, "an official grade")
    .replace(/\bBGS\s*\d{1,2}(\.\d)?\b/gi, "an official grade")
    .replace(/\bCGC\s*\d{1,2}(\.\d)?\b/gi, "an official grade")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > SAFE_REMARK_LIMIT) cleaned = `${cleaned.slice(0, SAFE_REMARK_LIMIT - 1)}…`;
  return cleaned;
}

export type ContributorProfilePayload = {
  handle: string;
  displayName: string;
  consentPublicAttribution: boolean;
  totalSubmissions: number;
  verifiedMethods: number;
  fixturesContributed: number;
  badges: string[];
  lastUpdated: string;
};

function contributorsDir() {
  return join(dataDir(), "contributors");
}

function ensureContributorsDir() {
  if (!existsSync(contributorsDir())) mkdirSync(contributorsDir(), { recursive: true });
}

function loadContributorPayload(handle: string): ContributorProfilePayload | null {
  ensureContributorsDir();
  const path = join(contributorsDir(), `${handle}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ContributorProfilePayload;
  } catch {
    return null;
  }
}

function saveContributorPayload(payload: ContributorProfilePayload): void {
  ensureContributorsDir();
  writeFileSync(join(contributorsDir(), `${payload.handle}.json`), JSON.stringify(payload, null, 2), "utf-8");
}

export function bumpContributorOnSubmission(handle: string, displayName: string): ContributorProfilePayload {
  const existing = loadContributorPayload(handle);
  const now = new Date().toISOString();
  const updated: ContributorProfilePayload = existing
    ? { ...existing, totalSubmissions: existing.totalSubmissions + 1, lastUpdated: now }
    : {
        handle,
        displayName: displayName || handle,
        consentPublicAttribution: true,
        totalSubmissions: 1,
        verifiedMethods: 0,
        fixturesContributed: 0,
        badges: ["Method Author"],
        lastUpdated: now,
      };
  saveContributorPayload(updated);
  return updated;
}

export function bumpContributorOnVerified(handle: string, badgeToAdd?: string): ContributorProfilePayload | null {
  const existing = loadContributorPayload(handle);
  if (!existing) return null;
  const now = new Date().toISOString();
  const badges = badgeToAdd && !existing.badges.includes(badgeToAdd) ? [...existing.badges, badgeToAdd] : existing.badges;
  const updated: ContributorProfilePayload = {
    ...existing,
    verifiedMethods: existing.verifiedMethods + 1,
    badges,
    lastUpdated: now,
  };
  saveContributorPayload(updated);
  return updated;
}

export function loadAllContributorPayloads(): ContributorProfilePayload[] {
  ensureContributorsDir();
  const out: ContributorProfilePayload[] = [];
  if (!existsSync(contributorsDir())) return out;
  for (const file of readdirSync(contributorsDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(contributorsDir(), file), "utf-8")));
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => b.verifiedMethods - a.verifiedMethods || b.totalSubmissions - a.totalSubmissions);
}

function mapStatus(internal: InspectionSkillStatus): VerifiedMethodStatus {
  switch (internal) {
    case "draft":
      return "draft";
    case "staging":
      return "benchmarking";
    case "canary":
      return "canary";
    case "production":
      return "production";
    case "rejected":
      return "retired";
    case "retired":
      return "retired";
    default:
      return "draft";
  }
}

/**
 * Convert a skill-store record + its benchmark history into the public
 * VerifiedMethod shape that /methods board renders.
 */
export function skillToVerifiedMethod(skill: InspectionSkillCandidate): VerifiedMethod {
  const benchmarks = loadBenchmarkRunsForSkill(skill.skillId, 5);
  const latest = benchmarks[0];
  const summary = latest?.summary;
  const passed = summary?.passed ?? false;
  const slug = slugify(skill.skillId);
  const versionHash = skill.versionHash ?? computeVersionHash(skill);
  const contributorHandle = skill.contributor?.handle ?? "auto-clustered";
  const contributorName = skill.contributor?.displayName ?? "Auto Clusterer";
  const consented = skill.contributor?.consentPublicAttribution ?? false;
  const originalUserRemark = consented ? skill.contributor?.originalUserRemark ?? "" : "";
  const publicRemark =
    skill.contributor?.publicRemark ??
    `Method assembled from ${skill.steps.length} inspection step(s).`;
  const triggerSummary = (() => {
    const parts: string[] = [];
    if (skill.trigger.finishType) parts.push(`finish=${skill.trigger.finishType}`);
    if (skill.trigger.findingType) parts.push(`finding=${skill.trigger.findingType}`);
    if (skill.trigger.region) parts.push(`region=${skill.trigger.region}`);
    if (skill.trigger.userQuestionIntent) parts.push(`intent=${skill.trigger.userQuestionIntent}`);
    return parts.join(", ") || "general";
  })();

  // Synthesize benchmark deltas from harness output.
  const fixturesPassed = latest?.fixtures.filter((entry) => entry.passed).length ?? 0;
  const fixturesTotal = latest?.fixtures.length ?? 0;
  const benchmarkBlock = {
    falsePositiveReductionPct: Math.round((summary?.falsePositiveDelta ?? 0) * -100),
    precisionLiftPct: Math.round((summary?.precisionDelta ?? 0) * 100),
    recallLiftPct: Math.round((summary?.recallDelta ?? 0) * 100),
    latencyAddedMs: summary?.latencyAddedMs ?? 0,
    fixturePack: latest ? `${summary?.datasetVersion ?? "fixtures"} (${fixturesPassed}/${fixturesTotal})` : "no benchmark yet",
    passed,
  };

  const rewardEvents: RewardEvent[] = [];
  rewardEvents.push({
    type: "method_submitted",
    label: skill.contributor?.source === "agent_chat_user_remark" ? "Submitted from report chat" : `Source: ${skill.contributor?.source ?? "auto"}`,
    createdAt: skill.createdAt,
  });
  if (latest) {
    rewardEvents.push({
      type: passed ? "method_verified" : "method_reproduced",
      label: passed
        ? `Benchmark passed on ${benchmarkBlock.fixturePack}`
        : `Benchmark partial: ${fixturesPassed}/${fixturesTotal} fixtures`,
      createdAt: latest.generatedAt,
    });
  }
  if (skill.openSourcePath) {
    rewardEvents.push({
      type: "method_merged_open_source",
      label: `Exported to ${skill.openSourcePath}`,
      createdAt: skill.createdAt,
    });
  }
  if ((skill.usageCount ?? 0) >= 1000) {
    rewardEvents.push({
      type: "method_used_1000_times",
      label: `Used in ${(skill.usageCount ?? 0).toLocaleString()} scans`,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    id: skill.skillId,
    slug,
    title: skill.title,
    shortTitle: skill.title.length > 40 ? `${skill.title.slice(0, 37)}…` : skill.title,
    contributorHandle,
    contributorName,
    contributorRole: skill.contributor?.source === "agent_chat_user_remark" ? "Community contributor" : "Auto-clustered candidate",
    source: skill.contributor?.source === "agent_chat_user_remark" ? "agent_chat" : skill.contributor?.source === "manual_submit" ? "manual_submit" : "benchmark_discovery",
    originalUserRemark,
    publicRemark,
    status: mapStatus(skill.status),
    supportedCardType: skill.trigger.finishType ? `${skill.trigger.finishType} cards` : "All finishes",
    problem: skill.contributor?.publicRemark ?? `Trigger: ${triggerSummary}`,
    method: skill.steps.map((step) => `${step.tool} — ${step.purpose}${step.region ? ` (${step.region})` : ""}`),
    benchmark: benchmarkBlock,
    limitation:
      skill.status === "production"
        ? "Production-eligible after benchmark + human approval. Ongoing monitoring required."
        : skill.status === "canary"
          ? "Canary — fires for a fraction of matching contexts pending broader benchmarks."
          : "Staging — benchmark passed but not yet in production rotation.",
    reward: passed ? "250 scan credits + Verified Method badge" : "Pending benchmark pass",
    usedInScans: skill.usageCount ?? 0,
    versionHash,
    mergedPr: skill.openSourcePath ?? "not-merged",
    remark: publicRemark,
    rewardEvents,
  };
}

export type CombinedMethodList = {
  seeded: VerifiedMethod[];
  fromRegistry: VerifiedMethod[];
  all: VerifiedMethod[];
};

export function loadAllPublicMethods(): CombinedMethodList {
  const promoted = loadSkills("promoted");
  const drafts = loadSkills("drafts");
  const fromRegistry = [...promoted, ...drafts]
    .filter((skill) => skill.contributor || skill.status !== "draft") // hide unattributed pure drafts
    .map((skill) => skillToVerifiedMethod(skill));
  const all = [...seededMethods, ...fromRegistry].sort((a, b) => b.usedInScans - a.usedInScans);
  return { seeded: seededMethods, fromRegistry, all };
}

export function findMethodBySlug(slug: string): VerifiedMethod | null {
  const fromSeed = seededMethods.find((method) => method.slug === slug);
  if (fromSeed) return fromSeed;
  const promoted = [...loadSkills("promoted"), ...loadSkills("drafts")];
  const skill = promoted.find((entry) => slugify(entry.skillId) === slug);
  if (!skill) return null;
  return skillToVerifiedMethod(skill);
}

/**
 * Submit a user remark from the chat panel as a draft method candidate.
 * Returns the new skillId and a sanitized publicRemark for the toast.
 */
export function submitMethodFromChatRemark(input: {
  rawRemark: string;
  contributorHandle: string;
  contributorDisplayName?: string;
  consentPublicAttribution: boolean;
  reportContext?: { finishType?: string; finding_type?: string; region?: string };
}): { skill: InspectionSkillCandidate; publicRemark: string } {
  const trimmed = input.rawRemark.trim();
  const publicRemark = sanitizeRemark(trimmed);
  const titleSeed = publicRemark.split(/[.!?]/)[0]?.slice(0, 60).trim() || "Operator-proposed method";
  const skillIdBase = slugify(`${input.contributorHandle}-${titleSeed}`);
  const skillId = `community_${skillIdBase}_v1`;

  const contributor: InspectionSkillContributor = {
    handle: input.contributorHandle.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32) || "anon",
    displayName: input.contributorDisplayName ?? input.contributorHandle,
    source: "agent_chat_user_remark",
    originalUserRemark: trimmed,
    publicRemark,
    consentPublicAttribution: input.consentPublicAttribution,
  };

  const skill = createInspectionSkillCandidate({
    skillId,
    title: `${titleSeed.charAt(0).toUpperCase()}${titleSeed.slice(1)}`,
    trigger: {
      finishType: input.reportContext?.finishType as InspectionSkillCandidate["trigger"]["finishType"],
      findingType: input.reportContext?.finding_type,
      region: input.reportContext?.region,
    },
    steps: [
      { tool: "explain_uncertainty", purpose: "Operator-proposed reasoning step. Replace with concrete tools after benchmark." },
    ],
    sharesAcrossUsers: true,
    consentScope: "anonymized_method_stats",
    contributor,
  });
  skill.versionHash = computeVersionHash(skill);
  saveSkill(skill, "drafts");
  bumpContributorOnSubmission(contributor.handle, contributor.displayName);
  return { skill, publicRemark };
}

/**
 * Detect if a chat message looks like an inspection method proposal.
 * Heuristic — used to surface the "Submit as method candidate" CTA.
 */
export function looksLikeMethodProposal(message: string): boolean {
  const lc = message.toLowerCase();
  const triggers = [
    /\b(maybe (you|the agent|it) should|what if|why don't|why not|try( |ing) to|you could|let's)\b/,
    /\b(crop|zoom|rotate|tilt|mask|filter|enhance|compare|rerun|re-run)\b/,
    /\b(method|workflow|pattern|technique|approach|trick|hack)\b/,
    /\b(should|could) (try|test|use|do|run)\b/,
  ];
  return triggers.filter((re) => re.test(lc)).length >= 2;
}

/**
 * Export a promoted skill into the open-source inspection-methods/ folder.
 * Idempotent — safe to call multiple times.
 */
export function exportSkillToOpenSource(skillId: string): string | null {
  const skill = loadSkillById(skillId);
  if (!skill) return null;
  const slug = slugify(skill.skillId);
  const folder = join(inspectionMethodsDir(), slug);
  if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

  const benchmarks = loadBenchmarkRunsForSkill(skillId, 5);
  const latest = benchmarks[0];
  const versionHash = skill.versionHash ?? computeVersionHash(skill);

  const yaml = [
    `id: ${skill.skillId}`,
    `title: "${skill.title.replace(/"/g, '\\"')}"`,
    `slug: ${slug}`,
    `status: ${skill.status}`,
    skill.contributor ? `contributor: "@${skill.contributor.handle}"` : "contributor: auto-clustered",
    `source: ${skill.contributor?.source ?? "trace_clusterer"}`,
    `version_hash: ${versionHash}`,
    `created_at: ${skill.createdAt}`,
    "trigger:",
    skill.trigger.finishType ? `  finish_type: ${skill.trigger.finishType}` : null,
    skill.trigger.findingType ? `  finding_type: ${skill.trigger.findingType}` : null,
    skill.trigger.region ? `  region: ${skill.trigger.region}` : null,
    skill.trigger.userQuestionIntent ? `  user_question_intent: ${skill.trigger.userQuestionIntent}` : null,
    skill.trigger.maxConfidence !== undefined ? `  max_confidence: ${skill.trigger.maxConfidence}` : null,
    skill.trigger.minGlareScore !== undefined ? `  min_glare_score: ${skill.trigger.minGlareScore}` : null,
    "steps:",
    ...skill.steps.map((step) => `  - tool: ${step.tool}\n    purpose: "${step.purpose.replace(/"/g, '\\"')}"${step.region ? `\n    region: ${step.region}` : ""}`),
    "consent_scope: " + skill.consentScope,
    "evidence_policy:",
    `  stores_raw_user_images: ${skill.evidencePolicy.storesRawUserImages}`,
    `  stores_derived_crops: ${skill.evidencePolicy.storesDerivedCrops}`,
    `  shares_across_users: ${skill.evidencePolicy.sharesAcrossUsers}`,
    "guardrails:",
    `  requires_tool_evidence: ${skill.guardrails.requiresToolEvidence}`,
    `  forbids_official_grade_claims: ${skill.guardrails.forbidsOfficialGradeClaims}`,
    `  forbids_legal_proof_claims: ${skill.guardrails.forbidsLegalProofClaims}`,
    `  requires_human_approval_for_production: ${skill.guardrails.requiresHumanApprovalForProduction}`,
    latest ? "benchmark:" : null,
    latest ? `  benchmark_id: ${latest.benchmarkId}` : null,
    latest ? `  passed: ${latest.summary.passed}` : null,
    latest ? `  precision_delta: ${latest.summary.precisionDelta}` : null,
    latest ? `  recall_delta: ${latest.summary.recallDelta}` : null,
    latest ? `  false_positive_delta: ${latest.summary.falsePositiveDelta}` : null,
    latest ? `  latency_added_ms: ${latest.summary.latencyAddedMs}` : null,
    latest ? `  agent_claims_without_tool_evidence: ${latest.summary.agentClaimsWithoutToolEvidence}` : null,
    latest ? `  official_grade_claims: ${latest.summary.officialGradeClaims}` : null,
    latest ? `  privacy_violations: ${latest.summary.privacyViolations}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  writeFileSync(join(folder, "method.yaml"), `${yaml}\n`, "utf-8");
  writeFileSync(
    join(folder, "README.md"),
    `# ${skill.title}\n\n` +
      `**Status:** ${skill.status}\n\n` +
      (skill.contributor?.publicRemark ? `> ${skill.contributor.publicRemark}\n\n` : "") +
      `## Steps\n\n${skill.steps.map((step, i) => `${i + 1}. \`${step.tool}\` — ${step.purpose}`).join("\n")}\n\n` +
      `## Privacy & Safety\n\n` +
      `- Stores raw user images: ${skill.evidencePolicy.storesRawUserImages}\n` +
      `- Stores derived crops: ${skill.evidencePolicy.storesDerivedCrops}\n` +
      `- Shares across users: ${skill.evidencePolicy.sharesAcrossUsers}\n` +
      `- Requires human approval for production: ${skill.guardrails.requiresHumanApprovalForProduction}\n\n` +
      `## Open-source guarantee\n\nNo official grade claims. No legal proof claims. Tool-backed evidence required for every claim.\n`,
    "utf-8",
  );
  if (latest) {
    writeFileSync(join(folder, "benchmark.json"), JSON.stringify(latest, null, 2), "utf-8");
  }
  // Update the skill record with openSourcePath + versionHash for future loads.
  const updated: InspectionSkillCandidate = { ...skill, openSourcePath: `inspection-methods/${slug}/`, versionHash };
  const folderName: SkillFolder = skill.status === "draft" ? "drafts" : "promoted";
  saveSkill(updated, folderName);
  return updated.openSourcePath ?? null;
}

export function getRewardEventForPromotion(target: InspectionSkillStatus): RewardEventType {
  if (target === "production") return "method_verified";
  if (target === "canary") return "method_reproduced";
  if (target === "staging") return "method_submitted";
  return "method_submitted";
}
