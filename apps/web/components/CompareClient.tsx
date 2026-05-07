"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { reportDisclaimer, sampleDetections, type DingDetection } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";
import { useVault } from "./useVault";

type CompareTab = "split" | "swipe" | "diff";

const tabs: { id: CompareTab; label: string }[] = [
  { id: "split", label: "Side-by-side" },
  { id: "swipe", label: "Swipe compare" },
  { id: "diff", label: "Diff overlay" },
];

export function CompareClient() {
  const { items } = useVault();
  const [tab, setTab] = useState<CompareTab>("split");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [showOverlays, setShowOverlays] = useState(true);
  const [swipe, setSwipe] = useState(50);

  const [baselineId, setBaselineId] = useState(items[0]?.id ?? "");
  const [candidateId, setCandidateId] = useState(items[1]?.id ?? items[0]?.id ?? "");
  const baseline = items.find((item) => item.id === baselineId) ?? items[0];
  const candidate = items.find((item) => item.id === candidateId) ?? items[1] ?? items[0];

  const deltas: DingDetection[] = useMemo(() => {
    if (!baseline || !candidate) return [];
    const baselineKeys = new Set(baseline.detections.map((d) => `${d.type}:${d.zone}`));
    const newDetections = candidate.detections.filter((d) => !baselineKeys.has(`${d.type}:${d.zone}`));
    return newDetections.length ? newDetections : sampleDetections.slice(0, 1);
  }, [baseline, candidate]);

  const removed: DingDetection[] = useMemo(() => {
    if (!baseline || !candidate) return [];
    const candidateKeys = new Set(candidate.detections.map((d) => `${d.type}:${d.zone}`));
    return baseline.detections.filter((d) => !candidateKeys.has(`${d.type}:${d.zone}`));
  }, [baseline, candidate]);

  if (!baseline || !candidate) {
    return (
      <main className="compare-shell">
        <p className="muted">
          Need at least one card. <Link href="/scan?mode=sample">Run the sample scan</Link>.
        </p>
      </main>
    );
  }

  const transform = `scale(${zoom}) translate(${50 - pan.x}%, ${50 - pan.y}%)`;

  return (
    <main className="compare-shell">
      <header className="compare-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="compare-tabs" aria-label="Compare modes">
          {tabs.map((entry) => (
            <button
              className={tab === entry.id ? "is-active" : ""}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="compare-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <Link className="button secondary" href="/cards">
            Catalog
          </Link>
        </div>
      </header>

      <section className="compare-controls">
        <div className="compare-control-group">
          <label>
            <span>Before</span>
            <select onChange={(event) => setBaselineId(event.target.value)} value={baseline.id}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>After</span>
            <select onChange={(event) => setCandidateId(event.target.value)} value={candidate.id}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="compare-control-group">
          <label>
            <span>Zoom {zoom.toFixed(1)}×</span>
            <input
              max="4"
              min="1"
              onChange={(event) => setZoom(Number(event.target.value))}
              step="0.1"
              type="range"
              value={zoom}
            />
          </label>
          <label>
            <input
              checked={showOverlays}
              onChange={(event) => setShowOverlays(event.target.checked)}
              type="checkbox"
            />
            <span>Show DING overlays</span>
          </label>
        </div>
      </section>

      {tab === "split" ? (
        <section className="compare-split">
          <ComparePane
            detections={showOverlays ? baseline.detections : []}
            imageDataUrl={baseline.imageDataUrl}
            label="Before shipping"
            onPan={setPan}
            transform={transform}
          />
          <ComparePane
            detections={showOverlays ? candidate.detections : []}
            imageDataUrl={candidate.imageDataUrl}
            label="After return"
            onPan={setPan}
            transform={transform}
          />
        </section>
      ) : null}

      {tab === "swipe" ? (
        <section className="compare-swipe">
          <div className="compare-swipe-stage" style={{ ["--swipe" as string]: `${swipe}%` }}>
            <div className="compare-swipe-layer compare-swipe-layer--bottom">
              <DingOverlay
                alt={candidate.title}
                detections={showOverlays ? candidate.detections : []}
                imageDataUrl={candidate.imageDataUrl}
              />
              <span className="compare-swipe-tag">After</span>
            </div>
            <div className="compare-swipe-layer compare-swipe-layer--top">
              <DingOverlay
                alt={baseline.title}
                detections={showOverlays ? baseline.detections : []}
                imageDataUrl={baseline.imageDataUrl}
              />
              <span className="compare-swipe-tag">Before</span>
            </div>
            <div className="compare-swipe-handle" aria-hidden="true" />
          </div>
          <input
            aria-label="Swipe compare position"
            className="compare-swipe-slider"
            max="100"
            min="0"
            onChange={(event) => setSwipe(Number(event.target.value))}
            type="range"
            value={swipe}
          />
        </section>
      ) : null}

      {tab === "diff" ? (
        <section className="compare-diff">
          <div className="compare-diff-stage">
            <DingOverlay
              alt={candidate.title}
              detections={[]}
              imageDataUrl={candidate.imageDataUrl}
            />
            <div className="compare-diff-overlay" aria-label="New defect candidates">
              {deltas.map((delta) => {
                const [x1, y1, x2, y2] = delta.bbox;
                return (
                  <span
                    className="diff-box new"
                    key={delta.id}
                    style={{ left: `${x1}%`, top: `${y1}%`, width: `${x2 - x1}%`, height: `${y2 - y1}%` }}
                  >
                    <em>{delta.type.replaceAll("_", " ")}</em>
                  </span>
                );
              })}
              {removed.map((delta) => {
                const [x1, y1, x2, y2] = delta.bbox;
                return (
                  <span
                    className="diff-box removed"
                    key={`removed-${delta.id}`}
                    style={{ left: `${x1}%`, top: `${y1}%`, width: `${x2 - x1}%`, height: `${y2 - y1}%` }}
                  >
                    <em>was: {delta.type.replaceAll("_", " ")}</em>
                  </span>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section className="compare-deltas">
        <div className="compare-delta-card new">
          <div className="section-head">
            <div>
              <span className="page-kicker">New defect candidates</span>
              <h2>{deltas.length}</h2>
            </div>
            <span className="market-pill live">requires review</span>
          </div>
          <ul className="finding-list">
            {deltas.map((delta) => (
              <li key={delta.id}>
                <strong>{delta.type.replaceAll("_", " ")}</strong>
                <small>{delta.zone} - evidence medium</small>
              </li>
            ))}
            {deltas.length === 0 ? <li className="muted">None.</li> : null}
          </ul>
        </div>
        <div className="compare-delta-card removed">
          <div className="section-head">
            <div>
              <span className="page-kicker">Resolved or absent</span>
              <h2>{removed.length}</h2>
            </div>
          </div>
          <ul className="finding-list">
            {removed.map((delta) => (
              <li key={delta.id}>
                <strong>{delta.type.replaceAll("_", " ")}</strong>
                <small>{delta.zone}</small>
              </li>
            ))}
            {removed.length === 0 ? <li className="muted">None.</li> : null}
          </ul>
        </div>
      </section>

      <p className="disclaimer compare-disclaimer">{reportDisclaimer}</p>
    </main>
  );
}

function ComparePane({
  detections,
  imageDataUrl,
  label,
  onPan,
  transform,
}: {
  detections: DingDetection[];
  imageDataUrl?: string;
  label: string;
  onPan: (next: { x: number; y: number }) => void;
  transform: string;
}) {
  return (
    <div className="compare-pane">
      <div className="section-head">
        <strong>{label}</strong>
      </div>
      <div
        className="compare-pane-stage"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          onPan({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
        }}
      >
        <div className="compare-pane-image" style={{ transform }}>
          <DingOverlay alt={label} detections={detections} imageDataUrl={imageDataUrl} />
        </div>
      </div>
    </div>
  );
}
