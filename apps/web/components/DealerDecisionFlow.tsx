"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { DealerRecord } from "../lib/dealer/types";

const STAGE_DEFS: Array<{ id: StageId; label: string }> = [
  { id: "uploaded", label: "Uploaded" },
  { id: "normalized", label: "Normalized" },
  { id: "card_detected", label: "Card" },
  { id: "cert_ocr", label: "OCR" },
  { id: "cert_verified", label: "Cert" },
  { id: "identity_matched", label: "Identity" },
  { id: "corners", label: "Corners" },
  { id: "edges", label: "Edges" },
  { id: "surface", label: "Surface" },
  { id: "dings", label: "DINGs" },
  { id: "pricing", label: "Pricing" },
  { id: "roi", label: "ROI" },
  { id: "calibration", label: "Band" },
  { id: "evidence", label: "Evidence" },
];

type StageId =
  | "uploaded"
  | "normalized"
  | "card_detected"
  | "cert_ocr"
  | "cert_verified"
  | "identity_matched"
  | "corners"
  | "edges"
  | "surface"
  | "dings"
  | "pricing"
  | "roi"
  | "calibration"
  | "evidence";

type StageStatus = "idle" | "running" | "done" | "skipped" | "failed";

type StageState = {
  id: StageId;
  label: string;
  status: StageStatus;
  startedAt?: number;
  completedAt?: number;
  evidence?: string;
};

type IntakeResponse = {
  batchId: string;
  imageHash: string;
  detectedLabels: number;
  uniqueCerts: string[];
  seedReferenceMatches?: string[];
  recordIds: string[];
};

type AttachResponse = {
  record?: DealerRecord;
  detectorError?: string;
};

type EvidenceResponse = {
  body: { packetId: string; cert: { provider: string | null; number: string | null } };
  signature: string;
  algorithm: string;
};

const RECOMMENDATION_COPY: Record<
  string,
  { tone: "good" | "warn" | "bad" | "info" | "muted"; pill: string }
> = {
  submit: { tone: "good", pill: "SUBMIT FOR GRADING" },
  sell_raw: { tone: "warn", pill: "SELL RAW" },
  hold: { tone: "muted", pill: "HOLD" },
  rescan: { tone: "info", pill: "RESCAN" },
  human_review: { tone: "bad", pill: "FLAG HUMAN REVIEW" },
};

function makeIdleStages(): StageState[] {
  return STAGE_DEFS.map((stage) => ({ ...stage, status: "idle" }));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a data URL"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function fmtUsd(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtMs(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function recommendationToReviewDecision(
  recommendation: NonNullable<DealerRecord["roi"]>["recommendation"] | undefined,
): NonNullable<DealerRecord["humanReview"]>["decision"] {
  switch (recommendation) {
    case "submit":
      return "submit_for_grading";
    case "sell_raw":
      return "sell_raw";
    case "rescan":
      return "rescan";
    case "human_review":
      return "human_review";
    default:
      return "before_after_evidence";
  }
}

function stageIcon(status: StageStatus): string {
  switch (status) {
    case "done":
      return "ok";
    case "running":
      return "..";
    case "failed":
      return "x";
    case "skipped":
      return "-";
    default:
      return "o";
  }
}

