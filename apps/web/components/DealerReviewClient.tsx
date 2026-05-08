"use client";

import { useState, useCallback, type ChangeEvent } from "react";
import Link from "next/link";
import type { DealerRecord, DealerModelFinding } from "../lib/dealer/types";
import { DealerCardThumb } from "./DealerCardThumb";

const DING_TYPES = [
  "corner_wear",
  "edge_wear",
  "scratch",
  "crease",
  "dent",
  "surface_contamination",
  "print_line",
  "glare_uncertain",
  "no_material_ding",
  "unknown_damage",
];

type Props = {
  record: DealerRecord;
};

function findingClass(f: DealerModelFinding): string {
  return f.acceptedByReview === "accepted"
    ? "accepted"
    : f.acceptedByReview === "rejected"
      ? "rejected"
      : "";
}

function bboxClass(f: DealerModelFinding): string {
  return f.acceptedByReview === "accepted"
    ? "dealer-finding-bbox dealer-finding-bbox--accepted"
    : f.acceptedByReview === "rejected"
      ? "dealer-finding-bbox dealer-finding-bbox--rejected"
      : "dealer-finding-bbox";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("reader error"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("not a string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function DealerReviewClient({ record: initial }: Props) {
  const [record, setRecord] = useState<DealerRecord>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState<string>(record.humanReview?.reviewer ?? "");
  const [notes, setNotes] = useState<string>(record.humanReview?.notes ?? "");
  const [pendingType, setPendingType] = useState(DING_TYPES[0]);

  const updateFindingDecision = useCallback(
    async (idx: number, decision: "accepted" | "rejected" | "pending") => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/dealer/records/${record.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewer: reviewer || undefined,
            decisions: { [idx]: decision },
            notes: notes || undefined,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `${res.status}`);
        }
        const j = await res.json();
        if (j.record) setRecord(j.record as DealerRecord);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [record.id, reviewer, notes],
  );

  const advanceWithDecision = useCallback(
    async (decision: NonNullable<DealerRecord["humanReview"]>["decision"]) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/dealer/records/${record.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewer: reviewer || undefined,
            notes: notes || undefined,
            decision,
            advanceLane: "ready",
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `${res.status}`);
        }
        const j = await res.json();
        if (j.record) setRecord(j.record as DealerRecord);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [record.id, reviewer, notes],
  );

  const onAttachImage = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const imageBase64 = await fileToBase64(file);
        const res = await fetch(`/api/dealer/records/${record.id}/attach-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, mimeType: file.type }),
        });
        if (!res.ok && res.status !== 502) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `${res.status}`);
        }
        const j = await res.json();
        if (j.record) setRecord(j.record as DealerRecord);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      event.target.value = "";
    },
    [record.id],
  );

  const addFinding = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dealer/records/${record.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: reviewer || undefined,
          notes: notes || undefined,
          addedFinding: {
            type: pendingType,
            bbox: [25, 25, 50, 50],
            severity: "moderate",
            note: "Human-added DING via vendor review",
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `${res.status}`);
      }
      const j = await res.json();
      if (j.record) setRecord(j.record as DealerRecord);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [record.id, reviewer, notes, pendingType]);

  const findings = record.modelFindings ?? [];

  return (
    <div className="dealer-record-shell">
      <section className="dealer-section">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2>Slab image · {record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : record.id}</h2>
          <span className={`dealer-pill dealer-pill--${record.lane === "ready" ? "good" : record.lane === "human_review" ? "warn" : ""}`}>
            {record.lane}
          </span>
        </header>

        <div className="dealer-record-image">
          <DealerCardThumb
            alt="Slab"
            className="dealer-record-image-img"
            fallback={
              <div style={{ alignItems: "center", color: "rgba(255,255,255,0.5)", display: "flex", height: "100%", justifyContent: "center", textAlign: "center" }}>
                Local slab image unavailable
              </div>
            }
            src={record.imageUrl}
          />
          {findings.map((f, idx) => {
            const [x1, y1, x2, y2] = f.bbox;
            return (
              <div
                className={bboxClass(f)}
                key={`${record.id}-finding-${idx}`}
                style={{
                  left: `${x1}%`,
                  top: `${y1}%`,
                  width: `${Math.max(2, x2 - x1)}%`,
                  height: `${Math.max(2, y2 - y1)}%`,
                }}
              >
                <span>
                  {f.acceptedByReview === "rejected" ? "rejected · " : ""}
                  {f.type.replaceAll("_", " ")} · {f.severity}
                </span>
              </div>
            );
          })}
        </div>

        <div className="dealer-review-actions">
          <label className="dealer-pill" style={{ cursor: "pointer" }}>
            <input accept="image/*" hidden onChange={onAttachImage} type="file" />
            {record.imageUrl ? "Replace slab image" : "Attach slab image"}
          </label>
          <select
            onChange={(e) => setPendingType(e.target.value)}
            style={{ background: "rgba(11,8,22,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#fff", fontSize: 11, padding: "4px 6px" }}
            value={pendingType}
          >
            {DING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button onClick={addFinding} type="button">+ add DING</button>
        </div>
        {busy ? <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 8 }}>working…</p> : null}
        {error ? <p style={{ color: "#ff9c9c", fontSize: 11, marginTop: 8 }}>⚠ {error}</p> : null}
      </section>

      <aside className="dealer-record-aside">
        <section className="dealer-section">
          <h2>Cert metadata</h2>
          <dl className="dealer-evidence-dl" style={{ display: "grid", gap: "4px 12px", gridTemplateColumns: "max-content 1fr", fontSize: 11, margin: 0 }}>
            <dt>provider</dt>
            <dd>{record.certProvider ?? "—"}</dd>
            <dt>cert</dt>
            <dd>
              {record.certUrl ? (
                <a href={record.certUrl} rel="noopener noreferrer" target="_blank">
                  {record.certNumber} ↗
                </a>
              ) : (
                record.certNumber ?? "—"
              )}
            </dd>
            <dt>card</dt>
            <dd>{record.cardIdentity ?? "—"}</dd>
            <dt>grade</dt>
            <dd>{record.officialGrade ?? "—"}</dd>
            <dt>image hash</dt>
            <dd>
              <code style={{ fontSize: 9 }}>{record.imageHash ? `${record.imageHash.slice(0, 16)}…` : "—"}</code>
            </dd>
            <dt>quantity</dt>
            <dd>{record.quantity}</dd>
            <dt>inventory</dt>
            <dd>{record.inventoryType}</dd>
            <dt>trust</dt>
            <dd>{record.trustTier ?? "—"}</dd>
            <dt>consent</dt>
            <dd>{record.consentFlag ?? "pending"}</dd>
          </dl>
        </section>

        <section className="dealer-section">
          <h2>Findings ({findings.length})</h2>
          <ul className="dealer-finding-list">
            {findings.map((f, idx) => (
              <li className={findingClass(f)} key={`finding-row-${idx}`}>
                <strong>
                  {f.type.replaceAll("_", " ")} · {f.severity}
                </strong>
                <em>
                  conf {Math.round(f.confidence * 100)}% · {f.modelVersion}
                  {f.region ? ` · ${f.region}` : ""}
                </em>
                <small>bbox {f.bbox.join(",")}</small>
                {f.reviewerNote ? <small>{f.reviewerNote}</small> : null}
                <div className="dealer-review-actions">
                  <button
                    className={f.acceptedByReview === "accepted" ? "is-primary" : ""}
                    onClick={() => updateFindingDecision(idx, "accepted")}
                    type="button"
                  >
                    accept
                  </button>
                  <button
                    className={f.acceptedByReview === "rejected" ? "is-danger" : ""}
                    onClick={() => updateFindingDecision(idx, "rejected")}
                    type="button"
                  >
                    reject
                  </button>
                  <button
                    onClick={() => updateFindingDecision(idx, "pending")}
                    type="button"
                  >
                    reset
                  </button>
                </div>
              </li>
            ))}
            {findings.length === 0 ? (
              <li className="dealer-section-empty">
                No model findings. Attach a slab image to run the detector, or add a human DING above.
              </li>
            ) : null}
          </ul>
        </section>

        <section className="dealer-section">
          <h2>Reviewer</h2>
          <input
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="reviewer (e.g. vendor_friend_01)"
            style={{ background: "rgba(11,8,22,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#fff", fontSize: 11, padding: "5px 8px", width: "100%" }}
            value={reviewer}
          />
          <textarea
            onChange={(e) => setNotes(e.target.value)}
            placeholder="reviewer notes (visible in evidence packet)"
            rows={3}
            style={{ background: "rgba(11,8,22,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#fff", fontSize: 11, marginTop: 8, padding: "5px 8px", width: "100%" }}
            value={notes}
          />
          <div className="dealer-review-actions">
            <button
              className="is-primary"
              onClick={() => advanceWithDecision("submit_for_grading")}
              type="button"
            >
              ✓ submit for grading
            </button>
            <button onClick={() => advanceWithDecision("sell_raw")} type="button">
              sell raw
            </button>
            <button onClick={() => advanceWithDecision("rescan")} type="button">
              rescan
            </button>
            <button
              className="is-danger"
              onClick={() => advanceWithDecision("human_review")}
              type="button"
            >
              flag human review
            </button>
            <button onClick={() => advanceWithDecision("before_after_evidence")} type="button">
              before/after evidence
            </button>
          </div>
        </section>

        <section className="dealer-section">
          <h2>Pricing & ROI</h2>
          {record.pricing ? (
            <dl style={{ display: "grid", gap: "4px 12px", gridTemplateColumns: "max-content 1fr", fontSize: 11, margin: 0 }}>
              <dt>raw range</dt>
              <dd>${record.pricing.rawLow ?? "—"} – ${record.pricing.rawHigh ?? "—"}</dd>
              <dt>PSA 8 / 9 / 10</dt>
              <dd>${record.pricing.graded8 ?? "—"} · ${record.pricing.graded9 ?? "—"} · ${record.pricing.graded10 ?? "—"}</dd>
              <dt>confidence</dt>
              <dd>
                <span className={`dealer-pill dealer-pill--${record.pricing.confidence === "high" ? "good" : record.pricing.confidence === "low" ? "bad" : "warn"}`}>
                  {record.pricing.confidence ?? "—"}
                </span>
              </dd>
              <dt>variance</dt>
              <dd>{record.pricing.variance ?? "—"}</dd>
              <dt>sales</dt>
              <dd>{record.pricing.saleCount ?? 0} comps · last {record.pricing.freshness ?? "?"}</dd>
              <dt>source</dt>
              <dd>
                <code style={{ fontSize: 9 }}>{record.pricing.source ?? "—"}</code>
              </dd>
            </dl>
          ) : (
            <p className="dealer-section-empty">No pricing attached. Wire a comp source to populate.</p>
          )}
          {record.roi ? (
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 12 }}>Grading ROI</strong>
              <dl style={{ display: "grid", gap: "4px 12px", gridTemplateColumns: "max-content 1fr", fontSize: 11, margin: "4px 0 0" }}>
                <dt>recommendation</dt>
                <dd>
                  <span className={`dealer-pill dealer-pill--${record.roi.recommendation === "submit" ? "good" : record.roi.recommendation === "sell_raw" ? "warn" : ""}`}>
                    {record.roi.recommendation}
                  </span>
                </dd>
                <dt>raw value</dt>
                <dd>${record.roi.rawValue ?? "—"}</dd>
                <dt>expected EV</dt>
                <dd>${record.roi.expectedGradedEv ?? "—"}</dd>
                <dt>fees</dt>
                <dd>${(record.roi.gradingFee ?? 0) + (record.roi.shippingFee ?? 0)}</dd>
                <dt>net EV</dt>
                <dd>${record.roi.netEv ?? "—"}</dd>
                <dt>deal score</dt>
                <dd>
                  <span className={`dealer-pill dealer-pill--${record.roi.dealScore === "high" ? "good" : record.roi.dealScore === "low" ? "bad" : "warn"}`}>
                    {record.roi.dealScore ?? "—"}
                  </span>
                </dd>
              </dl>
              <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, margin: "6px 0 0" }}>
                {record.roi.rationale ?? "—"}
              </p>
            </div>
          ) : null}
        </section>

        <section className="dealer-section">
          <h2>Variant resolver</h2>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, margin: "0 0 8px" }}>
            Variants resolved from cert metadata + OCR. Confirm or edit before listing.
          </p>
          <dl style={{ display: "grid", gap: "4px 12px", gridTemplateColumns: "max-content 1fr", fontSize: 11, margin: 0 }}>
            <dt>language</dt>
            <dd>{record.variant?.language ?? (record.cardIdentity?.toLowerCase().includes("japanese") ? "Japanese" : "English (assumed)")}</dd>
            <dt>set</dt>
            <dd>{record.variant?.setName ?? "—"}</dd>
            <dt>card #</dt>
            <dd>{record.variant?.cardNumber ?? "—"}</dd>
            <dt>parallel</dt>
            <dd>{record.variant?.parallel ?? "standard"}</dd>
            <dt>finish</dt>
            <dd>{record.variant?.finish ?? "—"}</dd>
            <dt>1st edition</dt>
            <dd>{record.variant?.firstEdition === true ? "yes" : record.variant?.firstEdition === false ? "no" : "unknown"}</dd>
          </dl>
        </section>

        <section className="dealer-section">
          <h2>Evidence packet</h2>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, margin: "0 0 8px" }}>
            Generates a signed JSON packet (cert URL, image hash, accepted findings, reviewer, timestamp).
            Customer-share link is rendered as a printable HTML view.
          </p>
          <div className="dealer-review-actions">
            <Link
              className="dealer-pill"
              href={`/api/dealer/records/${record.id}/evidence?format=json`}
              prefetch={false}
            >
              download json
            </Link>
            <Link className="dealer-pill" href={`/dealer/records/${record.id}/evidence`}>
              public report ↗
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
