import Link from "next/link";
import { loadAllCertifiedReferences } from "../../../lib/cert-references";
import { loadLatestAgenticCertEvalReport } from "../../../lib/cert-references-agentic-eval";
import { loadLatestCertEvalReport } from "../../../lib/cert-references-eval";
import { loadLatestOutcomeProofReport } from "../../../lib/cert-references-outcome-proof";
import { loadLatestProductionReadinessReport } from "../../../lib/cert-references-production-readiness";

export const dynamic = "force-dynamic";

function gradeBucket(grade?: string) {
  const label = String(grade ?? "").toUpperCase();
  if (label.includes("10") || label.includes("GEM")) return "10";
  if (label.includes("9") || label.includes("MINT")) return "9";
  if (label.includes("8")) return "8";
  if (label.includes("7")) return "7";
  if (label.includes("6")) return "6";
  if (label.includes("5")) return "5";
  return "pending";
}

export default function CertifiedReferenceBenchmarksPage() {
  const refs = loadAllCertifiedReferences();
  const evalReport = loadLatestCertEvalReport("latest");
  const agenticReport = loadLatestAgenticCertEvalReport("latest");
  const outcomeProof = loadLatestOutcomeProofReport();
  const productionReadiness = loadLatestProductionReadinessReport();
  const evalRowByCertId = new Map(evalReport?.rows.map((row) => [row.certId, row] as const) ?? []);
  const buckets = refs.reduce<Record<string, number>>((acc, ref) => {
    const key = gradeBucket(ref.officialGrade);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Per-grade match-rate buckets sourced from the band-agreement eval.
  const matchByBucket: Record<string, { covered: number; matched: number; mismatched: number }> = {};
  if (evalReport) {
    for (const row of evalReport.rows) {
      const ref = refs.find((r) => r.id === row.certId);
      if (!ref) continue;
      const key = gradeBucket(ref.officialGrade);
      if (!matchByBucket[key]) matchByBucket[key] = { covered: 0, matched: 0, mismatched: 0 };
      if (row.predictedBand) {
        matchByBucket[key].covered += 1;
        if (row.bandAgreement === "match") matchByBucket[key].matched += 1;
        if (row.bandAgreement === "mismatch") matchByBucket[key].mismatched += 1;
      }
    }
  }

  const modelAnalyzed = refs.filter((ref) =>
    ["model_analyzed", "comparison_ready", "example_published"].includes(ref.status),
  ).length;
  const silverPlus = refs.filter((ref) => ref.trustTier === "silver_plus").length;
  const lowerGrade = refs.filter((ref) => ["5", "6", "7"].includes(gradeBucket(ref.officialGrade))).length;
  const overallMatchRate =
    evalReport && evalReport.totals.predictionsCovered > 0
      ? evalReport.totals.matched / evalReport.totals.predictionsCovered
      : null;
  const predictedRows = evalReport?.rows.filter((row) => row.predictedBand) ?? [];
  const isPlaceholderEval =
    Boolean(evalReport) &&
    (evalReport?.modelVersion === "baseline-trust-cert" ||
      evalReport?.modelVersion === "test-baseline-mirror" ||
      (predictedRows.length > 0 && predictedRows.every((row) => row.confidence === 0)));

  return (
    <main className="benchmarks-shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <span className="page-kicker">Certified reference benchmarks</span>
          <h1>PSA/TAG references for outcome calibration, not training.</h1>
          <p className="muted" style={{ maxWidth: 760, margin: "8px 0 0" }}>
            This page tracks the certified-reference batch used to compare our condition bands against official
            outcomes. These are Silver/Silver+ until raw pre-submission scans, consent, and human DING review exist.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="button secondary" href="/certs/import">Import certs</Link>
          <Link className="button secondary" href="/review/dings">Review DINGs</Link>
          <Link className="button secondary" href="/benchmarks">All benchmarks</Link>
        </div>
      </header>

      <section className="benchmarks-summary">
        <article>
          <span>Certified refs</span>
          <strong>{refs.length}</strong>
          <em>{silverPlus} Silver+</em>
        </article>
        <article>
          <span>Grade spread</span>
          <strong>{Object.keys(buckets).filter((key) => key !== "pending").length}</strong>
          <em>distinct PSA buckets</em>
        </article>
        <article>
          <span>Lower-grade refs</span>
          <strong>{lowerGrade}</strong>
          <em>PSA 5-7 calibration anchors</em>
        </article>
        <article>
          <span>Band match rate</span>
          <strong>{overallMatchRate === null ? "—" : `${Math.round(overallMatchRate * 100)}%`}</strong>
          <em>
            {evalReport
              ? `${evalReport.totals.matched}/${evalReport.totals.predictionsCovered} via ${evalReport.modelVersion}`
              : "no eval yet"}
          </em>
        </article>
      </section>

      {isPlaceholderEval ? (
        <section className="benchmarks-section benchmarks-section--stub">
          <h2>Baseline mirror only</h2>
          <p className="benchmarks-stub-note">
            The current band-agreement rows are placeholder mirrors with zero-confidence predictions. They prove
            the certified-reference eval wiring, not real slab-image model performance.
          </p>
        </section>
      ) : null}

      <section className={`benchmarks-section ${productionReadiness?.productionDeployable ? "" : "benchmarks-section--stub"}`}>
        <h2>Production accuracy readiness</h2>
        {productionReadiness ? (
          <>
            <p className="muted">
              Hard deployability gate over real certified-reference rows, Gold data, human DING review,
              replayable images, and agent tool coverage. This is the release gate; demo proof rows alone do not pass it.
            </p>
            <div className="cert-eval-totals">
              <div>
                <span>Demo</span>
                <strong>{productionReadiness.demoDeployable ? "Ready" : "Blocked"}</strong>
                <small>app/eval wiring mode</small>
              </div>
              <div>
                <span>Alpha</span>
                <strong>{productionReadiness.certifiedReferenceAlphaDeployable ? "Ready" : "Blocked"}</strong>
                <small>Silver+ image-backed mode</small>
              </div>
              <div>
                <span>Trust beta</span>
                <strong>{productionReadiness.trustBetaDeployable ? "Ready" : "Blocked"}</strong>
                <small>Gold + review mode</small>
              </div>
              <div>
                <span>Deployability</span>
                <strong>{productionReadiness.productionDeployable ? "Ready" : "Blocked"}</strong>
                <small>{productionReadiness.summary.blockerIssues} P0 blockers</small>
              </div>
              <div>
                <span>Real rows</span>
                <strong>{productionReadiness.summary.realOutcomeRows}</strong>
                <small>target {productionReadiness.thresholds.minRealOutcomeRows}</small>
              </div>
              <div>
                <span>Gold records</span>
                <strong>{productionReadiness.summary.goldRefs}</strong>
                <small>target {productionReadiness.thresholds.minGoldRefs}</small>
              </div>
              <div>
                <span>Image-backed Silver+</span>
                <strong>{productionReadiness.summary.imageBackedSilverPlusRefs ?? 0}</strong>
                <small>alpha target {productionReadiness.alphaThresholds?.minImageBackedSilverPlusRefs ?? 20}</small>
              </div>
              <div>
                <span>Missing images</span>
                <strong>{productionReadiness.summary.missingReplayableImages}</strong>
                <small>{productionReadiness.summary.declaredSlabImagesMissingLocal} declared Silver+</small>
              </div>
            </div>
            {productionReadiness.releaseModes ? (
              <table className="benchmarks-table">
                <thead>
                  <tr>
                    <th>Release mode</th>
                    <th>Status</th>
                    <th>Blocking reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(productionReadiness.releaseModes).map((mode) => (
                    <tr key={mode.id}>
                      <td>{mode.label}</td>
                      <td className={mode.deployable ? "ok" : "warn"}>{mode.deployable ? "PASS" : "BLOCKED"}</td>
                      <td className="muted">{mode.blockingReasons.join("; ") || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <table className="benchmarks-table">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {productionReadiness.gates.map((gate) => (
                  <tr key={gate.id}>
                    <td>{gate.label}</td>
                    <td className={gate.passed ? "ok" : "warn"}>{gate.passed ? "PASS" : "BLOCKED"}</td>
                    <td className="muted">{gate.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="benchmarks-stub-note">
            No production-readiness report yet. Run <code>pnpm eval:production-readiness</code>.
          </p>
        )}
      </section>

      <section className={`benchmarks-section ${outcomeProof?.outcomeMatchingProved ? "" : "benchmarks-section--stub"}`}>
        <h2>Real image outcome proof</h2>
        {outcomeProof ? (
          <>
            <p className="muted">
              Runs public certified-reference slab/listing images through the local inference API, hashes the exact
              input bytes, then compares our internal condition band against the listed certified outcome band.
              Source tier stays <code>marketplace_silver_plus</code>, not Gold and not PSA API proof.
            </p>
            <div className="cert-eval-totals">
              <div>
                <span>Proof status</span>
                <strong>{outcomeProof.outcomeMatchingProved ? "1 replayed match" : "Blocked"}</strong>
                <small>{outcomeProof.summary.proofEligibleMatches} proof-eligible match rows</small>
              </div>
              <div>
                <span>Real traces</span>
                <strong>{outcomeProof.summary.realInferenceRows}</strong>
                <small>{outcomeProof.summary.totalRefs} marketplace ref(s)</small>
              </div>
              <div>
                <span>Agreement</span>
                <strong>{outcomeProof.summary.match}/{outcomeProof.summary.totalRefs}</strong>
                <small>{outcomeProof.summary.adjacent} adjacent, {outcomeProof.summary.mismatch} mismatch</small>
              </div>
              <div>
                <span>Production</span>
                <strong>{outcomeProof.productionDeployable ? "Ready" : "Blocked"}</strong>
                <small>{outcomeProof.modelMetadata?.model_version ?? "model unknown"}</small>
              </div>
            </div>
            <table className="benchmarks-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Official band</th>
                  <th>Predicted band</th>
                  <th>Agreement</th>
                  <th>Proof</th>
                  <th>Input hashes</th>
                </tr>
              </thead>
              <tbody>
                {outcomeProof.traces.map((trace) => (
                  <tr key={trace.certId}>
                    <td>
                      <a href={trace.sourceUrl} target="_blank" rel="noreferrer">{trace.certId}</a>
                      <br />
                      <span className="muted">{trace.cardIdentity}</span>
                    </td>
                    <td>{trace.officialBand}</td>
                    <td>{trace.predictedBand ?? "none"}</td>
                    <td className={trace.bandAgreement === "match" ? "ok" : "warn"}>{trace.bandAgreement}</td>
                    <td className={trace.proofEligible ? "ok" : "warn"}>
                      {trace.proofEligible ? "eligible" : trace.proofBlockers.join("; ") || "blocked"}
                    </td>
                    <td className="muted">
                      {trace.remoteImageArtifacts
                        .filter((artifact) => artifact.ok)
                        .map((artifact) => `${artifact.view}:${artifact.sha256?.slice(0, 10)}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="benchmarks-stub-note">
              This is the first replayable proof loop, not a production accuracy claim. It remains blocked for deployability
              until larger Silver+/Gold coverage, raw scans, consent, and human DING review exist.
            </p>
          </>
        ) : (
          <p className="benchmarks-stub-note">
            No real image-backed proof report yet. Run{" "}
            <code>pnpm eval:certrefs:remote-proof -- --strict</code> with the inference API online.
          </p>
        )}
      </section>

      <section className={`benchmarks-section ${agenticReport?.deployable ? "" : "benchmarks-section--stub"}`}>
        <h2>Agentic system eval</h2>
        {agenticReport ? (
          <>
            <p className="muted">
              Evaluates the whole loop: agent policy, image tools, ML model output, calibration, evidence readiness,
              and grounded explanation. Model: <code>{agenticReport.modelVersion}</code>. Judge:{" "}
              <code>{agenticReport.judgeMode}</code>.
            </p>
            <div className="cert-eval-totals">
              <div>
                <span>System status</span>
                <strong>{agenticReport.deployable ? "Ready" : "Blocked"}</strong>
                <small>{agenticReport.totals.needsReview} rows need review</small>
              </div>
              <div>
                <span>Real traces</span>
                <strong>{agenticReport.totals.realPredictions}</strong>
                <small>{agenticReport.totals.placeholderPredictions} placeholder, {agenticReport.totals.noPredictions} missing</small>
              </div>
              <div>
                <span>Judge score</span>
                <strong>{Math.round(agenticReport.totals.averageScores.overall * 100)}%</strong>
                <small>grounding {Math.round(agenticReport.totals.averageScores.grounding * 100)}%</small>
              </div>
              <div>
                <span>Evidence</span>
                <strong>{agenticReport.totals.replayableImageRefs}</strong>
                <small>{agenticReport.totals.goldRefs} Gold records</small>
              </div>
            </div>
            {!agenticReport.deployable ? (
              <p className="benchmarks-stub-note">
                Current blocker: this proves eval wiring and policy, not certified-outcome model agreement yet.
                Next required work is real slab/raw image inference traces, Gold records, and missing agent tools:
                {" "}
                {(agenticReport.toolSurface?.missingRequired ?? []).join(", ") || "none"}.
              </p>
            ) : null}
            <table className="benchmarks-table">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {agenticReport.gates.map((gate) => (
                  <tr key={gate.id}>
                    <td>{gate.label}</td>
                    <td className={gate.passed ? "ok" : "warn"}>{gate.passed ? "PASS" : "BLOCKED"}</td>
                    <td className="muted">{gate.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="benchmarks-stub-note">
            No agentic cert eval yet. Run <code>pnpm eval:certrefs:agentic</code> to judge agent tools,
            model predictions, calibration, evidence, and explanation grounding together.
          </p>
        )}
      </section>

      {evalReport ? (
        <section className="benchmarks-section">
          <h2>Per-grade band agreement</h2>
          <p className="muted">
            Match rate per PSA grade bucket from <code>data/benchmarks/cert_refs/latest.json</code>. Honest
            contract: we compare INTERNAL CONDITION BAND, never the exact grade.
          </p>
          <table className="benchmarks-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Refs</th>
                <th>Predicted</th>
                <th>Matched</th>
                <th>Mismatched</th>
                <th>Match rate</th>
              </tr>
            </thead>
            <tbody>
              {["10", "9", "8", "7", "6", "5"].map((bucket) => {
                const entry = matchByBucket[bucket];
                const refCount = buckets[bucket] ?? 0;
                if (!entry || entry.covered === 0) {
                  return (
                    <tr key={bucket}>
                      <td>PSA {bucket}</td>
                      <td>{refCount}</td>
                      <td className="muted">no predictions yet</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                  );
                }
                const rate = entry.matched / entry.covered;
                return (
                  <tr key={bucket}>
                    <td>PSA {bucket}</td>
                    <td>{refCount}</td>
                    <td>{entry.covered}</td>
                    <td className="ok">{entry.matched}</td>
                    <td className="warn">{entry.mismatched}</td>
                    <td>{Math.round(rate * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="benchmarks-section">
        <h2>Grade distribution</h2>
        <table className="benchmarks-table">
          <thead>
            <tr>
              <th>Official bucket</th>
              <th>References</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {["10", "9", "8", "7", "6", "5", "pending"].map((bucket) => (
              <tr key={bucket}>
                <td>{bucket === "pending" ? "pending / external report" : `PSA ${bucket}`}</td>
                <td>{buckets[bucket] ?? 0}</td>
                <td className="muted">
                  {bucket === "10"
                    ? "clean/Gem alignment checks"
                    : bucket === "9" || bucket === "8"
                      ? "near-mint/mint boundary checks"
                      : bucket === "pending"
                        ? "link-only references"
                        : "visible-wear and overconfident-clean checks"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="benchmarks-section">
        <h2>Reference registry</h2>
        <table className="benchmarks-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Outcome</th>
              <th>Card</th>
              <th>Trust</th>
              <th>Predicted band</th>
              <th>Agreement</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {refs.map((ref) => {
              const evalRow = evalRowByCertId.get(ref.id);
              const slug = ref.id.replaceAll("_", "-");
              return (
                <tr key={ref.id}>
                  <td>
                    <a href={ref.externalUrl} rel="noreferrer" target="_blank">
                      {ref.provider} {ref.certNumber}
                    </a>
                  </td>
                  <td>{ref.officialGrade ?? "pending"}</td>
                  <td className="muted">{ref.cardIdentity ?? "identity pending"}</td>
                  <td>{ref.trustTier.replace("_", "+")}</td>
                  <td>
                    <code>{evalRow?.predictedBand ?? "no eval"}</code>
                  </td>
                  <td>
                    {evalRow ? (
                      <span className={`cert-eval-agreement cert-eval-agreement--${
                        evalRow.bandAgreement === "match"
                          ? "match"
                          : evalRow.bandAgreement === "adjacent"
                            ? "adjacent"
                            : evalRow.bandAgreement === "mismatch"
                              ? "mismatch"
                              : "neutral"
                      }`}>
                        {evalRow.bandAgreement.replace("_", " ")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Link href={`/examples/${slug}`}>open ↗</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="benchmarks-section benchmarks-section--stub">
        <h2>Current deployability gate</h2>
        <p className="benchmarks-stub-note">
          Certified references are useful for calibration, but this batch does not make a model deployable by itself.
          The release gate remains blocked until model outputs are generated for these references and at least one
          Gold/gold-candidate record exists.
        </p>
      </section>
    </main>
  );
}
