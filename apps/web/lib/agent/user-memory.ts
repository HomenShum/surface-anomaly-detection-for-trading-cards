import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MethodTraceRecord } from "./skill-store";

/**
 * Per-user private memory.
 *
 * Privacy contract:
 *   - Lives at <DATA_DIR>/user_memory/<userId>.json. NEVER shared across users.
 *   - Stores PREFERENCES (retake habits, complexity, common card kinds), not
 *     raw findings or images.
 *   - Cleared on user delete request — the file is the single source of truth.
 *
 * The agent reads this at the top of every turn and adapts its style + which
 * promoted skills it weights higher. It writes back at the end of every turn
 * by passing the final trace through `mergeUserMemoryFromTrace`.
 */

export type UserMemory = {
  userId: string;
  retakePreferences: string[]; // e.g. ["tilt-frame", "perpendicular-light"]
  cardFocus: string[]; // e.g. ["holo", "pokemon", "vintage"]
  explanationComplexity: "terse" | "balanced" | "verbose";
  topUserIntents: Array<{ intent: string; count: number }>;
  recentToolUsage: Array<{ tool: string; count: number }>;
  proposedSkillCount: number;
  rejectedFindingTypes: string[]; // findings the user has previously dismissed
  totalTurns: number;
  createdAt: string;
  lastUpdated: string;
};

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return resolve(process.cwd(), "..", "..", "data");
}

function userMemoryDir() {
  return join(dataDir(), "user_memory");
}

function userMemoryPath(userId: string) {
  // sanitize userId — only alphanumeric, dash, underscore
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "anon";
  return join(userMemoryDir(), `${safe}.json`);
}

function ensureDir() {
  const dir = userMemoryDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function emptyMemory(userId: string): UserMemory {
  const now = new Date().toISOString();
  return {
    userId,
    retakePreferences: [],
    cardFocus: [],
    explanationComplexity: "balanced",
    topUserIntents: [],
    recentToolUsage: [],
    proposedSkillCount: 0,
    rejectedFindingTypes: [],
    totalTurns: 0,
    createdAt: now,
    lastUpdated: now,
  };
}

export function loadUserMemory(userId: string): UserMemory {
  ensureDir();
  const path = userMemoryPath(userId);
  if (!existsSync(path)) return emptyMemory(userId);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<UserMemory>;
    return { ...emptyMemory(userId), ...parsed, userId };
  } catch {
    return emptyMemory(userId);
  }
}

function bumpCounter<T extends { count: number }>(
  list: Array<T>,
  matchKey: keyof T,
  matchValue: T[keyof T],
  factory: () => T,
  cap = 12,
): Array<T> {
  const idx = list.findIndex((entry) => entry[matchKey] === matchValue);
  if (idx >= 0) {
    const updated = [...list];
    updated[idx] = { ...updated[idx], count: updated[idx].count + 1 };
    return updated.sort((a, b) => b.count - a.count).slice(0, cap);
  }
  return [...list, factory()].sort((a, b) => b.count - a.count).slice(0, cap);
}

function saveUserMemory(memory: UserMemory): void {
  ensureDir();
  writeFileSync(userMemoryPath(memory.userId), JSON.stringify(memory, null, 2), "utf-8");
}

/**
 * Merge a single agent turn's trace into the user's memory. Returns the
 * updated memory (already persisted).
 */
export function mergeUserMemoryFromTrace(input: {
  userId: string;
  trace: MethodTraceRecord;
  rejectedFindingType?: string;
}): UserMemory {
  const memory = loadUserMemory(input.userId);
  const now = new Date().toISOString();

  const intent = input.trace.reportContext.userIntentBucket;
  const topUserIntents = bumpCounter(
    memory.topUserIntents,
    "intent",
    intent,
    () => ({ intent, count: 1 }),
  );

  let recentToolUsage = memory.recentToolUsage;
  for (const step of input.trace.toolSequence) {
    recentToolUsage = bumpCounter(
      recentToolUsage,
      "tool",
      step.tool,
      () => ({ tool: step.tool, count: 1 }),
    );
  }

  const totalTurns = memory.totalTurns + 1;

  // Heuristic: explanation_complexity drifts based on intent volume.
  let explanationComplexity = memory.explanationComplexity;
  if (totalTurns > 5) {
    const summaryIntents =
      (topUserIntents.find((entry) => entry.intent === "summary_question")?.count ?? 0) +
      (topUserIntents.find((entry) => entry.intent === "grading_value_question")?.count ?? 0);
    const detailIntents =
      (topUserIntents.find((entry) => entry.intent === "dispute_question")?.count ?? 0) +
      (topUserIntents.find((entry) => entry.intent === "scratch_question")?.count ?? 0);
    if (detailIntents > summaryIntents * 2) explanationComplexity = "verbose";
    else if (summaryIntents > detailIntents * 2) explanationComplexity = "terse";
    else explanationComplexity = "balanced";
  }

  const cardFocus = (() => {
    const finish = input.trace.reportContext.finishType;
    if (!finish || finish === "unknown") return memory.cardFocus;
    if (memory.cardFocus.includes(finish)) return memory.cardFocus;
    return [...memory.cardFocus, finish].slice(-6);
  })();

  const proposedSkillCount =
    memory.proposedSkillCount + (input.trace.outcome.proposedSkillId ? 1 : 0);

  const rejectedFindingTypes =
    input.rejectedFindingType && !memory.rejectedFindingTypes.includes(input.rejectedFindingType)
      ? [...memory.rejectedFindingTypes, input.rejectedFindingType].slice(-32)
      : memory.rejectedFindingTypes;

  const updated: UserMemory = {
    ...memory,
    topUserIntents,
    recentToolUsage,
    totalTurns,
    explanationComplexity,
    cardFocus,
    proposedSkillCount,
    rejectedFindingTypes,
    lastUpdated: now,
  };
  saveUserMemory(updated);
  return updated;
}

/**
 * Render user memory as a compact summary for injection into the agent's
 * system context. Anonymous-safe (memory itself is per-user file but the
 * summary contains no PII).
 */
export function summarizeUserMemoryForAgent(memory: UserMemory): string {
  const lines: string[] = [];
  lines.push(`Operator memory: ${memory.totalTurns} prior turn(s).`);
  if (memory.cardFocus.length > 0) lines.push(`Frequent finishes: ${memory.cardFocus.join(", ")}.`);
  if (memory.topUserIntents.length > 0) {
    const top = memory.topUserIntents.slice(0, 3).map((entry) => `${entry.intent}×${entry.count}`).join(", ");
    lines.push(`Top intents: ${top}.`);
  }
  lines.push(`Preferred explanation complexity: ${memory.explanationComplexity}.`);
  if (memory.rejectedFindingTypes.length > 0) {
    lines.push(`Previously dismissed finding types: ${memory.rejectedFindingTypes.join(", ")}.`);
  }
  if (memory.proposedSkillCount > 0) {
    lines.push(`User has triggered ${memory.proposedSkillCount} agent skill proposals.`);
  }
  return lines.join(" ");
}

export function loadAllUserIds(): string[] {
  ensureDir();
  try {
    const dir = userMemoryDir();
    const entries: string[] = [];
    for (const file of require("node:fs").readdirSync(dir) as string[]) {
      if (file.endsWith(".json")) entries.push(file.replace(/\.json$/, ""));
    }
    return entries;
  } catch {
    return [];
  }
}
