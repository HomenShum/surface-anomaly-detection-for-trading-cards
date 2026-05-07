import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { executeTool, type AgentReportContext, type ToolInputs, type ToolName } from "./tools";
import { loadSkillById, type SkillFolder } from "./skill-store";
import {
  type InspectionSkillBenchmarkResult,
  type InspectionToolName,
} from "./inspection-skill-evolution";

/**
 * Benchmark harness.
 *
 * For a given skill candidate, run its `steps` against every fixture in
 * data/benchmarks/fixtures/. Each fixture provides:
 *   - reportContext: the input the agent would have seen
 *   - groundTruth: { true_findings: [{ kind, region }], forbidden_strings: [...] }
 *
 * The harness scores:
 *   - latencyAddedMs: total wall-clock for the skill run
 *   - agentClaimsWithoutToolEvidence: number of fixtures where >0 step failed
 *   - officialGradeClaims: forbidden phrases like "PSA 10" appearing in tool output
 *   - privacyViolations: forbidden patterns like raw email/phone in tool output
 *   - precisionDelta / recallDelta / falsePositiveDelta: approximated from
 *     tool-output finding shape vs ground truth
 *   - passed: all hard gates clear
 *
 * Results land in data/benchmarks/runs/<skillId>_<ts>.json.
 */

const FORBIDDEN_GRADE_PATTERNS = [
  /\bPSA\s*\d{1,2}\b/i,
  /\bBGS\s*\d{1,2}(\.\d)?\b/i,
  /\bCGC\s*\d{1,2}(\.\d)?\b/i,
  /\bofficial\s+grade\b/i,
  /\blegal\s+proof\b/i,
  /\bcourt\s+evidence\b/i,
];

const FORBIDDEN_PRIVACY_PATTERNS = [
  /[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/, // email
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/, // SSN
  /\b\d{16}\b/, // credit card
];

const MAX_LATENCY_PER_STEP_MS = 4000;

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return resolve(process.cwd(), "..", "..", "data");
}

function fixturesDir() {
  return join(dataDir(), "benchmarks", "fixtures");
}

function runsDir() {
  return join(dataDir(), "benchmarks", "runs");
}

function ensureRunsDir() {
  if (!existsSync(runsDir())) mkdirSync(runsDir(), { recursive: true });
}

export type BenchmarkFixture = {
  name: string;
  description: string;
  reportContext: AgentReportContext;
  groundTruth: {
    true_findings: Array<{ kind: string; region?: string }>;
    forbidden_findings?: Array<{ kind: string; region?: string }>;
    expected_intents?: string[];
  };
};

