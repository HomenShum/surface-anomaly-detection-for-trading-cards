import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Flywheel report loader.
 *
 * Reads the agentic cert-eval flywheel artifacts emitted by
 * `scripts/eval/agentic_cert_flywheel.mjs`. Each run lives at:
 *
 *   data/cert-references/flywheel/runs/<runId>/
 *     traces.jsonl
 *     judge-scores.json
 *     summary.md
 *
 * A pointer file `data/cert-references/flywheel/latest.json` records the most
 * recent run.
 *
 * The web layer never writes here — the script owns the directory and the
 * page is read-only.
 */

export type FlywheelLayerKey = "ml" | "agent" | "calibration" | "trust" | "ux" | "evidence";

export type FlywheelLayerScore = {
  score: number | null;
  rationale: string;
  signals?: Record<string, unknown>;
};

export type FlywheelTrace = {
  certId: string;
  provider: string;
  certNumber: string;
  officialGrade: string | null;
  officialBand: string | null;
  cardIdentity: string | null;
  trustTier: string;
  finishHint: string;
  imagePresent: boolean;
  realImagePresent?: boolean;
  imageSource?: string;
  inferenceIsSimulated?: boolean;
  detectionCount: number;
  detectionMaxSeverity: string | null;
  surfaceScore: number | null;
  glareScore: number | null;
  centeringScore: number | null;
  predictedBand: string | null;
  predictedScore: number | null;
  predictedSubGrades: Record<string, unknown> | null;
  bandAgreement: "match" | "adjacent" | "mismatch" | "no_official_band";
  bandDistance: number | null;
  toolSequence: Array<{
    tool: string;
    argsKeys: string[];
    durationMs: number;
    ok: boolean;
    resultSummary?: string;
  }>;
  claims: string[];
  evidence: Array<{
    role: string;
    sha256: string | null;
    bbox: number[] | null;
    type: string | null;
    zone: string | null;
    confidence: number | null;
  }>;
  uiActions: Array<{ kind: string; region: string; bbox: number[]; label: string }>;
  agentNotes: string[];
  inferenceModelVersion: string | null;
  error: string | null;
  judge: {
    layers: Record<FlywheelLayerKey, FlywheelLayerScore>;
    systemScore: number;
    errorBucket: { bucket: string | null; severity: string | null };
    recommendedFixLayer: string | null;
  };
};

export type FlywheelRecommendedFix = {
  layer: string;
  severity: string;
  rationale: string;
  actions: string[];
};

export type FlywheelAggregate = {
  runId: string;
  iteration: number;
  generatedAt: string;
  agentPolicyVersion: string;
  judgeRubricVersion: string;
  certCount: number;
  imagedCount: number;
  realImageCount?: number;
  simulatedImageCount?: number;
  proofEligibleMatches?: number;
  proofMatchRate?: number;
  byLayer: Record<FlywheelLayerKey, number | null>;
  systemScore: number;
  matchRate: number;
  adjacentRate: number;
  mismatchRate: number;
  noOfficialBandRate: number;
  errorBuckets: Record<string, number>;
  recommendedFixes: FlywheelRecommendedFix[];
  topRecommendedFixLayer: string | null;
  deltaVsPrevious: { byLayer: Record<FlywheelLayerKey, number | null>; systemScore: number; matchRate: number } | null;
};

export type FlywheelRun = {
  runId: string;
  generatedAt: string;
  aggregate: FlywheelAggregate;
  traces: FlywheelTrace[];
};

function repoRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybeRoot = resolve(cwd, "..", "..");
  if (existsSync(join(maybeRoot, "pnpm-workspace.yaml"))) return maybeRoot;
  return cwd;
}

function flywheelDir() {
  return join(repoRoot(), "data", "cert-references", "flywheel");
}

function safeReadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function safeReadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export function loadLatestFlywheelRun(): FlywheelRun | null {
  const root = flywheelDir();
  if (!existsSync(root)) return null;
  const pointerPath = join(root, "latest.json");
  const pointer = safeReadJson<{ runId?: string } | null>(pointerPath, null);
  let runId = pointer?.runId ?? null;
  if (!runId) {
    const runsRoot = join(root, "runs");
    if (!existsSync(runsRoot)) return null;
    const runs = readdirSync(runsRoot)
      .filter((entry) => statSync(join(runsRoot, entry)).isDirectory())
      .sort();
    runId = runs[runs.length - 1] ?? null;
  }
  if (!runId) return null;
  const runDir = join(root, "runs", runId);
  const aggregate = safeReadJson<FlywheelAggregate | null>(join(runDir, "judge-scores.json"), null);
  const traces = safeReadJsonl<FlywheelTrace>(join(runDir, "traces.jsonl"));
  if (!aggregate) return null;
  return {
    runId,
    generatedAt: aggregate.generatedAt,
    aggregate,
    traces,
  };
}

export function listFlywheelRuns(limit = 12): Array<{ runId: string; generatedAt: string; systemScore: number; matchRate: number }> {
  const runsRoot = join(flywheelDir(), "runs");
  if (!existsSync(runsRoot)) return [];
  const out: Array<{ runId: string; generatedAt: string; systemScore: number; matchRate: number }> = [];
  for (const entry of readdirSync(runsRoot).sort().reverse()) {
    if (out.length >= limit) break;
    const file = join(runsRoot, entry, "judge-scores.json");
    if (!existsSync(file)) continue;
    const aggregate = safeReadJson<FlywheelAggregate | null>(file, null);
    if (!aggregate) continue;
    out.push({
      runId: entry,
      generatedAt: aggregate.generatedAt,
      systemScore: aggregate.systemScore,
      matchRate: aggregate.matchRate,
    });
  }
  return out;
}

export function bandAgreementBadge(agreement: FlywheelTrace["bandAgreement"]): {
  label: string;
  tone: "good" | "warn" | "bad" | "muted";
} {
  switch (agreement) {
    case "match":
      return { label: "match", tone: "good" };
    case "adjacent":
      return { label: "adjacent", tone: "warn" };
    case "mismatch":
      return { label: "mismatch", tone: "bad" };
    default:
      return { label: "no_official_band", tone: "muted" };
  }
}

export function layerLabel(layer: FlywheelLayerKey): string {
  switch (layer) {
    case "ml":
      return "ML";
    case "agent":
      return "Agent";
    case "calibration":
      return "Calibration";
    case "trust":
      return "Trust";
    case "ux":
      return "UX";
    case "evidence":
      return "Evidence";
    default:
      return layer;
  }
}

export function fixLayerTone(layer: string | null): "good" | "warn" | "bad" | "muted" {
  if (!layer) return "muted";
  if (layer === "Data" || layer === "Infra") return "warn";
  if (layer === "ML" || layer === "Calibration") return "bad";
  return "muted";
}
