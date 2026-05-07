import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createInspectionSkillCandidate,
  evaluateSkillPromotion,
  type InspectionSkillCandidate,
  type InspectionSkillStatus,
  type InspectionSkillTrigger,
  type SkillPromotionTarget,
} from "./inspection-skill-evolution";

/**
 * File-backed skill registry. MVP-scoped — single-process, no locks.
 * Migration path: replace `loadAll`/`saveSkill` with DuckDB queries when we
 * outgrow the filesystem (target: >500 skills or >2 concurrent writers).
 *
 * Layout (under DATA_DIR, default ./data):
 *   skills/promoted/<skill_id>.json   — production/canary/staging skills
 *   skills/drafts/<skill_id>.json     — drafts awaiting benchmark
 *   skills/candidates.jsonl           — append-only method traces from agent runs
 *   skills/proposals.jsonl            — append-only "this trace looks reusable" hints
 */

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return resolve(process.cwd(), "..", "..", "data");
}

function skillsDir() {
  return join(dataDir(), "skills");
}

function ensureLayout() {
  const root = skillsDir();
  for (const sub of ["promoted", "drafts"]) {
    const full = join(root, sub);
    if (!existsSync(full)) mkdirSync(full, { recursive: true });
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function safeReadJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

export type SkillFolder = "promoted" | "drafts";

export function loadSkills(folder: SkillFolder = "promoted"): InspectionSkillCandidate[] {
  const root = ensureLayout();
  const dir = join(root, folder);
  const out: InspectionSkillCandidate[] = [];
  for (const name of listJsonFiles(dir)) {
    const skill = safeReadJson<InspectionSkillCandidate>(join(dir, name));
    if (skill) out.push(skill);
  }
  return out.sort((a, b) => a.skillId.localeCompare(b.skillId));
}

export function loadSkillById(skillId: string): InspectionSkillCandidate | null {
  const root = ensureLayout();
  for (const folder of ["promoted", "drafts"] as const) {
    const found = safeReadJson<InspectionSkillCandidate>(join(root, folder, `${skillId}.json`));
    if (found) return found;
  }
  return null;
}

export function saveSkill(skill: InspectionSkillCandidate, folder: SkillFolder = "drafts"): void {
  const root = ensureLayout();
  writeFileSync(join(root, folder, `${skill.skillId}.json`), JSON.stringify(skill, null, 2), "utf-8");
}

/**
 * Match promoted skills against the current inspection context.
 * Returns the skills whose triggers fire — the agent then uses them as canon
 * methods rather than re-deriving from scratch.
 */
export function matchPromotedSkills(context: {
  finishType?: InspectionSkillTrigger["finishType"];
  findingType?: string;
  region?: string;
  surfaceConfidence?: number;
  glareScore?: number;
  userIntent?: string;
}): InspectionSkillCandidate[] {
  const all = loadSkills("promoted").filter((skill) => skill.status === "production" || skill.status === "canary");
  return all.filter((skill) => {
    const t = skill.trigger;
    if (t.finishType && context.finishType && t.finishType !== context.finishType) return false;
    if (t.findingType && context.findingType && t.findingType !== context.findingType) return false;
    if (t.region && context.region && t.region !== context.region) return false;
    if (t.maxConfidence !== undefined && context.surfaceConfidence !== undefined && context.surfaceConfidence > t.maxConfidence) return false;
    if (t.minGlareScore !== undefined && context.glareScore !== undefined && context.glareScore < t.minGlareScore) return false;
    if (t.userQuestionIntent && context.userIntent && !context.userIntent.toLowerCase().includes(t.userQuestionIntent.toLowerCase())) return false;
    return true;
  });
}

/**
 * Method-trace record. Anonymized at write time — no raw user image bytes,
 * no card identifiers, no user identity. Just the *shape* of what the agent
 * tried so we can cluster reusable patterns later.
 */
export type MethodTraceRecord = {
  traceId: string;
  ts: string;
  reportContext: {
    findingsCount: number;
    surfaceScoreBucket: "low" | "medium" | "high" | "unknown";
    glareScoreBucket: "low" | "medium" | "high" | "unknown";
    finishType?: InspectionSkillTrigger["finishType"];
    userIntentBucket: string;
  };
  toolSequence: Array<{ tool: string; argsKeys: string[]; durationMs: number; ok: boolean }>;
  outcome: {
    answeredFromTools: boolean;
    citedFindings: number;
    proposedSkillId?: string;
    refusedAsUngrounded: boolean;
  };
  modelProvider: string;
  modelName: string;
};

function toBucket(value: number | undefined, lo: number, hi: number): "low" | "medium" | "high" | "unknown" {
  if (typeof value !== "number" || Number.isNaN(value)) return "unknown";
  if (value < lo) return "low";
  if (value > hi) return "high";
  return "medium";
}

export function bucketSurfaceScore(value: number | undefined) {
  return toBucket(value, 60, 80);
}

export function bucketGlareScore(value: number | undefined) {
  return toBucket(value, 0.2, 0.4);
}

export function intentBucketFor(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("glare") || q.includes("reflect")) return "glare_question";
  if (q.includes("scratch")) return "scratch_question";
  if (q.includes("worth") || q.includes("grade") || q.includes("grading")) return "grading_value_question";
  if (q.includes("retake") || q.includes("reshoot") || q.includes("better")) return "retake_question";
  if (q.includes("dispute") || q.includes("claim") || q.includes("packet")) return "dispute_question";
  if (q.includes("compare") || q.includes("before") || q.includes("after")) return "compare_question";
  if (q.includes("biggest") || q.includes("worst") || q.includes("issue")) return "summary_question";
  return "general_question";
}

export function appendMethodTrace(record: MethodTraceRecord): void {
  const root = ensureLayout();
  const path = join(root, "candidates.jsonl");
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
}

export function loadMethodTraces(limit = 200): MethodTraceRecord[] {
  const root = ensureLayout();
  const path = join(root, "candidates.jsonl");
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    const tail = lines.slice(-limit);
    return tail
      .map((line) => {
        try {
          return JSON.parse(line) as MethodTraceRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is MethodTraceRecord => entry !== null);
  } catch {
    return [];
  }
}

export type SkillProposalRecord = {
  proposalId: string;
  ts: string;
  source: "agent_self_proposal" | "trace_clusterer" | "human_authored";
  proposed: ReturnType<typeof createInspectionSkillCandidate>;
  evidenceTraceIds: string[];
  rationale: string;
};

export function appendSkillProposal(proposal: SkillProposalRecord): void {
  const root = ensureLayout();
  const path = join(root, "proposals.jsonl");
  appendFileSync(path, `${JSON.stringify(proposal)}\n`, "utf-8");
}

export function loadSkillProposals(limit = 100): SkillProposalRecord[] {
  const root = ensureLayout();
  const path = join(root, "proposals.jsonl");
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as SkillProposalRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SkillProposalRecord => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Promote a draft to a higher status. ALWAYS gated by evaluateSkillPromotion —
 * production requires explicit human approval flag from the caller.
 */
export function promoteSkill(
  skillId: string,
  target: SkillPromotionTarget,
  options: {
    humanApproved?: boolean;
    benchmarks?: Parameters<typeof evaluateSkillPromotion>[1];
    certEval?: Parameters<typeof evaluateSkillPromotion>[3] extends infer O
      ? O extends { certEval?: infer CE }
        ? CE
        : never
      : never;
  } = {},
): { ok: boolean; reasons: string[]; updated?: InspectionSkillCandidate } {
  const skill = loadSkillById(skillId);
  if (!skill) return { ok: false, reasons: [`Skill ${skillId} not found.`] };
  // Re-evaluate gates here too — defence in depth. The caller route ALSO
  // evaluates with the real benchmark list. If a caller invokes promoteSkill
  // without passing benchmarks, fall through to a "staging-only" interpretation
  // (empty benchmarks → staging passes, canary/production are blocked).
  const decision = evaluateSkillPromotion(skill, options.benchmarks ?? [], target, {
    humanApproved: options.humanApproved,
    certEval: options.certEval,
  });
  if (!decision.allowed) return { ok: false, reasons: decision.reasons };
  const updated: InspectionSkillCandidate = { ...skill, status: target as InspectionSkillStatus };
  saveSkill(updated, "promoted");
  // If the skill graduated from drafts, remove the old draft file so the
  // registry shows a single source of truth in /skills.
  const root = ensureLayout();
  const draftPath = join(root, "drafts", `${skillId}.json`);
  if (existsSync(draftPath)) {
    try {
      rmSync(draftPath, { force: true });
    } catch {
      // best-effort — never break the promotion on filesystem cleanup
    }
  }
  return { ok: true, reasons: decision.reasons, updated };
}