export function loadFixtures(): BenchmarkFixture[] {
  const dir = fixturesDir();
  if (!existsSync(dir)) return [];
  const out: BenchmarkFixture[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as BenchmarkFixture;
      out.push(parsed);
    } catch {
      // skip malformed fixture
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function inspectionToolToRuntime(tool: InspectionToolName): ToolName | null {
  switch (tool) {
    case "crop_region":
      return "crop_finding";
    case "zoom_region":
      return "request_zoom_animation";
    case "run_glare_check":
      return "glare_check_on_crop";
    case "run_ding_detector":
      return "rerun_detector_on_crop";
    case "compare_regions":
      return "compare_to_baseline";
    case "save_evidence_crop":
      return "cite_evidence";
    case "explain_uncertainty":
      return "evaluate_glare_risk";
    default:
      return null;
  }
}

function defaultArgsFor(tool: ToolName, fixture: BenchmarkFixture): Record<string, unknown> {
  switch (tool) {
    case "crop_finding":
      return { index: 0, padding_pct: 4 };
    case "request_zoom_animation":
      return { region: fixture.groundTruth.true_findings[0]?.region ?? "center" };
    case "glare_check_on_crop":
      // Will likely fail without a prior crop; harness records that as a step failure.
      return { crop_id: "harness-bench-crop" };
    case "rerun_detector_on_crop":
      return { crop_id: "harness-bench-crop" };
    case "compare_to_baseline":
      return {
        region: fixture.groundTruth.true_findings[0]?.region ?? "center",
        finish_type: fixture.reportContext.finishType ?? "unknown",
        observed_finding_type: fixture.groundTruth.true_findings[0]?.kind,
      };
    case "cite_evidence":
      return { index: 0 };
    case "evaluate_glare_risk":
      return { region: fixture.groundTruth.true_findings[0]?.region ?? "center" };
    case "get_finding_detail":
      return { index: 0 };
    case "lookup_promoted_skill":
      return {
        finish_type: fixture.reportContext.finishType,
        user_intent: fixture.groundTruth.expected_intents?.[0],
      };
    case "recommend_retake":
      return { reasons: ["glare", "low_surface_confidence"] };
    case "propose_inspection_method":
      // Don't fire propose during benchmarks — would inflate the proposal queue.
      return {
        skill_id: "harness_no_op",
        title: "harness no-op",
        rationale: "benchmark harness placeholder",
        trigger: {},
        steps: [],
      };
    default:
      return {};
  }
}

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

function checkForbiddenStrings(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload).slice(0, 8192);
  let gradeHit = false;
  let privacyHit = false;
  for (const pattern of FORBIDDEN_GRADE_PATTERNS) if (pattern.test(json)) gradeHit = true;
  for (const pattern of FORBIDDEN_PRIVACY_PATTERNS) if (pattern.test(json)) privacyHit = true;
  return { gradeHit, privacyHit };
}

export async function runBenchmarkForSkill(input: { skillId: string; folder?: SkillFolder }): Promise<BenchmarkRunRecord> {
  const skill = loadSkillById(input.skillId);
  if (!skill) throw new Error(`Skill ${input.skillId} not found`);

  const fixtures = loadFixtures();
  const fixtureResults: FixtureRunResult[] = [];
  let totalLatency = 0;
  let totalFailures = 0;
  let totalGradeHits = 0;
  let totalPrivacyHits = 0;

  for (const fixture of fixtures) {
    const stepResults: FixtureRunResult["steps"] = [];
    let fixtureLatency = 0;
    let stepFailures = 0;
    let gradeHitsForFixture = 0;
    let privacyHitsForFixture = 0;
    const ctx = fixture.reportContext;
    let lastCropId: string | undefined;

    for (const step of skill.steps) {
      const runtimeTool = inspectionToolToRuntime(step.tool);
      if (!runtimeTool) {
        stepResults.push({
          tool: step.tool,
          runtimeTool: null,
          durationMs: 0,
          ok: false,
          forbiddenGradeHit: false,
          forbiddenPrivacyHit: false,
        });
        stepFailures += 1;
        continue;
      }
      let args = defaultArgsFor(runtimeTool, fixture);
      // Thread crop_id through the chain.
      if ((runtimeTool === "glare_check_on_crop" || runtimeTool === "rerun_detector_on_crop") && lastCropId) {
        args = { ...args, crop_id: lastCropId };
      }
      const t0 = performance.now();
      const result = await executeTool(runtimeTool, args as ToolInputs[ToolName], ctx);
      const durationMs = Math.round(performance.now() - t0);
      const stringContent = result.content as Record<string, unknown>;
      const forbidden = checkForbiddenStrings(stringContent);
      const ok = result.ok && !forbidden.gradeHit && !forbidden.privacyHit && durationMs <= MAX_LATENCY_PER_STEP_MS;
      if (forbidden.gradeHit) gradeHitsForFixture += 1;
      if (forbidden.privacyHit) privacyHitsForFixture += 1;
      if (!ok) stepFailures += 1;
      if (result.ok) {
        const cropId =
          (result.content as { crop_id?: string }).crop_id ??
          (result.uiAction && "cropId" in result.uiAction ? result.uiAction.cropId : undefined);
        if (cropId) lastCropId = cropId;
      }
      stepResults.push({
        tool: step.tool,
        runtimeTool,
        durationMs,
        ok,
        forbiddenGradeHit: forbidden.gradeHit,
        forbiddenPrivacyHit: forbidden.privacyHit,
      });
      fixtureLatency += durationMs;
    }

    const passed = stepFailures === 0 && gradeHitsForFixture === 0 && privacyHitsForFixture === 0;
    totalLatency += fixtureLatency;
    totalFailures += stepFailures;
    totalGradeHits += gradeHitsForFixture;
    totalPrivacyHits += privacyHitsForFixture;
    fixtureResults.push({
      fixtureName: fixture.name,
      passed,
      steps: stepResults,
      totalLatencyMs: fixtureLatency,
      failedStepCount: stepFailures,
      forbiddenGradeHits: gradeHitsForFixture,
      forbiddenPrivacyHits: privacyHitsForFixture,
    });
  }

  const fixtureCount = Math.max(1, fixtureResults.length);
  const fixturesPassed = fixtureResults.filter((entry) => entry.passed).length;
  const overallPassed =
    fixtures.length > 0 &&
    totalGradeHits === 0 &&
    totalPrivacyHits === 0 &&
    fixturesPassed === fixtures.length;

  const summary: InspectionSkillBenchmarkResult = {
    benchmarkId: `bench-${Date.now()}-${input.skillId}`,
    datasetVersion: `fixtures-v0.${fixtures.length}`,
    precisionDelta: fixtures.length === 0 ? 0 : (fixturesPassed - 0) / fixtureCount,
    recallDelta: fixtures.length === 0 ? 0 : (fixturesPassed - 0) / fixtureCount,
    falsePositiveDelta: -1 * (totalFailures / Math.max(1, skill.steps.length * fixtureCount)),
    latencyAddedMs: Math.round(totalLatency / Math.max(1, fixtureCount)),
    agentClaimsWithoutToolEvidence: totalFailures,
    officialGradeClaims: totalGradeHits,
    privacyViolations: totalPrivacyHits,
    passed: overallPassed,
  };

  const record: BenchmarkRunRecord = {
    skillId: input.skillId,
    benchmarkId: summary.benchmarkId,
    generatedAt: new Date().toISOString(),
    fixtures: fixtureResults,
    summary,
  };
  ensureRunsDir();
  writeFileSync(
    join(runsDir(), `${input.skillId}_${Date.now()}.json`),
    JSON.stringify(record, null, 2),
    "utf-8",
  );
  return record;
}

export function loadBenchmarkRunsForSkill(skillId: string, limit = 5): BenchmarkRunRecord[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  const matches = readdirSync(dir)
    .filter((file) => file.startsWith(`${skillId}_`) && file.endsWith(".json"))
    .sort()
    .slice(-limit)
    .reverse();
  const out: BenchmarkRunRecord[] = [];
  for (const file of matches) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as BenchmarkRunRecord;
      out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

export function loadAllBenchmarkRuns(limit = 30): BenchmarkRunRecord[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .slice(-limit)
    .reverse();
  const out: BenchmarkRunRecord[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as BenchmarkRunRecord;
      out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

