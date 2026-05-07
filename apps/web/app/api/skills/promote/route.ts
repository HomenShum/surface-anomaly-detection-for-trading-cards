import { NextResponse } from "next/server";
import { promoteSkill } from "../../../../lib/agent/skill-store";
import { loadBenchmarkRunsForSkill } from "../../../../lib/agent/benchmark";
import { evaluateSkillPromotion, type SkillPromotionTarget } from "../../../../lib/agent/inspection-skill-evolution";
import { loadSkillById } from "../../../../lib/agent/skill-store";
import { bumpContributorOnVerified, exportSkillToOpenSource } from "../../../../lib/agent/methods-bridge";
import { loadLatestCertEvalReport } from "../../../../lib/cert-references-eval";
import { loadLatestProductionReadinessReport } from "../../../../lib/cert-references-production-readiness";

export const runtime = "nodejs";

const VALID_TARGETS: SkillPromotionTarget[] = ["staging", "canary", "production"];

export async function POST(request: Request) {
  let body: { skillId?: string; target?: SkillPromotionTarget; humanApproved?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const skillId = body.skillId?.trim();
  const target = body.target;
  if (!skillId || !target || !VALID_TARGETS.includes(target)) {
    return NextResponse.json({ ok: false, error: "skillId and target (staging/canary/production) required." }, { status: 400 });
  }

  // Cross-reference benchmarks before promotion. Production REQUIRES at least one
  // passed benchmark AND humanApproved=true. Staging only requires that the
  // skill exists and steps reference allowed tools.
  const skill = loadSkillById(skillId);
  if (!skill) return NextResponse.json({ ok: false, error: `Skill ${skillId} not found.` }, { status: 404 });

  const benchmarks = loadBenchmarkRunsForSkill(skillId, 5).map((run) => run.summary);
  // Cert-reference eval gate: required for canary/production. Loads the latest
  // band-agreement report from data/benchmarks/cert_refs/latest.json (written by
  // `pnpm eval:certrefs:bands`). Production baseline (if any) is at
  // `production-baseline.json` in the same directory.
  const candidateCertEval = loadLatestCertEvalReport("latest");
  const baselineCertEval = loadLatestCertEvalReport("production-baseline");
  const productionReadiness = loadLatestProductionReadinessReport();
  if (target !== "staging" && !productionReadiness?.productionDeployable) {
    return NextResponse.json(
      {
        ok: false,
        target,
        reasons: [
          "Canary or production promotion requires the production accuracy readiness gate to pass.",
          productionReadiness
            ? `${productionReadiness.summary.blockerIssues} P0 blocker(s); ${productionReadiness.summary.realOutcomeRows}/${productionReadiness.thresholds.minRealOutcomeRows} real outcome rows; ${productionReadiness.summary.goldRefs}/${productionReadiness.thresholds.minGoldRefs} Gold refs.`
            : "No production readiness report found. Run `pnpm eval:production-readiness`.",
        ],
        productionReadinessLoaded: Boolean(productionReadiness),
      },
      { status: 422 },
    );
  }
  const decision = evaluateSkillPromotion(skill, benchmarks, target, {
    humanApproved: Boolean(body.humanApproved),
    certEval: candidateCertEval
      ? { candidateResult: candidateCertEval, baselineResult: baselineCertEval ?? undefined }
      : undefined,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        ok: false,
        target,
        reasons: decision.reasons,
        benchmarksFound: benchmarks.length,
        certEvalLoaded: Boolean(candidateCertEval),
        certEvalBaselineLoaded: Boolean(baselineCertEval),
      },
      { status: 422 },
    );
  }

  const result = promoteSkill(skillId, target, {
    humanApproved: Boolean(body.humanApproved),
    benchmarks,
    certEval: candidateCertEval
      ? { candidateResult: candidateCertEval, baselineResult: baselineCertEval ?? undefined }
      : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, target, reasons: result.reasons }, { status: 422 });
  }
  // Side effects: open-source export + contributor reward bump.
  let openSourcePath: string | null = null;
  let contributorBump: ReturnType<typeof bumpContributorOnVerified> = null;
  try {
    if (target === "production" || target === "canary") {
      openSourcePath = exportSkillToOpenSource(skillId);
      const contributorHandle = result.updated?.contributor?.handle;
      if (contributorHandle) {
        const badge = target === "production" ? "Verified Method Author" : "Reproduced Method Author";
        contributorBump = bumpContributorOnVerified(contributorHandle, badge);
      }
    }
  } catch {
    // never break the promotion on side-effect failure
  }
  return NextResponse.json({
    ok: true,
    target,
    reasons: result.reasons,
    updated: result.updated,
    benchmarksFound: benchmarks.length,
    openSourcePath,
    contributorUpdated: contributorBump,
    rewardEvent: target === "production" ? "method_verified" : target === "canary" ? "method_reproduced" : "method_submitted",
  });
}
