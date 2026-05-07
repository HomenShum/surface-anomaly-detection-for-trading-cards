"use client";

import { useMemo, useState } from "react";
import type { ExampleDing } from "../lib/examples/registry";

type ReviewRef = {
  id: string;
  provider: string;
  certNumber: string;
  cardIdentity?: string;
  officialGrade?: string;
  trustTier: string;
};

type Props = {
  refs: ReviewRef[];
};

const DING_TYPES: ExampleDing["type"][] = [
  "edge_wear",
  "corner_wear",
  "scratch",
  "crease",
  "surface_anomaly",
  "whitening",
  "print_line",
  "glare_uncertain",
];

const SEVERITIES: ExampleDing["severity"][] = ["minor", "moderate", "major"];

export function HumanDingReviewWorkbench({ refs }: Props) {
  const [certId, setCertId] = useState(refs[0]?.id ?? "");
  const [reviewerHandle, setReviewerHandle] = useState("");
  const [reviewedImageSource, setReviewedImageSource] = useState("slab_front");
  const [cleanCardAttestation, setCleanCardAttestation] = useState(false);
  const [dings, setDings] = useState<ExampleDing[]>([]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => refs.find((ref) => ref.id === certId), [certId, refs]);
  const frontUrl = certId ? `/api/cert-references/slab/${certId}/front.jpg` : null;

  function addDing() {
    setDings((current) => [
      ...current,
      {
        type: "edge_wear",
        bbox: [2, 20, 8, 30],
        severity: "minor",
        materialToGrade: true,
        note: "Describe the visible issue and whether it is material.",
        source: "human",
      },
    ]);
    setCleanCardAttestation(false);
  }

  function updateDing(index: number, patch: Partial<ExampleDing>) {
    setDings((current) => current.map((ding, i) => (i === index ? { ...ding, ...patch } : ding)));
  }

  async function submit() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/cert-references/human-ding-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certId,
          reviewerHandle,
          consentToStoreReview: true,
          reviewedImageSource,
          cleanCardAttestation,
          dings,
          notes,
        }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error ?? "review submit failed");
      setStatus(`Saved review ${body.review.reviewId}. Run pnpm eval:production-readiness to refresh gates.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "review submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="benchmarks-section">
      <div className="cert-detail-layout">
        <div>
          <label className="chat-method-cta-row">
            <span>Reference</span>
            <select value={certId} onChange={(event) => setCertId(event.target.value)}>
              {refs.map((ref) => (
                <option key={ref.id} value={ref.id}>
                  {ref.provider} {ref.certNumber} - {ref.officialGrade ?? "pending"}
                </option>
              ))}
            </select>
          </label>
          <label className="chat-method-cta-row">
            <span>Reviewer</span>
            <input value={reviewerHandle} onChange={(event) => setReviewerHandle(event.target.value)} placeholder="reviewer-handle" />
          </label>
          <label className="chat-method-cta-row">
            <span>Image source</span>
            <select value={reviewedImageSource} onChange={(event) => setReviewedImageSource(event.target.value)}>
              <option value="slab_front">slab front</option>
              <option value="slab_back">slab back</option>
              <option value="raw_pre_submission">raw pre-submission</option>
              <option value="other">other</option>
            </select>
          </label>
          <label className="chat-method-cta-consent">
            <input checked={cleanCardAttestation} onChange={(event) => setCleanCardAttestation(event.target.checked)} type="checkbox" />
            <span>No material DINGs visible in this reviewed image.</span>
          </label>
          <label className="chat-method-cta-row">
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Review limitations, glare, uncertainty, or disagreement." />
          </label>
          <div className="chat-method-cta-actions">
            <button className="button secondary" type="button" onClick={addDing}>
              Add DING
            </button>
            <button className="button warn" type="button" disabled={busy || !certId || !reviewerHandle} onClick={submit}>
              {busy ? "Saving..." : "Save review"}
            </button>
          </div>
          {status ? <p className="benchmarks-stub-note">{status}</p> : null}
        </div>
        <div>
          <div className="example-media-frame">
            {frontUrl ? <img src={frontUrl} alt={selected?.cardIdentity ?? "reference image"} /> : <div className="card-placeholder" />}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {selected?.cardIdentity ?? "Identity pending"} - {selected?.trustTier ?? "unknown"} - {selected?.officialGrade ?? "grade pending"}
          </p>
        </div>
      </div>

      <table className="benchmarks-table">
        <thead>
          <tr>
            <th>DING</th>
            <th>BBox %</th>
            <th>Severity</th>
            <th>Material</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {dings.map((ding, index) => (
            <tr key={index}>
              <td>
                <select value={ding.type} onChange={(event) => updateDing(index, { type: event.target.value as ExampleDing["type"] })}>
                  {DING_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={ding.bbox.join(",")}
                  onChange={(event) => {
                    const values = event.target.value.split(",").map((value) => Number(value.trim()));
                    if (values.length === 4 && values.every(Number.isFinite)) updateDing(index, { bbox: values as [number, number, number, number] });
                  }}
                />
              </td>
              <td>
                <select value={ding.severity} onChange={(event) => updateDing(index, { severity: event.target.value as ExampleDing["severity"] })}>
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input checked={ding.materialToGrade} onChange={(event) => updateDing(index, { materialToGrade: event.target.checked })} type="checkbox" />
              </td>
              <td>
                <input value={ding.note} onChange={(event) => updateDing(index, { note: event.target.value })} />
              </td>
            </tr>
          ))}
          {dings.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No DING rows yet. Add one or check clean-card attestation before saving.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
