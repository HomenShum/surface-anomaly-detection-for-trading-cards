"use client";

import Link from "next/link";
import { useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { TrustBadge } from "./TrustBadge";
import { ExampleImage } from "./ExampleImage";
import { GraderComparison } from "./GraderComparison";
import {
  bandLabel,
  bandRange,
  conditionLadder,
  exampleDisclaimer,
  exampleRights,
  type ExampleOutcome,
} from "../lib/examples/registry";
import type { CertEvalRowResult } from "../lib/cert-references-eval";

type Props = {
  example: ExampleOutcome;
  /** Cert-eval row for this example, when one exists (Silver+/Silver entries with a cert reference id derivable from `ex_<provider>_<cert>`). */
  certEvalRow?: CertEvalRowResult | null;
  /** Model version that produced the cert-eval row, for transparency. */
  certEvalModelVersion?: string | null;
};

export function ExampleDetailClient({ example, certEvalRow, certEvalModelVersion }: Props) {
  const [showDings, setShowDings] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [showOnlyMaterial, setShowOnlyMaterial] = useState(false);

  const visibleDings = showOnlyMaterial
    ? example.dings.filter((ding) => ding.materialToGrade)
    : example.dings;
  const rights = exampleRights(example);
  const hasLocalPrediction =
    example.ourPrediction.confidence > 0 ||
    example.ourPrediction.benchmarkScore > 0 ||
    example.ourPrediction.matchedKnownOutcome !== null;

  const matched = example.ourPrediction.matchedKnownOutcome;
  const matchCopy =
    matched === true
      ? "Our band matches the official outcome. We support this outcome with our visible-DING evidence."
      : matched === false
        ? "Our band does not match the official outcome. This is a honest mismatch — see the limitations panel."
        : example.knownOutcome
          ? "Official outcome attached as an external certified reference. No local prediction has been run for this row yet."
          : "No official outcome attached. Annotation provenance: dataset author or human reviewer.";

  return (
    <main className="examples-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Detail nav">
          <Link href="/examples">All examples</Link>
          <Link href="/methods">Verified methods</Link>
          <Link href="/benchmarks">Benchmarks</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="example-hero">
        <div className="example-image-stage">
          <TrustBadge tier={example.tier} reason={example.trustBadgeReason} />
          <div className="example-image-frame">
            <ExampleImage
              alt={example.title}
              externalReferenceLabel={example.provenance.externalReferenceLabel}
              externalReferenceUrl={example.provenance.externalReferenceUrl}
              fallbackHint="Identity image is deep-link only."
              fallbackLabel={example.game.replace("-", " ").toUpperCase()}
              opacity={opacity}
              src={example.provenance.identityImageUrl}
              verbose
            />
            {showDings
              ? visibleDings.map((ding, idx) => {
                  const [x1, y1, x2, y2] = ding.bbox;
                  // Anchor the label so it stays inside the image frame on
                  // narrow viewports: flip horizontally when the bbox is in
                  // the right half, and drop the label below when the bbox
                  // touches the top edge.
                  const anchorRight = x1 > 55;
                  const anchorBelow = y1 < 12;
                  const labelClass =
                    `example-ding-label ${anchorRight ? "example-ding-label--right" : "example-ding-label--left"} ${
                      anchorBelow ? "example-ding-label--below" : "example-ding-label--above"
                    }`;
                  return (
                    <div
                      className={`example-ding example-ding--${ding.severity} ${
                        ding.materialToGrade ? "" : "example-ding--cosmetic"
                      }`}
                      key={`${example.id}-ding-${idx}`}
                      style={{
                        left: `${x1}%`,
                        top: `${y1}%`,
                        width: `${Math.max(2, x2 - x1)}%`,
                        height: `${Math.max(2, y2 - y1)}%`,
                      }}
                    >
                      <span className={labelClass}>
                        {ding.materialToGrade ? "DING" : "cosmetic"} · {ding.type.replaceAll("_", " ")} · {ding.severity}
                      </span>
                    </div>
                  );
                })
              : null}
          </div>
          <div className="example-image-controls">
            <label>
              <input checked={showDings} onChange={(event) => setShowDings(event.target.checked)} type="checkbox" />
              <span>DING overlays</span>
            </label>
            <label>
              <input
                checked={showOnlyMaterial}
                disabled={!showDings}
                onChange={(event) => setShowOnlyMaterial(event.target.checked)}
                type="checkbox"
              />
              <span>Material-to-grade only</span>
            </label>
            <label className="example-image-slider">
              <span>Image opacity</span>
              <input
                max={1}
                min={0.2}
                onChange={(event) => setOpacity(Number(event.target.value))}
                step={0.05}
                type="range"
                value={opacity}
              />
            </label>
          </div>
        </div>
        <aside className="example-summary">
          <span className="page-kicker">Verified outcome</span>
          <h1>{example.title}</h1>
          <p className="muted">{example.trustBadgeReason}</p>
          <dl className="example-summary-grid">
            {example.knownOutcome ? (
              <>
                <div>
                  <dt>Official outcome</dt>
                  <dd>
                    <strong>{example.knownOutcome.grader}</strong> · {example.knownOutcome.grade}
                  </dd>
                </div>
                <div>
                  <dt>Cert</dt>
                  <dd>
                    {example.knownOutcome.certUrl ? (
                      <a href={example.knownOutcome.certUrl} rel="noopener noreferrer" target="_blank">
                        {example.knownOutcome.certNumber} ↗
                      </a>
                    ) : (
                      example.knownOutcome.certNumber ?? "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Official band</dt>
                  <dd>
                    {bandRange(example.knownOutcome.band)} · {bandLabel(example.knownOutcome.band)}
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Official outcome</dt>
                <dd className="muted">None attached — annotation provenance only.</dd>
              </div>
            )}
            <div>
              <dt>Our score</dt>
              <dd>
                {hasLocalPrediction ? (
                  <>
                    <strong>{example.ourPrediction.benchmarkScore}</strong> · {bandLabel(example.ourPrediction.band)}
                  </>
                ) : (
                  <span className="muted">N/A — reference only</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{hasLocalPrediction ? `${Math.round(example.ourPrediction.confidence * 100)}%` : "N/A"}</dd>
            </div>
            <div>
              <dt>Match</dt>
              <dd className={`example-match-${matched === true ? "ok" : matched === false ? "mismatch" : "neutral"}`}>
                {matched === true ? "matched" : matched === false ? "mismatched" : example.knownOutcome ? "reference only" : "no official outcome"}
              </dd>
            </div>
          </dl>
          <p className="example-disclaimer">{exampleDisclaimer}</p>
        </aside>
      </section>

      {(example.tier === "silver_plus" || example.tier === "silver") ? (
        <section className="gold-upgrade-cta">
          <div>
            <span className="page-kicker">Upgrade to Gold</span>
            <h2>Have raw pre-grading photos?</h2>
            <p>
              This entry is a Silver+ certified reference. To promote it to a Gold benchmark record we need:
            </p>
            <ul>
              <li>Front + back photos taken BEFORE PSA encapsulation (raw card, not slab).</li>
              <li>Optional tilt or angle frames for holo / textured / etched finishes.</li>
              <li>The cert number you already see above (already filled in).</li>
              <li>Explicit consent toggle on the submission form (private vs. shared training).</li>
            </ul>
            <p className="muted">
              Gold records ground the model against a real pre/post-grade comparison and are the only tier
              eligible to feed shared-training stats. Privacy contract enforced at submission.
            </p>
          </div>
          <div className="gold-upgrade-actions">
            <Link className="primary-button" href={`/scan?mode=upload&cert=${example.knownOutcome?.certNumber ?? ""}&grader=${example.knownOutcome?.grader ?? ""}`}>
              Upload pre-grading scans
            </Link>
            {example.knownOutcome?.certUrl ? (
              <a className="button secondary" href={example.knownOutcome.certUrl} rel="noreferrer" target="_blank">
                Verify cert ({example.knownOutcome.grader} {example.knownOutcome.certNumber})
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="example-detail-grid">
        {certEvalRow ? (
          <article className="example-detail-card cert-eval-detail-card">
            <h2>Cert-reference eval</h2>
            <p className="muted">
              Predicted band vs official outcome from the offline cert-reference comparator. Run via
              <code> pnpm eval:certrefs:bands</code>. Model: <code>{certEvalModelVersion ?? "unknown"}</code>.
            </p>
            {certEvalRow.predictedSubGrades ? (
              <div className="sub-grades-grid">
                {(["centering", "corners", "edges", "surface"] as const).map((key) => {
                  const value = certEvalRow.predictedSubGrades?.[key];
                  if (!value) return null;
                  const officialSub = example.knownOutcome?.subGrades?.[key];
                  return (
                    <div className={`sub-grade-tile sub-grade-tile--${value.score === null ? "empty" : "ok"}`} key={key}>
                      <span className="sub-grade-key">{key}</span>
                      <strong className="sub-grade-score">
                        {value.score === null ? "—" : value.score.toFixed(1)}
                      </strong>
                      <small className="sub-grade-conf">
                        {value.findingCount > 0
                          ? `${value.findingCount} finding${value.findingCount === 1 ? "" : "s"}`
                          : value.contributors.length > 0
                            ? value.contributors.join(", ")
                            : "no signal"}
                      </small>
                      {officialSub !== undefined ? (
                        <small className="sub-grade-official">
                          official: {typeof officialSub === "number" ? officialSub.toFixed(1) : officialSub}
                        </small>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <dl className="detail-list">
              <div>
                <dt>Official band</dt>
                <dd>
                  <code>{certEvalRow.officialBand ?? "no band map"}</code>
                </dd>
              </div>
              <div>
                <dt>Predicted band</dt>
                <dd>
                  <code>{certEvalRow.predictedBand ?? "skipped — no slab image yet"}</code>
                </dd>
              </div>
              <div>
                <dt>Agreement</dt>
                <dd>
                  <span className={`cert-eval-agreement cert-eval-agreement--${
                    certEvalRow.bandAgreement === "match"
                      ? "match"
                      : certEvalRow.bandAgreement === "adjacent"
                        ? "adjacent"
                        : certEvalRow.bandAgreement === "mismatch"
                          ? "mismatch"
                          : "neutral"
                  }`}>{certEvalRow.bandAgreement.replace("_", " ")}</span>
                </dd>
              </div>
              {certEvalRow.bandDistance !== null ? (
                <div>
                  <dt>Δ band</dt>
                  <dd>{certEvalRow.bandDistance}</dd>
                </div>
              ) : null}
              {certEvalRow.predictedScore !== null ? (
                <div>
                  <dt>Predicted score</dt>
                  <dd>{certEvalRow.predictedScore}</dd>
                </div>
              ) : null}
              {certEvalRow.confidence !== null ? (
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(certEvalRow.confidence * 100)}%</dd>
                </div>
              ) : null}
            </dl>
            {certEvalRow.notes && certEvalRow.notes.length > 0 ? (
              <ul className="muted">
                {certEvalRow.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
        <GraderComparison example={example} />
        <article className="example-detail-card">
          <h2>Why this band, not higher?</h2>
          {example.whyThisGradeNotHigher && example.whyThisGradeNotHigher.length > 0 ? (
            <ul>
              {example.whyThisGradeNotHigher.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No specific blockers — clean card or band ceiling reached.</p>
          )}
          <p className="muted">{matchCopy}</p>
        </article>

        <article className="example-detail-card">
          <h2>DINGs ({example.dings.length})</h2>
          {example.dings.length === 0 ? (
            <p className="muted">No DING annotations — clean record.</p>
          ) : (
            <ul className="example-ding-list">
              {example.dings.map((ding, idx) => (
                <li
                  className={ding.materialToGrade ? "material" : "cosmetic"}
                  key={`${example.id}-list-${idx}`}
                >
                  <strong>{ding.type.replaceAll("_", " ")}</strong>
                  <em>
                    {ding.materialToGrade ? "Material to grade" : "Cosmetic only"} · {ding.severity}
                  </em>
                  <span>{ding.note}</span>
                  <small>annotation: {ding.source}</small>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="example-detail-card">
          <h2>Capture quality + limitations</h2>
          <ul>
            <li>
              Identity image source: <code>{example.provenance.identityImageSource}</code>
            </li>
            <li>{example.provenance.identityImageAttribution}</li>
            {example.failureMode ? (
              <li>
                <strong>Failure mode:</strong> {example.failureMode.replaceAll("_", " ")}
                {example.failureNote ? ` — ${example.failureNote}` : ""}
              </li>
            ) : null}
            <li>Our scan ≠ TAG photometric stereoscopic imaging. Confidence depends on user capture.</li>
            <li>Our scan is not TAG photometric stereoscopic imaging. Confidence depends on user capture.</li>
            <li>Premium reflective cards (holo / textured / etched foil) need guided tilt scans.</li>
          </ul>
        </article>

        <article className="example-detail-card">
          <h2>Source rights</h2>
          <dl className="detail-list">
            <div>
              <dt>Official grade attached</dt>
              <dd>{rights.hasOfficialGrade ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>DING labels</dt>
              <dd>{rights.hasDingLabels ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Training use</dt>
              <dd>{rights.useForTraining ? "allowed by source tier" : "not training data"}</dd>
            </div>
            <div>
              <dt>Image cached</dt>
              <dd>{rights.storeImagesLocally ? "yes" : "no"}</dd>
            </div>
          </dl>
          <p className="muted">{rights.usageRights}</p>
        </article>

        <article className="example-detail-card">
          <h2>Provenance</h2>
          <dl className="detail-list">
            <div>
              <dt>Trust tier</dt>
              <dd>
                <TrustBadge tier={example.tier} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Game</dt>
              <dd>{example.game.replace("-", " ")}</dd>
            </div>
            <div>
              <dt>Finish</dt>
              <dd>{example.finish}</dd>
            </div>
            {example.setName ? (
              <div>
                <dt>Set</dt>
                <dd>{example.setName}</dd>
              </div>
            ) : null}
            {example.cardNumber ? (
              <div>
                <dt>Number</dt>
                <dd>{example.cardNumber}</dd>
              </div>
            ) : null}
            {example.provenance.externalReferenceUrl ? (
              <div>
                <dt>External reference</dt>
                <dd>
                  <a href={example.provenance.externalReferenceUrl} rel="noopener noreferrer" target="_blank">
                    {example.provenance.externalReferenceLabel ?? "Source"} ↗
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="example-detail-card">
          <h2>Condition ladder</h2>
          <ul className="example-ladder">
            {conditionLadder.map((entry) => (
              <li
                className={entry.band === example.ourPrediction.band ? "is-active" : ""}
                key={entry.band}
              >
                <strong>{entry.range}</strong>
                <span>{entry.label}</span>
                <em>{entry.gist}</em>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
