import Link from "next/link";
import { datasetsByTier } from "../../lib/examples/dataset-sources";
import { exampleOutcomes, conditionLadder } from "../../lib/examples/registry";
import { loadAllBenchmarkRuns } from "../../lib/agent/benchmark-runs";
import { loadLatestYoloEval } from "../../lib/agent/yolo-eval";

export const dynamic = "force-dynamic";

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export default function BenchmarksPage() {
  const runs = loadAllBenchmarkRuns(50);
  const yolo = loadLatestYoloEval();
  const passed = runs.filter((run) => run.summary.passed).length;
  const total = runs.length;
  const totalFixturePasses = runs.reduce(
    (acc, run) => acc + run.fixtures.filter((entry) => entry.passed).length,
    0,
  );
  const totalFixtureRuns = runs.reduce((acc, run) => acc + run.fixtures.length, 0);

  const finishBuckets: Record<string, { total: number; matched: number; mismatched: number; failures: number }> = {};
  for (const example of exampleOutcomes) {
    const key = example.finish;
    if (!finishBuckets[key]) finishBuckets[key] = { total: 0, matched: 0, mismatched: 0, failures: 0 };
    finishBuckets[key].total += 1;
    if (example.ourPrediction.matchedKnownOutcome === true) finishBuckets[key].matched += 1;
    if (example.ourPrediction.matchedKnownOutcome === false) finishBuckets[key].mismatched += 1;
    if (example.failureMode) finishBuckets[key].failures += 1;
  }

  const gameBuckets: Record<string, { total: number; matched: number }> = {};
  for (const example of exampleOutcomes) {
    if (!gameBuckets[example.game]) gameBuckets[example.game] = { total: 0, matched: 0 };
    gameBuckets[example.game].total += 1;
    if (example.ourPrediction.matchedKnownOutcome === true) gameBuckets[example.game].matched += 1;
  }

  const trainingDatasets = datasetsByTier("training_open");
  const certifiedRefs = datasetsByTier("certified_reference");
  const metadataApis = datasetsByTier("metadata_api");
  const gold = datasetsByTier("user_consented_gold");

  return (
    <main className="benchmarks-shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <span className="page-kicker">Benchmark transparency</span>
          <h1>What our model has actually been tested on.</h1>
          <p className="muted" style={{ maxWidth: 740, margin: "8px 0 0" }}>
            Per-finish, per-game performance against {exampleOutcomes.length} outcome examples. Skill-harness
            pass rates from the live registry. Dataset provenance and licensing. Honest about what we
            don&apos;t cover yet.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="button secondary" href="/examples">Outcome library</Link>
          <Link className="button secondary" href="/benchmarks/certified-references">Certified refs</Link>
          <Link className="button secondary" href="/methods">Verified methods</Link>
          <Link className="button secondary" href="/skills?tab=traces">Skill traces</Link>
        </div>
      </header>

      <section className="benchmarks-summary">
        <article>
          <span>Skill harness runs</span>
          <strong>{passed}/{total}</strong>
          <em>passed</em>
        </article>
        <article>
          <span>Fixture pass-rate</span>
          <strong>{totalFixturePasses}/{totalFixtureRuns}</strong>
          <em>{totalFixtureRuns ? Math.round((totalFixturePasses / totalFixtureRuns) * 100) : 0}%</em>
        </article>
        <article>
          <span>Outcome examples</span>
          <strong>{exampleOutcomes.length}</strong>
          <em>
            {exampleOutcomes.filter((entry) => entry.ourPrediction.matchedKnownOutcome === true).length} matched ·{" "}
            {exampleOutcomes.filter((entry) => entry.failureMode).length} failure cases
          </em>
        </article>
        <article>
          <span>Training datasets</span>
          <strong>{trainingDatasets.length}</strong>
          <em>open · CC BY 4.0</em>
        </article>
      </section>

      {yolo ? (
        <section className={`benchmarks-section ${yolo.is_stub ? "benchmarks-section--stub" : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
            <h2>Per-class detection metrics (YOLO)</h2>
            <small style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
              Report <code>{yolo.report_id}</code> · {new Date(yolo.generated_at).toLocaleString()} · imgsz=
              {yolo.imgsz} · conf={yolo.conf} · IoU={yolo.iou}
              {yolo.device ? ` · device=${yolo.device}` : ""}
            </small>
          </div>
          {yolo.is_stub ? (
            <p className="benchmarks-stub-note">
              ⚠ This report is a hand-authored seed, NOT a real eval. Run{" "}
              <code>python ml/scripts/eval_yolo_per_class.py</code> to overwrite with measured numbers.
              {yolo.reason ? ` Reason: ${yolo.reason}` : null}
            </p>
          ) : null}
          <div className="benchmarks-summary">
            <article>
              <span>Overall precision</span>
              <strong>{formatMetric(yolo.summary.precision)}</strong>
              <em>{formatPct(yolo.summary.precision)}</em>
            </article>
            <article>
              <span>Overall recall</span>
              <strong>{formatMetric(yolo.summary.recall)}</strong>
              <em>{formatPct(yolo.summary.recall)}</em>
            </article>
            <article>
              <span>mAP@50</span>
              <strong>{formatMetric(yolo.summary.mAP_50)}</strong>
              <em>{formatPct(yolo.summary.mAP_50)}</em>
            </article>
            <article>
              <span>mAP@50–95</span>
              <strong>{formatMetric(yolo.summary.mAP_50_95)}</strong>
              <em>{formatPct(yolo.summary.mAP_50_95)}</em>
            </article>
          </div>
          {yolo.per_class.length > 0 ? (
            <>
              <h3>Per-class</h3>
              <table className="benchmarks-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>mAP@50</th>
                    <th>mAP@50–95</th>
                  </tr>
                </thead>
                <tbody>
                  {yolo.per_class.map((row) => (
                    <tr key={row.class}>
                      <td>
                        <code>{row.class}</code>
                      </td>
                      <td>{formatMetric(row.precision)}</td>
                      <td>{formatMetric(row.recall)}</td>
                      <td>{formatMetric(row.mAP_50)}</td>
                      <td>{formatMetric(row.mAP_50_95)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {yolo.per_region.length > 0 ? (
            <>
              <h3>Per-region</h3>
              <table className="benchmarks-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>mAP@50</th>
                  </tr>
                </thead>
                <tbody>
                  {yolo.per_region.map((row) => (
                    <tr key={row.region}>
                      <td>{row.region.replaceAll("_", " ")}</td>
                      <td>{formatMetric(row.precision)}</td>
                      <td>{formatMetric(row.recall)}</td>
                      <td>{formatMetric(row.mAP_50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {yolo.limitations && yolo.limitations.length > 0 ? (
            <ul className="benchmarks-gaps" style={{ marginTop: 12 }}>
              {yolo.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="benchmarks-section">
        <h2>Per-finish performance</h2>
        <table className="benchmarks-table">
          <thead>
            <tr><th>Finish</th><th>Examples</th><th>Matched</th><th>Mismatched</th><th>Failure cases</th></tr>
          </thead>
          <tbody>
            {Object.entries(finishBuckets).sort(([, a], [, b]) => b.total - a.total).map(([finish, bucket]) => (
              <tr key={finish}>
                <td>{finish.replaceAll("_", " ")}</td>
                <td>{bucket.total}</td>
                <td className="ok">{bucket.matched}</td>
                <td className="warn">{bucket.mismatched}</td>
                <td>{bucket.failures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="benchmarks-section">
        <h2>Per-game coverage</h2>
        <table className="benchmarks-table">
          <thead>
            <tr><th>Game</th><th>Examples</th><th>Matched outcome</th></tr>
          </thead>
          <tbody>
            {Object.entries(gameBuckets).sort(([, a], [, b]) => b.total - a.total).map(([game, bucket]) => (
              <tr key={game}><td>{game.replace("-", " ")}</td><td>{bucket.total}</td><td>{bucket.matched}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="benchmarks-section">
        <h2>Recent skill harness runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs yet. Trigger one on /skills.</p>
        ) : (
          <table className="benchmarks-table">
            <thead>
              <tr><th>Skill</th><th>Result</th><th>Fixtures</th><th>Latency</th><th>Grade hits</th><th>Privacy hits</th></tr>
            </thead>
            <tbody>
              {runs.slice(0, 12).map((run) => (
                <tr className={run.summary.passed ? "ok-row" : "warn-row"} key={run.benchmarkId}>
                  <td><code>{run.skillId}</code></td>
                  <td>{run.summary.passed ? "✓ passed" : "✗ failed"}</td>
                  <td>{run.fixtures.filter((f) => f.passed).length}/{run.fixtures.length}</td>
                  <td>{run.summary.latencyAddedMs}ms</td>
                  <td>{run.summary.officialGradeClaims}</td>
                  <td>{run.summary.privacyViolations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="benchmarks-section">
        <h2>Our condition ladder</h2>
        <p className="muted">
          Internal benchmark band — not a TAG Score, not a PSA grade. Calibrated against the {exampleOutcomes.length}{" "}
          examples in the Outcome Library.
        </p>
        <table className="benchmarks-table">
          <thead><tr><th>Range</th><th>Label</th><th>Plain English</th></tr></thead>
          <tbody>
            {conditionLadder.map((entry) => (
              <tr key={entry.band}><td>{entry.range}</td><td>{entry.label}</td><td className="muted">{entry.gist}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="benchmarks-section">
        <h2>Dataset provenance</h2>

        <h3>Open training data (CC BY 4.0)</h3>
        <ul className="benchmarks-dataset-list">
          {trainingDatasets.map((dataset) => (
            <li key={dataset.id}>
              <strong>{dataset.title}</strong>
              <span>{dataset.organization}</span>
              <em>{dataset.imageCount ? `${dataset.imageCount.toLocaleString()} images · ` : ""}{dataset.license}</em>
              <a href={dataset.url} rel="noopener noreferrer" target="_blank">source ↗</a>
              <small>{dataset.notes}</small>
            </li>
          ))}
        </ul>

        <h3>Certified references (deep-link only — no scraping, no caching)</h3>
        <ul className="benchmarks-dataset-list">
          {certifiedRefs.map((dataset) => (
            <li key={dataset.id}>
              <strong>{dataset.title}</strong>
              <span>{dataset.organization}</span>
              <em>{dataset.license}</em>
              <a href={dataset.url} rel="noopener noreferrer" target="_blank">lookup ↗</a>
              <small>{dataset.notes}</small>
            </li>
          ))}
        </ul>

        <h3>Metadata APIs (card identity, not condition)</h3>
        <ul className="benchmarks-dataset-list">
          {metadataApis.map((dataset) => (
            <li key={dataset.id}>
              <strong>{dataset.title}</strong>
              <span>{dataset.organization}</span>
              <em>{dataset.license}</em>
              <a href={dataset.url} rel="noopener noreferrer" target="_blank">docs ↗</a>
              <small>{dataset.notes}</small>
            </li>
          ))}
        </ul>

        <h3>Gold tier — built through user consent</h3>
        <ul className="benchmarks-dataset-list">
          {gold.map((dataset) => (
            <li key={dataset.id}>
              <strong>{dataset.title}</strong>
              <span>{dataset.organization}</span>
              <em>{dataset.license}</em>
              <small>{dataset.notes}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="benchmarks-section">
        <h2>What we don&apos;t cover yet</h2>
        <ul className="benchmarks-gaps">
          <li>Etched-foil and textured-manga finishes — currently misclassified as surface noise. Need user-consented gold examples.</li>
          <li>Dark-border edge whitening — naive detector over-calls; <code>dark_border_edge_filter_v1</code> in benchmarking.</li>
          <li>Authenticity / counterfeit detection — explicitly out of scope.</li>
          <li>Market value — explicitly out of scope.</li>
          <li>Sub-grade calibration (BGS-style centering / corners / edges / surface) — modeled visually but not numerically calibrated yet.</li>
          <li>Backside scans — most public datasets are front-only.</li>
        </ul>
      </section>
    </main>
  );
}
