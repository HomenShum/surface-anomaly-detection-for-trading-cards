"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { dataUrlToImagePayload } from "../lib/agent";
import { inferenceApiBaseUrl } from "../lib/inference-api";
import { reportDisclaimer, type UserCorrection } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";
import { ModelConsensusPanel } from "./ModelConsensusPanel";
import { ReportChatPanel } from "./ReportChatPanel";
import { SubmitGoldRecord } from "./SubmitGoldRecord";
import { ZoomLensOverlay, type ZoomLensTarget, type ZoomRegion } from "./ZoomLensOverlay";
import type { AgentReportContext } from "../lib/agent/tools";
import type { ConditionBand, ExampleDing, ExampleFinish, ExampleGame, ExampleModelPrediction } from "../lib/examples/registry";
import { useVault } from "./useVault";

type Tab = "overview" | "dings" | "evidence" | "history" | "notes";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "dings", label: "DINGs" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
  { id: "notes", label: "Notes" },
];

function evidenceNameForRole(role: string) {
  if (role === "front_original") return "source";
  if (role === "front_normalized") return "normalized";
  return role;
}

function dataUrlContentType(dataUrl: string) {
  return dataUrl.match(/^data:(.*?);base64,/)?.[1] ?? "application/octet-stream";
}

function dataUrlSizeBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function ReportClient() {
  const params = useParams<{ id: string }>();
  const { items, updateItem } = useVault();
  const item = items.find((entry) => entry.id === params.id) ?? items[0];
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [label, setLabel] = useState("glare_uncertain");
  const [note, setNote] = useState("Needs human review.");
  const [verifyState, setVerifyState] = useState<"idle" | "running" | "passed" | "failed" | "error">("idle");
  const [verifyDetail, setVerifyDetail] = useState<string>("");
  const [chatZoomTarget, setChatZoomTarget] = useState<ZoomLensTarget | null>(null);

  const reportContext = useMemo<AgentReportContext | null>(() => {
    if (!item) return null;
    const finishGuess: AgentReportContext["finishType"] = item.title.toLowerCase().includes("holo")
      ? "holo"
      : item.title.toLowerCase().includes("foil")
        ? "textured_foil"
        : "matte";
    return {
      cardId: item.id,
      reportSummary: item.notes,
      conditionScore: Math.round(item.confidence * 100),
      surfaceScore: item.surfaceScore,
      centeringScore: item.centeringScore,
      edgeScore: item.edgeScore,
      glareScore: undefined,
      finishType: finishGuess,
      imageDataUrl: item.imageDataUrl,
      inferenceBaseUrl: undefined,
      findings: item.detections.map((detection) => ({
        type: detection.type,
        confidence: detection.confidence,
        severity: detection.severity,
        bbox: detection.bbox,
        zone: detection.zone,
        sha256: undefined,
      })),
      evidence: item.evidence.files.map((file) => ({
        role: file.role,
        sha256: file.sha256,
        path: file.path,
      })),
    };
  }, [item]);

  const confidenceBucket = useMemo(() => {
    if (!item) return "low";
    if (item.confidence >= 0.82 && item.surfaceScore >= 78) return "medium-high";
    if (item.confidence >= 0.65) return "medium";
    return "low";
  }, [item]);

  const recommendedAction = useMemo(() => {
    if (!item) return "Capture an image to start.";
    if (item.detections.length === 0) return "Save record. Re-shoot a tighter surface scan if you want a higher-confidence estimate.";
    if (item.detections.length >= 3) return "Consider a human grading review before shipping.";
    return "Save record. Run before/after compare if you want to track changes over time.";
  }, [item]);

  if (!item) {
    return (
      <main className="report-shell">
        <p className="muted">No report yet. <Link href="/scan?mode=sample">Run the sample scan</Link>.</p>
      </main>
    );
  }

  function addCorrection(action: UserCorrection["action"], detectionId?: string) {
    if (!item) return;
    const correction: UserCorrection = {
      id: `correction-${Date.now()}`,
      detectionId,
      action,
      label,
      note,
      createdAt: new Date().toISOString(),
    };
    updateItem({ ...item, corrections: [correction, ...item.corrections] });
  }

  async function verifyEvidence() {
    if (!item) return;
    setVerifyState("running");
    setVerifyDetail("");
    try {
      const apiBase = inferenceApiBaseUrl();
      const verifiableFiles = [
        {
          role: "front_original",
          dataUrl: item.sourceImageDataUrl,
          evidenceFile: item.evidence.files.find((file) => file.role === "front_original"),
        },
        {
          role: "front_normalized",
          dataUrl: item.imageDataUrl,
          evidenceFile: item.evidence.files.find((file) => file.role === "front_normalized"),
        },
      ].filter((entry): entry is { role: string; dataUrl: string; evidenceFile: NonNullable<typeof entry.evidenceFile> } =>
        Boolean(entry.dataUrl && entry.evidenceFile),
      );

      if (verifiableFiles.length === 0) {
        setVerifyState("error");
        setVerifyDetail("No in-browser evidence bytes are available to verify. Re-run an upload or scan first.");
        return;
      }

      const manifestItems = verifiableFiles.map(({ role, dataUrl, evidenceFile }) => {
        const name = evidenceNameForRole(role);
        return {
          name,
          sha256: evidenceFile.sha256,
          content_type: dataUrlContentType(dataUrl),
          size_bytes: dataUrlSizeBytes(dataUrl),
          uri: evidenceFile.path,
          metadata: { filename: name },
        };
      });

      const response = await fetch(`${apiBase}/evidence/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: {
            manifest_version: item.evidence.manifestVersion,
            report_id: `${item.id}-report`,
            created_at: item.evidence.createdAt,
            items: manifestItems,
            manifest_sha256:
              item.evidence.files.find((file) => file.role === "report_json")?.sha256 ??
              item.evidence.scanSessionId,
            model: {
              ding_detector: item.evidence.model.dingDetector,
              normalizer: item.evidence.model.normalizer,
            },
            disclaimer: item.evidence.disclaimer,
          },
          files: verifiableFiles.map(({ role, dataUrl }) =>
            dataUrlToImagePayload(dataUrl, evidenceNameForRole(role)),
          ),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        setVerifyState("error");
        setVerifyDetail(`HTTP ${response.status}: ${text.slice(0, 240)}`);
        return;
      }
      const body = await response.json();
      const passed = Boolean(body?.passed ?? body?.verified);
      setVerifyState(passed ? "passed" : "failed");
      const checked = Array.isArray(body?.checked_items) ? body.checked_items : [];
      const mismatches = checked
        .filter((entry: Record<string, unknown>) => !entry.matched)
        .map((entry: Record<string, unknown>) => `${entry.name}: ${entry.reason ?? "sha256 mismatch"}`);
      setVerifyDetail(
        passed
          ? `${checked.length} supplied evidence payload(s) matched. Manifest model: ${item.evidence.model.dingDetector}.`
          : `Mismatch: ${mismatches.length ? mismatches.join(", ") : "see verifier response"}`,
      );
    } catch (error) {
      setVerifyState("error");
      setVerifyDetail(
        `Verifier unreachable: ${error instanceof Error ? error.message : "unknown"}. Start the inference service or set NEXT_PUBLIC_INFERENCE_API_URL.`,
      );
    }
  }

  return (
    <main className="report-shell">
      <header className="report-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="report-tabs" aria-label="Report sections">
          {tabs.map((tab) => (
            <button
              className={tab.id === activeTab ? "is-active" : ""}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="report-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <Link className="button secondary" href={`/cards/${item.id}`}>
            Card detail
          </Link>
          <Link className="button" href="/compare">
            Compare
          </Link>
        </div>
      </header>

      <section className="report-hero">
        <div className="report-hero-card">
          <DingOverlay alt={item.title} detections={item.detections} imageDataUrl={item.imageDataUrl} />
          <ZoomLensOverlay
            durationMs={1100}
            imageDataUrl={item.imageDataUrl}
            target={chatZoomTarget}
          />
        </div>
        <aside className="report-hero-summary">
          <span className="page-kicker">Condition dossier</span>
          <h1>{item.title}</h1>
          <p className="muted">{item.notes}</p>
          <div className="report-summary-grid">
            <div>
              <span>Benchmark</span>
              <strong>{item.grade}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{Math.round(item.confidence * 100)}%</strong>
              <small className="muted">{confidenceBucket}</small>
            </div>
            <div>
              <span>Visible DINGs</span>
              <strong>{item.detections.length}</strong>
            </div>
            <div>
              <span>Recommended</span>
              <strong className="recommended-action">{recommendedAction}</strong>
            </div>
          </div>
          <div className="report-cta-row">
            <Link className="button warn" href={`/cards/${item.id}`}>
              Save / open record
            </Link>
            <Link className="button secondary" href="/scan?mode=sample">
              Re-scan
            </Link>
          </div>
        </aside>
      </section>

      <section className="report-tab-pane">
        {activeTab === "overview" ? (
          <div className="report-grid">
            <div className="report-card">
              <h2>Score breakdown</h2>
              <dl className="detail-list">
                <div>
                  <dt>Surface</dt>
                  <dd>{item.surfaceScore}/100</dd>
                </div>
                <div>
                  <dt>Centering</dt>
                  <dd>{item.centeringScore}/100</dd>
                </div>
                <div>
                  <dt>Edges</dt>
                  <dd>{item.edgeScore}/100</dd>
                </div>
                <div>
                  <dt>Confidence cap</dt>
                  <dd>Alpha guarded</dd>
                </div>
              </dl>
            </div>
            {reportContext ? (
              <ReportChatPanel
                onZoomAction={(action) => {
                  const overlayRegion: ZoomRegion =
                    action.region === "custom" ? "center" : (action.region as ZoomRegion);
                  setChatZoomTarget({
                    bboxNorm: action.bbox,
                    region: overlayRegion,
                    label: action.label ?? overlayRegion,
                  });
                  window.setTimeout(() => setChatZoomTarget(null), 1400);
                }}
                reportContext={reportContext}
              />
            ) : null}
            <ModelConsensusPanel item={item} />
            {item ? (
              <div className="report-card report-card--full">
                <div className="section-head">
                  <div>
                    <span className="page-kicker">Gold-tier submission</span>
                    <h2>Contribute this scan to the Verified Outcome Library</h2>
                  </div>
                  <span className="meta-chip">opt-in · privacy-first</span>
                </div>
                <p className="muted">
                  Once your card has an official cert (PSA / BGS / CGC / TAG), submit this pre-submission
                  scan as a Gold record. Image bytes stay local. Public attribution is opt-in. The Gold
                  record becomes part of the Verified Outcome Library and helps train the next iteration.
                </p>
                <SubmitGoldRecord
                  cardTitle={item.title}
                  dings={item.detections.map((detection): ExampleDing => ({
                    type: (["edge_wear", "corner_wear", "scratch", "crease", "surface_anomaly", "whitening", "print_line", "glare_uncertain"].includes(detection.type)
                      ? detection.type
                      : "surface_anomaly") as ExampleDing["type"],
                    bbox: detection.bbox,
                    severity: detection.severity === "major" ? "major" : detection.severity === "moderate" ? "moderate" : "minor",
                    materialToGrade: detection.severity !== "minor",
                    note: `${detection.type.replaceAll("_", " ")} at ${detection.zone}, confidence ${(Math.round(detection.confidence * 100))}%.`,
                    source: "model",
                  }))}
                  finish={(item.title.toLowerCase().includes("holo")
                    ? "holo"
                    : item.title.toLowerCase().includes("foil")
                      ? "textured_foil"
                      : "matte") as ExampleFinish}
                  game={"pokemon" as ExampleGame}
                  imageDataUrl={item.imageDataUrl}
                  ourPrediction={{
                    benchmarkScore: Math.round(item.confidence * 1000),
                    band: ((item.confidence > 0.85
                      ? "950-1000_gem_pristine"
                      : item.confidence > 0.7
                        ? "900-949_mint"
                        : item.confidence > 0.55
                          ? "850-899_strong_nm_mint"
                          : item.confidence > 0.4
                            ? "800-849_near_mint"
                            : "700-799_visible_issues") as ConditionBand),
                    confidence: item.confidence,
                    matchedKnownOutcome: null,
                    notes: item.notes,
                    modelVersion: item.evidence.model.dingDetector,
                  } satisfies ExampleModelPrediction}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "dings" ? (
          <div className="report-grid">
            <div className="report-card">
              <h2>Visible DINGs ({item.detections.length})</h2>
              {item.detections.length === 0 ? (
                <p className="muted">
                  No DING candidates exceeded the confidence floor. Empty findings are not proof the
                  card is clean - re-scan the surface for higher confidence.
                </p>
              ) : (
                <ul className="ding-list">
                  {item.detections.map((detection) => (
                    <li key={detection.id} className={`severity-${detection.severity}`}>
                      <div>
                        <strong>{detection.type.replaceAll("_", " ")}</strong>
                        <small>{detection.zone}</small>
                      </div>
                      <div>
                        <span>{Math.round(detection.confidence * 100)}%</span>
                        <em>{detection.severity}</em>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => addCorrection("false_positive", detection.id)}
                        type="button"
                      >
                        False positive
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="report-card">
              <h2>Add missed DING</h2>
              <div className="form">
                <div className="field">
                  <label htmlFor="correction-label">Label</label>
                  <select
                    id="correction-label"
                    onChange={(event) => setLabel(event.target.value)}
                    value={label}
                  >
                    <option value="glare_uncertain">glare_uncertain</option>
                    <option value="edge_wear">edge_wear</option>
                    <option value="corner_wear">corner_wear</option>
                    <option value="scratch">scratch</option>
                    <option value="crease">crease</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="correction-note">Note</label>
                  <textarea
                    id="correction-note"
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    value={note}
                  />
                </div>
                <div className="actions">
                  <button
                    className="button"
                    onClick={() => addCorrection("add_missed_ding")}
                    type="button"
                  >
                    Add missed DING
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => addCorrection("mark_unsure")}
                    type="button"
                  >
                    Mark unsure
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "evidence" ? (
          <div className="report-grid">
            <div className="report-card report-card--full">
              <div className="section-head">
                <div>
                  <h2>Evidence manifest</h2>
                  <p className="muted">
                    Original frame, normalized crop, model version, timestamp. Every report is
                    reproducible.
                  </p>
                </div>
                <div className="verify-actions">
                  <span className={`verify-pill verify-pill--${verifyState}`}>
                    {verifyState === "idle" && "Not verified"}
                    {verifyState === "running" && "Verifying..."}
                    {verifyState === "passed" && "Hashes match"}
                    {verifyState === "failed" && "Hash mismatch"}
                    {verifyState === "error" && "Verifier offline"}
                  </span>
                  <button
                    className="button"
                    disabled={verifyState === "running"}
                    onClick={() => void verifyEvidence()}
                    type="button"
                  >
                    {verifyState === "running" ? "Verifying..." : "Verify evidence"}
                  </button>
                </div>
              </div>
              {verifyDetail ? <p className={`verify-detail verify-detail--${verifyState}`}>{verifyDetail}</p> : null}
              <div className="hash-grid">
                {item.evidence.files.map((file) => (
                  <div key={file.path}>
                    <strong>{file.role}</strong>
                    <code>{file.sha256}</code>
                    <small>{file.path}</small>
                  </div>
                ))}
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Detector</dt>
                  <dd>{item.evidence.model.dingDetector}</dd>
                </div>
                <div>
                  <dt>Captured at</dt>
                  <dd>{new Date(item.scannedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Disclaimer</dt>
                  <dd>{reportDisclaimer}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="report-grid">
            <div className="report-card report-card--full">
              <h2>Correction log</h2>
              {item.corrections.length === 0 ? (
                <p className="muted">No corrections yet. Reviewer feedback shows up here.</p>
              ) : (
                <ul className="history-list">
                  {item.corrections.map((correction) => (
                    <li key={correction.id}>
                      <span className="market-pill">{correction.action.replaceAll("_", " ")}</span>
                      <strong>{correction.label}</strong>
                      <small>{correction.note}</small>
                      <em>{new Date(correction.createdAt).toLocaleString()}</em>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "notes" ? (
          <div className="report-grid">
            <div className="report-card report-card--full">
              <h2>Notes</h2>
              <p>{item.notes}</p>
              <p className="muted disclaimer-block">{reportDisclaimer}</p>
            </div>
          </div>
        ) : null}
      </section>

      <div className="report-mobile-cta">
        <Link className="button warn" href={`/cards/${item.id}`}>
          Save / open record
        </Link>
      </div>
    </main>
  );
}
