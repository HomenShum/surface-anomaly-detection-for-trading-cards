import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InspectionSkillBenchmarkResult } from "./inspection-skill-evolution";

export type FixtureRunResult = {
  fixtureName: string;
  passed: boolean;
  steps: Array<{
    tool: string;
    runtimeTool: string | null;
    durationMs: number;
    ok: boolean;
    forbiddenGradeHit: boolean;
    forbiddenPrivacyHit: boolean;
  }>;
  totalLatencyMs: number;
  failedStepCount: number;
  forbiddenGradeHits: number;
  forbiddenPrivacyHits: number;
};

export type BenchmarkRunRecord = {
  skillId: string;
  benchmarkId: string;
  generatedAt: string;
  fixtures: FixtureRunResult[];
  summary: InspectionSkillBenchmarkResult;
};

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return resolve(process.cwd(), "..", "..", "data");
}

function runsDir() {
  return join(dataDir(), "benchmarks", "runs");
}

function readRun(path: string): BenchmarkRunRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as BenchmarkRunRecord;
  } catch {
    return null;
  }
}

export function loadBenchmarkRunsForSkill(skillId: string, limit = 5): BenchmarkRunRecord[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.startsWith(`${skillId}_`) && file.endsWith(".json"))
    .sort()
    .slice(-limit)
    .reverse()
    .map((file) => readRun(join(dir, file)))
    .filter((entry): entry is BenchmarkRunRecord => Boolean(entry));
}

export function loadAllBenchmarkRuns(limit = 30): BenchmarkRunRecord[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .slice(-limit)
    .reverse()
    .map((file) => readRun(join(dir, file)))
    .filter((entry): entry is BenchmarkRunRecord => Boolean(entry));
}
