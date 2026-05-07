"use client";

import { useState } from "react";
import type { ConditionBand, ExampleDing, ExampleFinish, ExampleGame, ExampleModelPrediction } from "../lib/examples/registry";

type Props = {
  cardTitle: string;
  imageDataUrl?: string;
  ourPrediction: ExampleModelPrediction;
  dings: ExampleDing[];
  game?: ExampleGame;
  finish?: ExampleFinish;
};

const BANDS: Array<{ band: ConditionBand; label: string }> = [
  { band: "950-1000_gem_pristine", label: "Gem / Pristine candidate" },
  { band: "900-949_mint", label: "Mint candidate" },
  { band: "850-899_strong_nm_mint", label: "Strong NM-Mint" },
  { band: "800-849_near_mint", label: "Near-Mint" },
  { band: "700-799_visible_issues", label: "Visible condition risk" },
  { band: "below_700_heavy_wear", label: "Heavy visible wear" },
];

export function SubmitGoldRecord(props: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ slug: string; consent: boolean; publicExample: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [handle, setHandle] = useState("");
  const [grader, setGrader] = useState<"PSA" | "BGS" | "CGC" | "TAG" | "human-reviewer">("PSA");
  const [certNumber, setCertNumber] = useState("");
  const [grade, setGrade] = useState("");
  const [numericGrade, setNumericGrade] = useState("");
  const [band, setBand] = useState<ConditionBand>("900-949_mint");
  const [consent, setConsent] = useState(false);
  const [consentPublicExample, setConsentPublicExample] = useState(false);
  const [consentModelTraining, setConsentModelTraining] = useState(false);
  const [includeImage, setIncludeImage] = useState(true);
  const [dingsApproved, setDingsApproved] = useState(false);

  if (done) {
    return (
      <article className="report-method-attribution">
        <strong>Gold record saved</strong>
        <p style={{ margin: "4px 0 0", fontSize: 12 }}>
          The record is now in{" "}
          {done.publicExample ? (
            <a href={`/examples/${done.slug}`}>/examples/{done.slug}</a>
          ) : (
            <span>the private evaluation registry</span>
          )}{" "}
          with a Gold trust badge.
          {done.consent ? " Your handle is visible." : " Attribution withheld — handle hidden as 'anon'."}
        </p>
      </article>
    );
  }

  if (!open) {
    return (
      <button className="chat-method-cta-button" onClick={() => setOpen(true)} type="button">
        Submit this scan as a Gold record →
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const certUrl = grader === "PSA" && certNumber.trim()
        ? `https://www.psacard.com/cert/${certNumber.trim()}`
        : grader === "CGC" && certNumber.trim()
          ? `https://www.cgccards.com/CERTLOOKUP/card-grading/grading-scale/`
          : grader === "BGS" && certNumber.trim()
            ? `https://www.beckett.com/grading/card-lookup`
            : undefined;

      const response = await fetch("/api/examples/submit-gold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contributorHandle: handle || "anon",
          consentPublicAttribution: consent,
          consentPublicExample,
          consentModelTraining,
          humanDingReviewApproved: dingsApproved,
          title: props.cardTitle,
          game: props.game ?? "other",
          finish: props.finish ?? "unknown",
          imageDataUrl: includeImage ? props.imageDataUrl : undefined,
          officialOutcome:
            certNumber.trim() || grade.trim()
              ? {
                  grader,
                  certNumber: certNumber.trim() || undefined,
                  certUrl,
                  grade: grade.trim() || undefined,
                  numericGrade: numericGrade ? Number(numericGrade) : undefined,
                  band,
                }
              : undefined,
          dings: dingsApproved ? props.dings : [],
          ourPrediction: props.ourPrediction,
        }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error ?? "submit failed");
      setDone({ slug: body.slug, consent: body.consentPublicAttribution, publicExample: body.consentPublicExample });
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-method-cta">
      <strong>Submit this scan as a Gold record</strong>
      <p>
        Gold = your raw scan + an official cert outcome + your DING review. Stored locally. Public
        attribution is opt-in. Without consent, your handle becomes &quot;anon&quot;. We never publish raw
        image bytes outside attribution rules.
      </p>
      <label className="chat-method-cta-row">
        <span>Handle</span>
        <input onChange={(event) => setHandle(event.target.value)} value={handle} type="text" placeholder="your-handle" />
      </label>
      <label className="chat-method-cta-row">
        <span>Grader</span>
        <select onChange={(event) => setGrader(event.target.value as typeof grader)} value={grader}>
          <option value="PSA">PSA</option>
          <option value="BGS">BGS</option>
          <option value="CGC">CGC</option>
          <option value="TAG">TAG</option>
          <option value="human-reviewer">Human reviewer</option>
        </select>
      </label>
      <label className="chat-method-cta-row">
        <span>Cert #</span>
        <input
          onChange={(event) => setCertNumber(event.target.value)}
          placeholder="e.g. 101964593"
          type="text"
          value={certNumber}
        />
      </label>
      <label className="chat-method-cta-row">
        <span>Grade label</span>
        <input
          onChange={(event) => setGrade(event.target.value)}
          placeholder='e.g. "GEM MT 10"'
          type="text"
          value={grade}
        />
      </label>
      <label className="chat-method-cta-row">
        <span>Numeric</span>
        <input
          onChange={(event) => setNumericGrade(event.target.value)}
          placeholder="e.g. 10"
          step={0.5}
          type="number"
          value={numericGrade}
        />
      </label>
      <label className="chat-method-cta-row">
        <span>Band</span>
        <select onChange={(event) => setBand(event.target.value as ConditionBand)} value={band}>
          {BANDS.map((entry) => (
            <option key={entry.band} value={entry.band}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="chat-method-cta-consent">
        <input checked={includeImage} onChange={(event) => setIncludeImage(event.target.checked)} type="checkbox" />
        <span>Include the scanned image bytes (stored locally only — never published).</span>
      </label>
      <label className="chat-method-cta-consent">
        <input
          checked={consentPublicExample}
          onChange={(event) => setConsentPublicExample(event.target.checked)}
          type="checkbox"
        />
        <span>Allow this consented scan/report to appear publicly in /examples.</span>
      </label>
      <label className="chat-method-cta-consent">
        <input
          checked={consentModelTraining}
          onChange={(event) => setConsentModelTraining(event.target.checked)}
          type="checkbox"
        />
        <span>Allow this record to be used for future model training and benchmark improvement.</span>
      </label>
      <label className="chat-method-cta-consent">
        <input
          checked={dingsApproved}
          onChange={(event) => setDingsApproved(event.target.checked)}
          type="checkbox"
        />
        <span>The {props.dings.length} DING annotation(s) on this scan are correctly labeled (material vs cosmetic).</span>
      </label>
      <label className="chat-method-cta-consent">
        <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
        <span>Allow public attribution to my handle when this Gold record appears on /examples.</span>
      </label>
      <div className="chat-method-cta-actions">
        <button className="button warn" disabled={busy} onClick={submit} type="button">
          {busy ? "Submitting…" : "Submit Gold record"}
        </button>
        <button className="button secondary" disabled={busy} onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
      {error ? <small className="chat-method-cta-error">{error}</small> : null}
    </div>
  );
}
