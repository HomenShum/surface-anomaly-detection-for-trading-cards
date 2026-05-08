"use client";

import { useState, useCallback, useRef, type ChangeEvent } from "react";
import Link from "next/link";
import type { DealerIntakeBatch, DealerLane, DealerRecord } from "../../../lib/dealer/types";
import { LANE_LABEL, LANE_ORDER } from "../../../lib/dealer/types";

type Props = {
  initialRecords: DealerRecord[];
  initialBatches: DealerIntakeBatch[];
};

type IntakeResponse = {
  batchId: string;
  imageHash: string;
  detectedLabels: number;
  uniqueCerts: string[];
  recordIds: string[];
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function displayRecordNote(record: DealerRecord) {
  const raw = record.officialGrade ?? record.cardIdentity ?? record.notes ?? "-";
  if (/fetch failed|Inference URL unavailable|Detector unreachable/i.test(raw)) {
    return "local OCR service offline; queued for retry";
  }
  if (raw.length > 78) return `${raw.slice(0, 75)}...`;
  return raw;
}

export function DealerIntakeClient({ initialRecords, initialBatches }: Props) {
  const [records, setRecords] = useState<DealerRecord[]>(initialRecords);
  const [batches, setBatches] = useState<DealerIntakeBatch[]>(initialBatches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<IntakeResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const all: IntakeResponse[] = [];
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const res = await fetch("/api/dealer/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, filename: file.name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `intake ${res.status}`);
        }
        const j = (await res.json()) as IntakeResponse;
        all.push(j);
      }
      setLastResult(all[all.length - 1] ?? null);
      // Refresh records + batches via the server API.
      const refresh = await fetch("/api/dealer/intake/state", { cache: "no-store" }).catch(() => null);
      if (refresh && refresh.ok) {
        const j = await refresh.json();
        if (Array.isArray(j.records)) setRecords(j.records);
        if (Array.isArray(j.batches)) setBatches(j.batches);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list) return;
    handleFiles(Array.from(list));
    event.target.value = "";
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (!event.dataTransfer?.files) return;
    handleFiles(Array.from(event.dataTransfer.files));
  };

  const recordsByLane: Record<DealerLane, DealerRecord[]> = {
    uploaded: [],
    certs_detected: [],
    verified: [],
    image_attached: [],
    ready: [],
    human_review: [],
    listed: [],
    submitted: [],
    sold: [],
  };
  for (const r of records) recordsByLane[r.lane] = [...(recordsByLane[r.lane] ?? []), r];

  return (
    <div className="dealer-intake-stack">
      <section
        aria-label="Drop zone"
        className={`dealer-dropzone${dragOver ? " is-drag" : ""}${busy ? " is-busy" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDrop={onDrop}
      >
        <input
          accept="image/*"
          hidden
          multiple
          onChange={onChange}
          ref={inputRef}
          type="file"
        />
        <div className="dealer-dropzone-visual" aria-hidden>
          <span className="dealer-dropzone-slab dealer-dropzone-slab--back" />
          <span className="dealer-dropzone-slab dealer-dropzone-slab--front">
            <i />
          </span>
          <strong>DROP</strong>
        </div>
        <p className="dealer-dropzone-title">
          {busy ? "Running OCR + cert extraction…" : "Drop PSA label batch / slab grid / binder page photos"}
        </p>
        <p className="dealer-dropzone-hint">
          The dealer pipeline runs Tesseract on each label crop, extracts cert numbers + grade hints, and creates
          one Dealer record per detected slab. No cert images are cached or trained on. Photo limit: 12&nbsp;MB.
        </p>
        {error ? <p className="dealer-dropzone-error">⚠ {error}</p> : null}
        {lastResult ? (
          <p className="dealer-dropzone-success">
            ✓ Last batch: {lastResult.detectedLabels} label(s) detected · {lastResult.uniqueCerts.length} unique
            cert{lastResult.uniqueCerts.length === 1 ? "" : "s"} ·{" "}
            <Link href="/dealer/dashboard">open dashboard ↗</Link>
          </p>
        ) : null}
      </section>

      <section aria-label="Lanes" className="dealer-lanes">
        {LANE_ORDER.map((lane) => {
          const rows = recordsByLane[lane];
          // Hide downstream fulfillment/archive lanes from intake. Submission,
          // sold, and listing workflows have their own focused surfaces.
          if (lane === "submitted" || lane === "sold" || lane === "listed") return null;
          return (
            <article className={`dealer-lane dealer-lane--${lane}`} key={lane}>
              <header>
                <span className="dealer-lane-label">{LANE_LABEL[lane]}</span>
                <span className="dealer-lane-count">{rows.length}</span>
              </header>
              <ul>
                {rows.slice(0, 12).map((r) => (
                  <li key={r.id}>
                    <Link href={`/dealer/records/${r.id}`}>
                      <strong>
                        {r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id}
                      </strong>
                      <em>{displayRecordNote(r)}</em>
                    </Link>
                  </li>
                ))}
                {rows.length > 12 ? (
                  <li className="dealer-lane-overflow">+{rows.length - 12} more…</li>
                ) : null}
                {rows.length === 0 ? <li className="dealer-lane-empty">empty</li> : null}
              </ul>
            </article>
          );
        })}
      </section>

      <section aria-label="Batches" className="dealer-batches">
        <h2>Recent batches</h2>
        <table>
          <thead>
            <tr>
              <th>batch</th>
              <th>uploaded</th>
              <th>file</th>
              <th>certs</th>
              <th>records</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {batches.slice(-12).reverse().map((b) => (
              <tr key={b.batchId}>
                <td>
                  <code>{b.batchId.slice(0, 14)}…</code>
                </td>
                <td>{b.uploadedAt.replace("T", " ").replace(/\..*$/, "Z")}</td>
                <td>{b.inputFilename ?? "—"}</td>
                <td>{b.uniqueCertNumbers.length}</td>
                <td>{b.recordIds.length}</td>
                <td>
                  <span className={`dealer-status dealer-status--${b.status}`}>{b.status}</span>
                </td>
              </tr>
            ))}
            {batches.length === 0 ? (
              <tr>
                <td colSpan={6} className="dealer-batches-empty">No batches yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
