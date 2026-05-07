import Link from "next/link";
import {
  bandAgreementBadge,
  fixLayerTone,
  layerLabel,
  listFlywheelRuns,
  loadLatestFlywheelRun,
  type FlywheelLayerKey,
  type FlywheelTrace,
} from "../../../lib/cert-references-flywheel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agentic flywheel · Card Condition Vault",
  description:
    "System-level eval of the inspection agent: ML, calibration, trust, UX, evidence, and recommended layer-aware fixes.",
};

const LAYER_ORDER: FlywheelLayerKey[] = ["ml", "agent", "calibration", "trust", "ux", "evidence"];

function fmt(score: number | null | undefined, digits = 3): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return score.toFixed(digits);
}

function pct(score: number | null | undefined, digits = 1): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return `${(score * 100).toFixed(digits)}%`;
}

function pillClass(tone: "good" | "warn" | "bad" | "muted") {
  return `flywheel-pill flywheel-pill--${tone}`;
}

function fixCardClass(layer: string | null) {
  const tone = fixLayerTone(layer);
  return `flywheel-fix-card flywheel-fix-card--${tone}`;
}

function toolSequenceLabel(trace: FlywheelTrace) {
  return trace.toolSequence.map((c) => c.tool).join(" → ");
}

export default function FlywheelDashboardPage() {
  const run = loadLatestFlywheelRun();
  const history = listFlywheelRuns(12);

  if (!run) {
    return (
      <main className="flywheel-shell">
        <header>
          <p className="page-kicker">Benchmarks</p>
          <h1>Agentic Flywheel</h1>
          <p className="flywheel-intro">
            Self-evaluating loop over the whole inspection system: agent policy + image-manipulation
            tools + ML model + calibration + evidence manifest + UI/report. Six-layer LLM-judge rubric
            scores each cert and recommends a layer-aware fix.
          </p>
        </header>
        <section className="flywheel-card flywheel-empty">
          <h2>No flywheel runs yet</h2>
          <p>
            Run <code>pnpm flywheel:run</code> to generate a baseline. Use{" "}
            <code>--mock-inference</code> to exercise the ML+Calibration layers without slab images,
            or wire the FastAPI inference service and drop slab images under{" "}
            <code>data/cert-references/slab-images/&lt;certId&gt;/</code> for real predictions.
          </p>
        </section>
      </main>
    );
  }

  const { aggregate, traces } = run;
  const simulatedOnly =
    (aggregate.realImageCount ?? 0) === 0 &&
    (aggregate.simulatedImageCount ?? Math.max(0, aggregate.imagedCount - (aggregate.realImageCount ?? 0))) > 0;

  const sortedTraces = [...traces].sort((a, b) => {
    const layerA = a.judge.recommendedFixLayer ?? "z";
    const layerB = b.judge.recommendedFixLayer ?? "z";
    if (layerA !== layerB) return layerA.localeCompare(layerB);
    return a.judge.systemScore - b.judge.systemScore;
  });

  const errorBucketEntries = Object.entries(aggregate.errorBuckets).sort((a, b) => b[1] - a[1]);

  return (
    <main className="flywheel-shell">
      <header>
        <p className="page-kicker">Benchmarks</p>
        <h1>Agentic Flywheel</h1>
        <p className="flywheel-intro">
          Karpathy-style closed-loop eval of the inspection system. Each cert reference flows through
          the agent policy + tools + ML detector + calibrator. The LLM-judge framework scores six
          layers (ML, agent, calibration, trust, UX, evidence) and recommends a layer-specific fix
          when the system score drifts.
        </p>
        <div className="flywheel-meta">
          <span>run {aggregate.runId}</span>
          <span>policy {aggregate.agentPolicyVersion}</span>
          <span>rubric {aggregate.judgeRubricVersion}</span>
          <span>generated {aggregate.generatedAt.replace("T", " ").replace(/\..*$/, "Z")}</span>
        </div>
      </header>

      {simulatedOnly ? (
        <section className="flywheel-banner">
          <p className="flywheel-banner-kicker">Simulation only</p>
          <h2>This run is not certified-reference proof.</h2>
          <p>
            The latest flywheel used simulated/mock inference rows. It can dogfood the judge loop,
            but match-rate and system-score tiles do not count toward production deployability.
          </p>
        </section>
      ) : null}

      <section className="flywheel-hero">
        <div className="flywheel-card flywheel-card--gradient">
          <p className="flywheel-card-kicker">System score</p>
          <p className="flywheel-systemscore">{fmt(aggregate.systemScore)}</p>
          <p className="flywheel-systemscore-note">
            weighted across {aggregate.certCount} certs, {aggregate.realImageCount ?? 0} real
            image-backed and{" "}
            {aggregate.simulatedImageCount ?? Math.max(0, aggregate.imagedCount - (aggregate.realImageCount ?? 0))}{" "}
            simulated.
          </p>
          <div className="flywheel-stat-grid">
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">match rate</div>
              <div className="flywheel-stat-val flywheel-stat-val--good">
                {simulatedOnly ? "not proof" : pct(aggregate.matchRate)}
              </div>
            </div>
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">adjacent</div>
              <div className="flywheel-stat-val flywheel-stat-val--warn">{pct(aggregate.adjacentRate)}</div>
            </div>
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">mismatch</div>
              <div className="flywheel-stat-val flywheel-stat-val--bad">{pct(aggregate.mismatchRate)}</div>
            </div>
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">no official band</div>
              <div className="flywheel-stat-val flywheel-stat-val--muted">{pct(aggregate.noOfficialBandRate)}</div>
            </div>
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">proof matches</div>
              <div className="flywheel-stat-val flywheel-stat-val--good">{aggregate.proofEligibleMatches ?? 0}</div>
            </div>
            <div className="flywheel-stat">
              <div className="flywheel-stat-key">proof rate</div>
              <div className="flywheel-stat-val flywheel-stat-val--muted">{pct(aggregate.proofMatchRate ?? 0)}</div>
            </div>
          </div>
        </div>

        <div className="flywheel-card">
          <p className="flywheel-card-kicker">Per-layer scores</p>
          <div className="flywheel-layer-grid">
            {LAYER_ORDER.map((layer) => {
              const score = aggregate.byLayer[layer];
              const prev = aggregate.deltaVsPrevious?.byLayer?.[layer] ?? null;
              const delta = score !== null && prev !== null ? score - prev : null;
              const deltaCls = delta === null ? "" : delta >= 0 ? "flywheel-layer-delta--up" : "flywheel-layer-delta--down";
              return (
                <div key={layer} className="flywheel-layer-card">
                  <div className="flywheel-layer-card-head">
                    <span className="flywheel-layer-name">{layerLabel(layer)}</span>
                    {delta !== null && (
                      <span className={`flywheel-layer-delta ${deltaCls}`}>
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <div className="flywheel-layer-score">{fmt(score)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {aggregate.recommendedFixes.length > 0 && (
        <section className="flywheel-card">
          <p className="flywheel-card-kicker">Recommended fixes</p>
          <h2>Layer-aware suggestions from the judge</h2>
          <div className="flywheel-fixes-list">
            {aggregate.recommendedFixes.map((fix) => (
              <div key={`${fix.layer}-${fix.severity}`} className={fixCardClass(fix.layer)}>
                <div className="flywheel-fix-head">
                  <span className="flywheel-fix-layer">{fix.layer}</span>
                  <span className="flywheel-fix-severity">{fix.severity}</span>
                </div>
                <p className="flywheel-fix-rationale">{fix.rationale}</p>
                <ul className="flywheel-fix-actions">
                  {fix.actions.map((action, idx) => (
                    <li key={idx}>{action}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {errorBucketEntries.length > 0 && (
        <section className="flywheel-card">
          <p className="flywheel-card-kicker">Error buckets</p>
          <h2>Dominant failure modes across the run</h2>
          <table className="flywheel-buckets">
            <thead>
              <tr>
                <th>bucket</th>
                <th className="numeric">count</th>
                <th>interpretation</th>
              </tr>
            </thead>
            <tbody>
              {errorBucketEntries.map(([bucket, count]) => (
                <tr key={bucket}>
                  <td className="bucket-name">{bucket}</td>
                  <td className="bucket-count">{count}</td>
                  <td className="bucket-explain">{interpretBucket(bucket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="flywheel-card">
        <p className="flywheel-card-kicker">Per-cert traces</p>
        <h2>{sortedTraces.length} certs scored</h2>
        <div className="flywheel-traces-wrap">
          <table className="flywheel-traces">
            <thead>
              <tr>
                <th>cert</th>
                <th>grade</th>
                <th>official band</th>
                <th>predicted</th>
                <th>agreement</th>
                <th className="numeric">system</th>
                <th className="numeric">ml</th>
                <th className="numeric">cal</th>
                <th className="numeric">trust</th>
                <th className="numeric">ev</th>
                <th>bucket</th>
                <th>fix layer</th>
              </tr>
            </thead>
            <tbody>
              {sortedTraces.map((trace) => {
                const badge = bandAgreementBadge(trace.bandAgreement);
                return (
                  <tr key={trace.certId}>
                    <td>
                      <Link href={`/examples/${trace.certId}`}>{trace.certId}</Link>
                    </td>
                    <td>{trace.officialGrade ?? "—"}</td>
                    <td className="muted">{trace.officialBand ?? "—"}</td>
                    <td className="muted">{trace.predictedBand ?? "—"}</td>
                    <td>
                      <span className={pillClass(badge.tone)}>{badge.label}</span>
                    </td>
                    <td className="numeric">{fmt(trace.judge.systemScore, 2)}</td>
                    <td className="numeric muted">{fmt(trace.judge.layers.ml.score, 2)}</td>
                    <td className="numeric muted">{fmt(trace.judge.layers.calibration.score, 2)}</td>
                    <td className="numeric muted">{fmt(trace.judge.layers.trust.score, 2)}</td>
                    <td className="numeric muted">{fmt(trace.judge.layers.evidence.score, 2)}</td>
                    <td className="muted">{trace.judge.errorBucket?.bucket ?? "—"}</td>
                    <td>
                      {trace.judge.recommendedFixLayer ? (
                        <span className={pillClass(fixLayerTone(trace.judge.recommendedFixLayer))}>
                          {trace.judge.recommendedFixLayer}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {history.length > 1 && (
        <section className="flywheel-card">
          <p className="flywheel-card-kicker">Run history</p>
          <h2>Last {history.length} runs</h2>
          <table className="flywheel-history">
            <thead>
              <tr>
                <th>run id</th>
                <th>generated</th>
                <th className="numeric">system</th>
                <th className="numeric">match rate</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.runId} className={entry.runId === run.runId ? "flywheel-history-current" : ""}>
                  <td>{entry.runId}</td>
                  <td className="muted">{entry.generatedAt.replace("T", " ").replace(/\..*$/, "Z")}</td>
                  <td className="numeric">{fmt(entry.systemScore, 3)}</td>
                  <td className="numeric">{pct(entry.matchRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="flywheel-card flywheel-help">
        <p className="flywheel-help-title">How to read this dashboard</p>
        <ul>
          <li>
            <code>match</code> means the predicted band lands the official band. Adjacent = ±1 band.
            Mismatch = ≥2 bands. No-official = TAG/unknown.
          </li>
          <li>
            <code>missing_image</code> is a Data-layer issue, not an ML issue. The judge correctly
            directs the fix to the friend-ask pipeline rather than the model.
          </li>
          <li>
            <code>stale_baseline_mirror</code> means a row still has placeholder predictions
            (modelVersion=baseline-trust-cert). Run <code>pnpm eval:certrefs:run</code> to replace.
          </li>
          <li>We never claim to predict an exact grader grade. Our calibrator emits a band only.</li>
        </ul>
      </section>
    </main>
  );
}

function interpretBucket(bucket: string): string {
  switch (bucket) {
    case "missing_image":
      return "Cert lacks a slab image. Friend Ask v2 covers the gap.";
    case "inference_failure":
      return "FastAPI returned non-2xx or timed out. Restart inference service.";
    case "overconfident_clean_failure":
      return "Detector returned 0 findings on a low-tier cert. Lower confidence threshold.";
    case "false_positive_storm":
      return "Detector reported >2 findings on a GEM-tier cert. Add glare pre-filter.";
    case "band_calibrator_drift":
      return "Detection counts are sane but band mapping mismatched. Re-tune buckets.";
    case "band_off_by_one":
      return "Predicted band is one bucket off — calibrator boundary needs a small tune.";
    case "stale_baseline_mirror":
      return "Confidence stuck at 0 (baseline mirror residue). Re-run real inference.";
    case "glare_false_positive_risk":
      return "Holo/glossy with high glare lacked an evaluate_glare_risk tool call.";
    case "low_evidence_completeness":
      return "Findings missing sha256/bbox/modelVersion. Inspect FastAPI response.";
    default:
      return "—";
  }
}