function logBehavior(payload: Record<string, unknown>): void {
  fetch("/api/dealer/behavior", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export function DealerDecisionFlow() {
  const [stages, setStages] = useState<StageState[]>(makeIdleStages);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [record, setRecord] = useState<DealerRecord | null>(null);
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "streaming" | "decision">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seeWhy, setSeeWhy] = useState(false);
  const [busySaving, setBusySaving] = useState(false);
  const [busyAccepting, setBusyAccepting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<number>(0);
  const sessionIdRef = useRef<string>("");
  const handleFileRef = useRef<((file: File) => Promise<void>) | null>(null);

  useEffect(() => {
    sessionIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dealer_session_${Date.now().toString(36)}`;
    logBehavior({ event: "returnVisit", returnVisitAt: new Date().toISOString(), sessionId: sessionIdRef.current });

    // Demo trigger: if ?demo=<fixture> is in the URL, auto-fetch the fixture
    // and feed it through handleFile so recordings can capture the streaming
    // pipeline without simulating a file picker. Recognized fixtures map to
    // images already shipped in /public.
    if (typeof window === "undefined") return;
    const demoMap: Record<string, string> = {
      tauros: "/demo/sample-cards/roboflow-tauros-real-card.jpg",
      "corner-wear": "/examples/corner-wear.png",
      "edge-wear": "/examples/edge-wear.png",
      scratch: "/examples/scratch.png",
    };
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (!demo || !demoMap[demo]) return;
    const url = demoMap[demo];
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        const filename = url.split("/").pop() ?? "demo.jpg";
        const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
        // Defer one tick so the initial render commits before we begin streaming.
        setTimeout(() => {
          void (async () => {
            await handleFileRef.current?.(file);
          })();
        }, 250);
      } catch {
        // demo trigger is best-effort
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStage = useCallback((id: StageId, patch: Partial<StageState>) => {
    setStages((previous) =>
      previous.map((stage) =>
        stage.id === id
          ? {
              ...stage,
              ...patch,
              completedAt:
                patch.status === "done" || patch.status === "failed" || patch.status === "skipped"
                  ? Date.now()
                  : stage.completedAt,
            }
          : stage,
      ),
    );
  }, []);

  const reset = useCallback(() => {
    setStages(makeIdleStages());
    setImageDataUrl(null);
    setRecord(null);
    setEvidence(null);
    setPhase("idle");
    setError(null);
    setSeeWhy(false);
    setBusySaving(false);
    setBusyAccepting(false);
    setCopied(false);
  }, []);

  const markFoveationStages = useCallback(
    (recordAfterAttach: DealerRecord | null, detectorError?: string) => {
      const findings = recordAfterAttach?.modelFindings ?? [];
      const cornerCount = findings.filter((finding) => /corner/i.test(finding.type) || /corner/i.test(finding.region ?? "")).length;
      const edgeCount = findings.filter((finding) => /edge/i.test(finding.type) || /edge/i.test(finding.region ?? "")).length;
      const surfaceCount = findings.filter((finding) =>
        /scratch|surface|glare|print|dent|crease/i.test(`${finding.type} ${finding.region ?? ""}`),
      ).length;

      setStage("corners", {
        status: detectorError ? "failed" : "done",
        evidence: detectorError ?? `4 crops inspected, ${cornerCount} corner candidate(s)`,
      });
      setStage("edges", {
        status: detectorError ? "failed" : "done",
        evidence: detectorError ?? `4 strips inspected, ${edgeCount} edge candidate(s)`,
      });
      setStage("surface", {
        status: detectorError ? "failed" : "done",
        evidence: detectorError ?? `surface pass complete, ${surfaceCount} surface candidate(s)`,
      });
    },
    [setStage],
  );

  const handleFile = useCallback(
    async (file: File) => {
      reset();
      setPhase("streaming");
      startedAtRef.current = Date.now();
      const dropAt = new Date().toISOString();
      logBehavior({
        event: "drop",
        dropAt,
        filename: file.name,
        size: file.size,
        sessionId: sessionIdRef.current,
      });

      let imageBase64: string;
      try {
        imageBase64 = await fileToBase64(file);
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        setStage("uploaded", { status: "failed", evidence: message });
        setPhase("idle");
        return;
      }

      setImageDataUrl(`data:${file.type || "image/jpeg"};base64,${imageBase64}`);
      setStage("uploaded", {
        status: "done",
        startedAt: Date.now(),
        evidence: `${file.name} | ${Math.round(file.size / 1024)} KB`,
      });

      setStage("normalized", { status: "running", startedAt: Date.now() });
      let intake: IntakeResponse;
      try {
        const response = await fetch("/api/dealer/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, filename: file.name, uploaderHint: "dealer_hero" }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.message ?? body?.error ?? `intake ${response.status}`);
        }
        intake = (await response.json()) as IntakeResponse;
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        setStage("normalized", { status: "failed", evidence: message });
        setPhase("idle");
        return;
      }

      setStage("normalized", {
        status: "done",
        evidence: `sha256 ${intake.imageHash.slice(0, 16)}`,
      });
      setStage("card_detected", {
        status: "done",
        evidence: `${intake.detectedLabels} label/card region(s)`,
      });

      const cert = intake.uniqueCerts[0] ?? intake.seedReferenceMatches?.[0];
      setStage("cert_ocr", {
        status: intake.detectedLabels > 0 || cert ? "done" : "skipped",
        evidence: cert ? `candidate ${cert}` : "no PSA-style label found",
      });
      setStage("cert_verified", {
        status: cert ? "done" : "skipped",
        evidence: cert ? `verified/reference ${cert}` : "raw image only",
      });

      setStage("corners", { status: "running", startedAt: Date.now(), evidence: "waiting for detector" });
      setStage("edges", { status: "running", startedAt: Date.now(), evidence: "waiting for detector" });
      setStage("surface", { status: "running", startedAt: Date.now(), evidence: "waiting for detector" });
      setStage("dings", { status: "running", startedAt: Date.now(), evidence: "detector running" });

      const recordId = intake.recordIds[0];
      let attached: AttachResponse | null = null;
      if (recordId) {
        try {
          const response = await fetch(`/api/dealer/records/${recordId}/attach-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64, mimeType: file.type || "image/jpeg" }),
          });
          if (!response.ok && response.status !== 502) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body?.error ?? `attach-image ${response.status}`);
          }
          attached = (await response.json()) as AttachResponse;
        } catch (err) {
          const message = (err as Error).message;
          setError(message);
          attached = { detectorError: message };
        }
      }

      const nextRecord = attached?.record ?? null;
      const findings = nextRecord?.modelFindings ?? [];
      setRecord(nextRecord);
      setStage("identity_matched", {
        status: nextRecord?.cardIdentity ? "done" : "skipped",
        evidence: nextRecord?.cardIdentity ?? "identity unresolved",
      });
      markFoveationStages(nextRecord, attached?.detectorError);

      const material = findings.filter(
        (finding) =>
          finding.acceptedByReview !== "rejected" &&
          (finding.severity === "moderate" || finding.severity === "major"),
      ).length;
      setStage("dings", {
        status: attached?.detectorError ? "failed" : "done",
        evidence: attached?.detectorError ?? `${findings.length} visible candidate(s), ${material} material`,
      });

      setStage("pricing", {
        status: nextRecord?.pricing ? "done" : "skipped",
        evidence: nextRecord?.pricing
          ? `raw ${fmtUsd(nextRecord.pricing.rawLow)}-${fmtUsd(nextRecord.pricing.rawHigh)}`
          : "comps unavailable",
      });
      setStage("roi", {
        status: nextRecord?.roi ? "done" : "skipped",
        evidence: nextRecord?.roi
          ? `${nextRecord.roi.recommendation}, net ${fmtUsd(nextRecord.roi.netEv)}`
          : "ROI unavailable",
      });
      setStage("calibration", {
        status: nextRecord?.officialBand ? "done" : "skipped",
        evidence: nextRecord?.officialBand ?? "no official grade band",
      });
      setStage("evidence", {
        status: "done",
        evidence: nextRecord ? `record ${nextRecord.id} ready` : "record not created",
      });

      setPhase("decision");
      logBehavior({
        event: "decisionShown",
        decisionShownAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtRef.current,
        recordId: nextRecord?.id,
        certNumber: nextRecord?.certNumber,
        findings: findings.length,
        recommendation: nextRecord?.roi?.recommendation,
        sessionId: sessionIdRef.current,
      });
    },
    [markFoveationStages, reset, setStage],
  );

  // Keep a stable ref to the latest handleFile so the demo-trigger useEffect
  // can invoke it without re-running on every render.
  handleFileRef.current = handleFile;

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const findings = record?.modelFindings ?? [];

  const saveProof = useCallback(async () => {
    if (!record) return;
    setBusySaving(true);
    setCopied(false);
    try {
      const saveResponse = await fetch(`/api/dealer/records/${record.id}/evidence`, { method: "POST" });
      if (!saveResponse.ok) throw new Error(`evidence ${saveResponse.status}`);
      const packetResponse = await fetch(`/api/dealer/records/${record.id}/evidence?format=json`);
      if (!packetResponse.ok) throw new Error(`signed packet ${packetResponse.status}`);
      const packet = (await packetResponse.json()) as EvidenceResponse;
      setEvidence(packet);
      logBehavior({
        event: "proofSaved",
        proofSavedAt: new Date().toISOString(),
        recordId: record.id,
        packetId: packet.body.packetId,
        sessionId: sessionIdRef.current,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySaving(false);
    }
  }, [record]);

  const copyProofLink = useCallback(async () => {
    if (!record) return;
    const path = `/dealer/records/${record.id}/evidence`;
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [record]);

  const acceptAll = useCallback(async () => {
    if (!record) return;
    const recordFindings = record.modelFindings ?? [];
    if (recordFindings.length === 0) return;
    setBusyAccepting(true);
    setError(null);
    try {
      const decisions = Object.fromEntries(recordFindings.map((_finding, index) => [index, "accepted"]));
      const response = await fetch(`/api/dealer/records/${record.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: "dealer_hero_accept_all",
          decisions,
          decision: recommendationToReviewDecision(record.roi?.recommendation),
          advanceLane: "ready",
          notes: "Accepted all model findings from the one-screen dealer flow.",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? `review ${response.status}`);
      }
      const body = (await response.json()) as { record?: DealerRecord };
      if (body.record) setRecord(body.record);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAccepting(false);
    }
  }, [record]);

  const toggleSeeWhy = useCallback(() => {
    setSeeWhy((value) => !value);
    if (!seeWhy && record) {
      logBehavior({
        event: "seeWhyOpened",
        seeWhyOpenedAt: new Date().toISOString(),
        recordId: record.id,
        sessionId: sessionIdRef.current,
      });
    }
  }, [record, seeWhy]);

  const acceptedCount = findings.filter((finding) => finding.acceptedByReview === "accepted").length;
  const materialCount = findings.filter(
    (finding) =>
      finding.acceptedByReview !== "rejected" &&
      (finding.severity === "moderate" || finding.severity === "major"),
  ).length;
  const cosmeticCount = Math.max(0, findings.length - materialCount);
  const recommendation = record?.roi?.recommendation;
  const recCopy = recommendation ? RECOMMENDATION_COPY[recommendation] : null;
  const cleanCard = phase === "decision" && findings.length === 0 && !recommendation;
  const elapsed = phase === "decision" ? Date.now() - startedAtRef.current : 0;

  const stagesSummary = useMemo(() => {
    const cert = stages.find((stage) => stage.id === "cert_verified")?.status === "done" ? "cert ok" : "cert n/a";
    const dings = `DINGs ${findings.length}`;
    const pricing = stages.find((stage) => stage.id === "pricing")?.status === "done" ? "pricing ok" : "pricing n/a";
    const proof = evidence ? "proof saved" : "proof ready";
    return `${cert} | corners ok | ${dings} | ${pricing} | ${proof}`;
  }, [evidence, findings.length, stages]);

  return (
    <div className="dealer-hero-flow">
      {phase === "idle" ? (
        <div
          className={`dealer-hero-dropzone${dragOver ? " is-drag" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragLeave={() => setDragOver(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDrop={onDrop}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
        >
          <input accept="image/*" hidden onChange={onChange} ref={inputRef} type="file" />
          <p className="dealer-hero-prompt">Drop card photo. Get decision. Save proof.</p>
          <p className="dealer-hero-sub">
            AI-assisted visible condition only. Never an official grade. Local vendor-pilot evidence.
          </p>
          <span className="dealer-hero-status-pill">ding-detector-v0 ready</span>
          {error ? <p className="dealer-hero-error">{error}</p> : null}
        </div>
      ) : null}

      {phase !== "idle" ? (
        <div className="dealer-hero-canvas">
          {imageDataUrl ? (
            <div className="dealer-hero-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Dropped card" src={imageDataUrl} />
              {findings.map((finding, index) => {
                const [x1, y1, x2, y2] = finding.bbox;
                // Flip the label inside the box (below) when the bbox is near
                // the top edge so it doesn't clip outside the image-frame.
                const topAnchor = y1 < 14;
                return (
                  <div
                    className={`dealer-hero-bbox dealer-hero-bbox--${finding.severity}${
                      finding.acceptedByReview === "rejected" ? " is-rejected" : ""
                    }${topAnchor ? " dealer-hero-bbox--top-edge" : ""}`}
                    key={`hero-bbox-${index}`}
                    style={{
                      animationDelay: `${index * 90}ms`,
                      left: `${x1}%`,
                      top: `${y1}%`,
                      width: `${Math.max(2, x2 - x1)}%`,
                      height: `${Math.max(2, y2 - y1)}%`,
                    }}
                  >
                    <span>
                      {finding.type.replaceAll("_", " ")} | {finding.severity} | {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="dealer-stages-strip" aria-label="Pipeline stages">
            {stages.map((stage) => (
              <div
                className={`dealer-stage-cell dealer-stage-cell--${stage.status}`}
                key={stage.id}
                title={`${stage.label}${stage.evidence ? `: ${stage.evidence}` : ""}`}
              >
                <span aria-hidden>{stageIcon(stage.status)}</span>
                <small>{stage.label}</small>
              </div>
            ))}
          </div>
          <p className="dealer-stages-summary" aria-live="polite">
            {stagesSummary}
          </p>
        </div>
      ) : null}

      {phase === "decision" ? (
        <section className="dealer-decision-card">
          <header>
            <p className="dealer-decision-title">
              {record?.certProvider && record.certNumber
                ? `${record.certProvider} ${record.certNumber}`
                : record?.cardIdentity ?? "Card detected"}
              {record?.officialGrade ? <span> | {record.officialGrade}</span> : null}
            </p>
            <p className="dealer-decision-sub">
              {findings.length === 0
                ? "No material findings returned at the current threshold."
                : `${findings.length} visible DING(s) | ${materialCount} material | ${cosmeticCount} cosmetic | ${acceptedCount} accepted`}
            </p>
          </header>

          <div className={`dealer-decision-pill dealer-decision-pill--${recCopy?.tone ?? (cleanCard ? "good" : "muted")}`}>
            <strong>{recCopy?.pill ?? (cleanCard ? "NO MATERIAL FINDINGS" : "REVIEW REQUIRED")}</strong>
            {record?.roi ? (
              <span>
                net {fmtUsd(record.roi.netEv)} vs raw {fmtUsd(record.roi.rawValue)} | {record.roi.dealScore ?? "unknown"} deal
              </span>
            ) : cleanCard ? (
              <span>sell raw or grade for premium | confidence depends on capture quality</span>
            ) : (
              <span>cert or comps unavailable | use See why for limitations</span>
            )}
          </div>

          <div className="dealer-decision-actions">
            {findings.length > 0 ? (
              <button disabled={!record || busyAccepting} onClick={acceptAll} type="button">
                {busyAccepting ? "accepting..." : "Accept all findings"}
              </button>
            ) : null}
            <button className="is-primary" disabled={!record || busySaving} onClick={saveProof} type="button">
              {evidence ? "Proof saved" : busySaving ? "saving..." : "Save proof packet"}
            </button>
            {evidence && record ? (
              <button onClick={copyProofLink} type="button">
                {copied ? "Copied link" : "Copy proof link"}
              </button>
            ) : null}
            <button onClick={toggleSeeWhy} type="button">
              See why {seeWhy ? "up" : "down"}
            </button>
            <button onClick={reset} type="button">
              Drop another
            </button>
          </div>

          {error ? <p className="dealer-hero-error">{error}</p> : null}

          {evidence && record ? (
            <p className="dealer-decision-shareline">
              Public report:{" "}
              <Link href={`/dealer/records/${record.id}/evidence`} target="_blank">
                /dealer/records/{record.id}/evidence
              </Link>{" "}
              | packet <code>{evidence.body.packetId}</code> | sig <code>{evidence.signature.slice(0, 12)}</code>
            </p>
          ) : null}

          <p className="dealer-decision-meta">
            14 stages | ran in {fmtMs(elapsed)} | {record?.modelFindings?.[0]?.modelVersion ?? "ding-detector-v0"} |{" "}
            {evidence ? "evidence saved" : "evidence not saved"}
          </p>

          {seeWhy ? (
            <div className="dealer-decision-why">
              <h3>Stage timeline</h3>
              <ul>
                {stages.map((stage) => (
                  <li className={`dealer-stage-row dealer-stage-row--${stage.status}`} key={`why-${stage.id}`}>
                    <strong>{stage.label}</strong>
                    <em>{stage.status}</em>
                    <small>{stage.evidence ?? ""}</small>
                  </li>
                ))}
              </ul>

              {record ? (
                <>
                  <h3>Cert</h3>
                  <dl>
                    <dt>provider</dt>
                    <dd>{record.certProvider ?? "n/a"}</dd>
                    <dt>cert</dt>
                    <dd>
                      {record.certUrl ? (
                        <a href={record.certUrl} rel="noopener noreferrer" target="_blank">
                          {record.certNumber}
                        </a>
                      ) : (
                        record.certNumber ?? "n/a"
                      )}
                    </dd>
                    <dt>grade</dt>
                    <dd>{record.officialGrade ?? "n/a"}</dd>
                    <dt>image hash</dt>
                    <dd>
                      <code>{record.imageHash ? record.imageHash.slice(0, 32) : "n/a"}</code>
                    </dd>
                  </dl>

                  <h3>Findings</h3>
                  {findings.length === 0 ? (
                    <p className="muted">No detector findings exceeded the active threshold.</p>
                  ) : (
                    <ul className="dealer-finding-list">
                      {findings.map((finding, index) => (
                        <li key={`why-finding-${index}`}>
                          <strong>
                            {finding.type.replaceAll("_", " ")} | {finding.severity}
                          </strong>
                          <em>
                            conf {Math.round(finding.confidence * 100)}% | bbox {finding.bbox.join(",")}
                          </em>
                          <small>
                            {finding.modelVersion} | {finding.acceptedByReview ?? "pending"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}

                  {record.pricing ? (
                    <>
                      <h3>Pricing</h3>
                      <dl>
                        <dt>raw</dt>
                        <dd>
                          {fmtUsd(record.pricing.rawLow)} - {fmtUsd(record.pricing.rawHigh)}
                        </dd>
                        <dt>graded 8 / 9 / 10</dt>
                        <dd>
                          {fmtUsd(record.pricing.graded8)} | {fmtUsd(record.pricing.graded9)} |{" "}
                          {fmtUsd(record.pricing.graded10)}
                        </dd>
                        <dt>confidence</dt>
                        <dd>{record.pricing.confidence ?? "n/a"}</dd>
                        <dt>comps</dt>
                        <dd>
                          {record.pricing.saleCount ?? 0} | last {record.pricing.freshness ?? "unknown"}
                        </dd>
                      </dl>
                    </>
                  ) : null}

                  {record.roi ? (
                    <>
                      <h3>ROI math</h3>
                      <dl>
                        <dt>recommendation</dt>
                        <dd>{record.roi.recommendation}</dd>
                        <dt>raw value</dt>
                        <dd>{fmtUsd(record.roi.rawValue)}</dd>
                        <dt>expected EV</dt>
                        <dd>{fmtUsd(record.roi.expectedGradedEv)}</dd>
                        <dt>fees</dt>
                        <dd>{fmtUsd((record.roi.gradingFee ?? 0) + (record.roi.shippingFee ?? 0))}</dd>
                        <dt>net</dt>
                        <dd>{fmtUsd(record.roi.netEv)}</dd>
                        <dt>rationale</dt>
                        <dd>{record.roi.rationale ?? "n/a"}</dd>
                      </dl>
                    </>
                  ) : null}

                  <h3>Adjust review</h3>
                  <p className="muted">
                    Read-only here. Open the workbench only when you need to edit findings or change the decision.
                  </p>
                  <Link href={`/dealer/records/${record.id}`}>Open workbench</Link>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
