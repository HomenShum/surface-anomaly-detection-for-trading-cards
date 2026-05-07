"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { OutcomeExampleCard } from "./OutcomeExampleCard";
import { outcomeBySlug, outcomeExamples, provenanceLabel } from "../lib/outcome-examples";

type OverlayMode = "dings" | "materiality" | "none";

function scoreLabel(score: number) {
  if (score >= 90) return "high";
  if (score >= 75) return "medium";
  if (score >= 60) return "warning";
  return "low";
}

export function OutcomeDetailClient() {
  const params = useParams<{ id: string }>();
  const example = outcomeBySlug(params.id);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("dings");
  const [selectedDingId, setSelectedDingId] = useState<string | null>(null);
  const [cardVisionOpacity, setCardVisionOpacity] = useState(42);
  const selectedDing = example?.dings.find((ding) => ding.id === selectedDingId) ?? example?.dings[0];

  const related = useMemo(
    () => outcomeExamples.filter((entry) => entry.id !== example?.id).slice(0, 3),
    [example?.id],
  );
  const canInspectImage = Boolean(example?.image);

  function dingOverlayLabel(ding: NonNullable<typeof example>["dings"][number]) {
    const type = ding.type.replaceAll("_", " ");
    const confidence = `${Math.round(ding.confidence * 100)}%`;
    const qualifier = overlayMode === "materiality" ? ding.materiality.replaceAll("_", " ") : ding.location;
    return `${type} ${confidence} - ${qualifier}`;
  }

  if (!example) {
    return (
      <main className="outcome-shell">
        <section className="methods-section">
          <h1>Example not found</h1>
          <Link className="button" href="/examples">Back to examples</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="outcome-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Outcome detail nav">
          <Link href="/examples">Examples</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/workspace">Workspace</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="outcome-detail-hero">
        <div>
          <span className={`outcome-result outcome-result--${example.result}`}>{example.result.replaceAll("_", " ")}</span>
          <h1>{example.title}</h1>
          <p className="muted">{example.summary}</p>
          <div className="outcome-proof-strip">
            <div><span>Known outcome</span><strong>{example.knownOutcome}</strong></div>
            <div><span>Our benchmark band</span><strong>{example.modelBand}</strong></div>
            <div><span>Confidence</span><strong>{example.modelConfidence > 0 ? `${example.modelConfidence}%` : "not analyzed"}</strong></div>
            <div><span>Provenance</span><strong>{provenanceLabel(example.provenance)}</strong></div>
          </div>
          {example.externalUrl ? (
            <div className="outcome-external-actions">
              <a className="button secondary" href={example.externalUrl} rel="noreferrer" target="_blank">
                Open {example.grader} cert
              </a>
              <span>External reference only. Images are not cached by CCV.</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="outcome-detail-grid">
        <div className="outcome-inspector">
          <div className="outcome-inspector-toolbar">
            <div className="segmented-controls">
              {(["dings", "materiality", "none"] as OverlayMode[]).map((mode) => (
                <button
                  className={overlayMode === mode ? "is-active" : ""}
                  disabled={!canInspectImage || example.dings.length === 0}
                  key={mode}
                  onClick={() => setOverlayMode(mode)}
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>
            <label>
              vision opacity
              <input
                max="85"
                min="0"
                onChange={(event) => setCardVisionOpacity(Number(event.target.value))}
                type="range"
                value={cardVisionOpacity}
              />
            </label>
          </div>
          <div className="outcome-image-stage">
            {example.image ? (
              <>
                <img alt={example.title} src={example.image} />
                <div className="outcome-card-vision" style={{ opacity: cardVisionOpacity / 100 }} />
              </>
            ) : (
              <div className="outcome-cert-placeholder outcome-cert-placeholder--large">
                <span>{example.grader ?? "Certified reference"}</span>
                <strong>{example.certNumber}</strong>
                <em>{example.officialGrade ?? example.knownOutcome}</em>
                <p>No external cert image is cached locally.</p>
              </div>
            )}
            {canInspectImage && overlayMode !== "none"
              ? example.dings.map((ding) => {
                  const label = dingOverlayLabel(ding);
                  return (
                  <button
                    aria-label={label}
                    className={`outcome-ding-box outcome-ding-box--${ding.materiality} ${selectedDing?.id === ding.id ? "is-selected" : ""}`}
                    data-label-placement={ding.bbox[1] < 12 ? "below" : "above"}
                    key={ding.id}
                    onClick={() => setSelectedDingId(ding.id)}
                    style={{
                      left: `${ding.bbox[0]}%`,
                      top: `${ding.bbox[1]}%`,
                      width: `${ding.bbox[2] - ding.bbox[0]}%`,
                      height: `${ding.bbox[3] - ding.bbox[1]}%`,
                    }}
                    type="button"
                  >
                    <span>{label}</span>
                  </button>
                  );
                })
              : null}
          </div>
          <p className="muted outcome-inspector-note">
            This is a transparency-style inspection preview for trust onboarding. External certified references are
            linked as outcome metadata only. It is not TAG Card Vision and is not an official grading replacement.
          </p>
        </div>

        <aside className="outcome-detail-side">
          <article className="outcome-panel">
            <span className="page-kicker">Selected DING</span>
            {selectedDing ? (
              <>
                <h2>{selectedDing.type.replaceAll("_", " ")}</h2>
                <p>{selectedDing.note}</p>
                <dl>
                  <div><dt>Attribute</dt><dd>{selectedDing.attribute}</dd></div>
                  <div><dt>Location</dt><dd>{selectedDing.location}</dd></div>
                  <div><dt>Confidence</dt><dd>{Math.round(selectedDing.confidence * 100)}%</dd></div>
                  <div><dt>Materiality</dt><dd>{selectedDing.materiality.replaceAll("_", " ")}</dd></div>
                </dl>
              </>
            ) : (
              <p>No DING selected.</p>
            )}
          </article>

          <article className="outcome-panel">
            <span className="page-kicker">Attributes</span>
            {Object.entries(example.attributes).map(([name, value]) => (
              <div className="attribute-row" key={name}>
                <span>{name}</span>
                <strong>{value > 0 ? value : "not scored"}</strong>
                <em className={value > 0 ? `score-${scoreLabel(value)}` : "score-low"}>
                  {value > 0 ? scoreLabel(value) : "external"}
                </em>
              </div>
            ))}
          </article>

          <article className="outcome-panel">
            <span className="page-kicker">Source rights</span>
            <dl>
              <div><dt>Official grade attached</dt><dd>{example.hasOfficialGrade ? "yes" : "no"}</dd></div>
              <div><dt>DING labels</dt><dd>{example.hasDingLabels ? "yes" : "no"}</dd></div>
              <div><dt>Training use</dt><dd>{example.useForTraining ? "allowed by source tier" : "not training data"}</dd></div>
              <div><dt>Image cached</dt><dd>{example.storeImagesLocally ? "yes" : "no"}</dd></div>
              {example.certNumber ? <div><dt>Cert</dt><dd>{example.grader} {example.certNumber}</dd></div> : null}
            </dl>
            <p>{example.usageRights}</p>
          </article>

          <article className="outcome-panel">
            <span className="page-kicker">Capture quality</span>
            <dl>
              <div><dt>Blur</dt><dd>{example.captureQuality.blur}</dd></div>
              <div><dt>Glare</dt><dd>{example.captureQuality.glare}</dd></div>
              <div><dt>Edges</dt><dd>{example.captureQuality.edgeVisibility}</dd></div>
            </dl>
            <p>{example.captureQuality.recommendation}</p>
          </article>
        </aside>
      </section>

      <section className="outcome-explain-grid">
        <article className="outcome-panel">
          <h2>What the model got right</h2>
          <ul>{example.whatItGotRight.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="outcome-panel">
          <h2>What remains uncertain</h2>
          <ul>{example.whatItMissed.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="outcome-panel">
          <h2>Limitations</h2>
          <ul>{example.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
      </section>

      <section className="methods-section">
        <div className="section-header">
          <div>
            <span className="page-kicker">More examples</span>
            <h2>Inspect more outcomes</h2>
          </div>
        </div>
        <div className="outcome-grid outcome-grid--compact">
          {related.map((entry) => (
            <OutcomeExampleCard compact example={entry} key={entry.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
