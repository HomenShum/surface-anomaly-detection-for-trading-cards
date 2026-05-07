import { loadLatestCertEvalReport, type CertEvalRowResult } from "../lib/cert-references-eval";

type Props = {
  // Pass-through for testability. Defaults to loadLatestCertEvalReport("latest").
  reportLabel?: string;
};

const AGREEMENT_COPY: Record<CertEvalRowResult["bandAgreement"], { label: string; tone: "match" | "adjacent" | "mismatch" | "neutral" }> = {
  match: { label: "match", tone: "match" },
  adjacent: { label: "adjacent", tone: "adjacent" },
  mismatch: { label: "mismatch", tone: "mismatch" },
  no_official_band: { label: "no band map", tone: "neutral" },
};

export function CertEvalScoreboard({ reportLabel = "latest" }: Props) {
  const report = loadLatestCertEvalReport(reportLabel);

  if (!report) {
    return (
      <section className="cert-eval-scoreboard cert-eval-scoreboard--empty">
        <header>
          <span className="page-kicker">Cert-reference eval</span>
          <h2>No band-agreement report yet</h2>
        </header>
        <p className="muted">
          Run the offline pipeline to compare predicted bands against PSA/TAG official outcomes:
        </p>
        <ol className="cert-eval-steps">
          <li>
            Drop slab photos into <code>data/cert-references/slab-images/&lt;cert_id&gt;/</code> (e.g. <code>psa_154378339/front.jpg</code>).
          </li>
          <li>
            Start the inference API: <code>pnpm dev:api</code>.
          </li>
          <li>
            Run inference + write predictions: <code>pnpm eval:certrefs:run</code>.
          </li>
          <li>
            Score band agreement: <code>pnpm eval:certrefs:bands</code>.
          </li>
          <li>
            (Once you trust the result) snapshot baseline: <code>pnpm eval:certrefs:snapshot</code>.
          </li>
        </ol>
      </section>
    );
  }

  const matchRate =
    report.totals.predictionsCovered > 0
      ? report.totals.matched / report.totals.predictionsCovered
      : 0;
  const silverPlusMatchRate =
    report.totals.silverPlusCovered > 0
      ? report.totals.silverPlusMatched / report.totals.silverPlusCovered
      : 0;

  const predictedRows = report.rows.filter((row) => row.predictedBand);
  const allPredictionsZeroConfidence =
    predictedRows.length > 0 && predictedRows.every((row) => row.confidence === 0);
  const isMirrorBaseline =
    report.modelVersion === "baseline-trust-cert" ||
    report.modelVersion === "test-baseline-mirror" ||
    allPredictionsZeroConfidence;

  return (
    <section className="cert-eval-scoreboard">
      <header>
        <span className="page-kicker">Cert-reference eval</span>
        <h2>Band agreement vs official outcomes</h2>
        <p className="muted">
          Model: <code>{report.modelVersion}</code> · Generated: <time>{new Date(report.evaluatedAt).toLocaleString()}</time>
          {isMirrorBaseline ? <span className="cert-eval-warning"> · placeholder mirror — not a real model run yet</span> : null}
        </p>
      </header>

      {isMirrorBaseline ? (
        <div className="cert-eval-totals">
          <div>
            <span>Status</span>
            <strong>Placeholder mirror</strong>
            <small>not real model proof</small>
          </div>
          <div>
            <span>Active predictions</span>
            <strong>{report.totals.predictionsCovered}</strong>
            <small>zero-confidence mirrored rows</small>
          </div>
          <div>
            <span>Production gate</span>
            <strong>Blocked</strong>
            <small>run real slab/raw inference</small>
          </div>
          <div>
            <span>References</span>
            <strong>{report.totals.references}</strong>
            <small>{report.totals.skipped} skipped</small>
          </div>
        </div>
      ) : (
      <div className="cert-eval-totals">
        <div>
          <span>Match rate</span>
          <strong>{(matchRate * 100).toFixed(0)}%</strong>
          <small>
            {report.totals.matched}/{report.totals.predictionsCovered} predictions
          </small>
        </div>
        <div>
          <span>Silver+ match rate</span>
          <strong>{(silverPlusMatchRate * 100).toFixed(0)}%</strong>
          <small>
            {report.totals.silverPlusMatched}/{report.totals.silverPlusCovered} silver_plus
          </small>
        </div>
        <div>
          <span>Adjacent / mismatch</span>
          <strong>
            {report.totals.adjacent} / {report.totals.mismatched}
          </strong>
          <small>{report.totals.skipped} skipped</small>
        </div>
        <div>
          <span>References</span>
          <strong>{report.totals.references}</strong>
          <small>{report.totals.predictionsCovered} predicted</small>
        </div>
      </div>
      )}

      {report.rows.length > 0 ? (
        <div className="cert-eval-table-wrap">
          <table className="benchmarks-table cert-eval-table">
            <thead>
              <tr>
                <th>Cert</th>
                <th>Tier</th>
                <th>Official band</th>
                <th>Predicted band</th>
                <th>Agreement</th>
                <th>Δ band</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const agreement = AGREEMENT_COPY[row.bandAgreement];
                return (
                  <tr key={row.certId}>
                    <td>
                      <code>{row.certId}</code>
                      <small>
                        {row.provider} · {row.certNumber}
                      </small>
                    </td>
                    <td>
                      <span className={`cert-tier cert-tier--${row.trustTier}`}>{row.trustTier.replace("_", "+")}</span>
                    </td>
                    <td>
                      <code>{row.officialBand ?? "—"}</code>
                      <small>{row.officialGrade ?? "no grade label"}</small>
                    </td>
                    <td>
                      <code>{row.predictedBand ?? "skipped"}</code>
                      <small>{row.predictedScore !== null ? `score ${row.predictedScore}` : "no prediction yet"}</small>
                    </td>
                    <td>
                      <span className={`cert-eval-agreement cert-eval-agreement--${agreement.tone}`}>
                        {agreement.label}
                      </span>
                    </td>
                    <td>{row.bandDistance ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <footer className="cert-eval-footer">
        <p className="muted">
          Promotion gate: candidate must score against real, replayable inference rows and not regress on Silver+ entries. Honest contract: we
          compare INTERNAL CONDITION BANDS, never claim to predict the exact PSA/TAG grade. Placeholder mirrors are blocked.
        </p>
      </footer>
    </section>
  );
}
