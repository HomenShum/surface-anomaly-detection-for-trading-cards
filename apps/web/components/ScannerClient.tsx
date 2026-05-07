"use client";

import { useRef, useState } from "react";
import { inferenceApiBaseUrl } from "../lib/inference-api";
import { createScanDraft, type DingDetection, type VaultItem } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";
import { useVault } from "./useVault";

type CameraState = "idle" | "ready" | "blocked";
type AnalyzeState = "idle" | "running" | "done" | "offline";

function dataUrlToPayload(dataUrl: string) {
  const [header, payload] = dataUrl.split(",");
  const contentType = header.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
  return { image_base64: payload ?? dataUrl, filename: "front_best.jpg", content_type: contentType };
}

function findingsToDings(findings: Array<Record<string, unknown>>, width = 640, height = 896): DingDetection[] {
  return findings.map((finding, index) => {
    const raw = Array.isArray(finding.bbox) ? finding.bbox.map(Number) : [48, 48, 160, 140];
    const [x1, y1, x2, y2] = raw.length === 4 ? raw : [48, 48, 160, 140];
    return {
      id: `api-det-${index}`,
      type: String(finding.kind ?? "unknown_damage"),
      zone: "normalized_card",
      confidence: Number(finding.confidence ?? 0.35),
      severity: Number(finding.confidence ?? 0.35) > 0.7 ? "moderate" : "minor",
      bbox: [
        Math.max(0, Math.min(96, (x1 / width) * 100)),
        Math.max(0, Math.min(96, (y1 / height) * 100)),
        Math.max(4, Math.min(100, (x2 / width) * 100)),
        Math.max(4, Math.min(100, (y2 / height) * 100))
      ],
      source: "model"
    };
  });
}

function confidenceForAlphaReport(findingCount: number, conditionScore: unknown) {
  if (findingCount === 0) return 0.62;
  const rawScore = Number(conditionScore ?? 68) / 100;
  return Math.max(0.45, Math.min(0.78, rawScore));
}

function benchmarkForAlphaReport(findingCount: number) {
  return findingCount === 0 ? "Needs human review" : "DING review";
}

export function ScannerClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { addItem } = useVault();
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [imageDataUrl, setImageDataUrl] = useState<string>();
  const [backImageDataUrl, setBackImageDataUrl] = useState<string>();
  const [ding, setDing] = useState(false);
  const [draft, setDraft] = useState<VaultItem>(() => createScanDraft());
  const [saved, setSaved] = useState(false);
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>("idle");
  const [warnings, setWarnings] = useState<string[]>([]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("ready");
    } catch {
      setCameraState("blocked");
    }
  }

  function flashDing() {
    setDing(true);
    window.setTimeout(() => setDing(false), 850);
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 1280;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    setImageDataUrl(dataUrl);
    setDraft(createScanDraft(dataUrl));
    setSaved(false);
    setAnalyzeState("idle");
    flashDing();
  }

  function handleUpload(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setImageDataUrl(dataUrl);
      setDraft(createScanDraft(dataUrl));
      setSaved(false);
      setAnalyzeState("idle");
      flashDing();
    };
    reader.readAsDataURL(file);
  }

  function handleBackUpload(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBackImageDataUrl(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  function updateDraft<K extends keyof VaultItem>(key: K, value: VaultItem[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveDraft() {
    addItem({ ...draft, imageDataUrl, backImageDataUrl });
    setSaved(true);
  }

  async function analyzeFrame() {
    if (!imageDataUrl) return;
    setAnalyzeState("running");
    setWarnings([]);
    try {
      const apiBase = inferenceApiBaseUrl();
      const response = await fetch(`${apiBase}/scan/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...dataUrlToPayload(imageDataUrl),
          card_id: draft.id,
          report_id: `${draft.id}-report`
        })
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const body = await response.json();
      const normalized = body.normalized ?? {};
      const report = body.report ?? {};
      const detections = findingsToDings(report.findings ?? [], normalized.width, normalized.height);
      setDraft((current) => ({
        ...current,
        grade: benchmarkForAlphaReport(detections.length),
        confidence: confidenceForAlphaReport(detections.length, report.condition_score),
        notes: String(report.summary ?? current.notes),
        imageDataUrl: normalized.image_base64
          ? `data:image/png;base64,${normalized.image_base64}`
          : current.imageDataUrl,
        detections,
        evidence: {
          ...current.evidence,
          model: {
            ...current.evidence.model,
            dingDetector: body.report?.evidence_manifest?.model?.ding_detector ?? "ding-detector-v0"
          },
          files: current.evidence.files.map((file) =>
            file.role === "front_normalized" && normalized.sha256 ? { ...file, sha256: normalized.sha256 } : file
          )
        }
      }));
      if (normalized.image_base64) setImageDataUrl(`data:image/png;base64,${normalized.image_base64}`);
      setWarnings(normalized.warnings ?? []);
      setAnalyzeState("done");
    } catch {
      setWarnings(["Inference API unavailable. No model detections were generated; use sample mode only until the API is online."]);
      setAnalyzeState("offline");
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <div className="scanner-frame">
          {imageDataUrl ? <DingOverlay detections={draft.detections} imageDataUrl={imageDataUrl} alt="Captured collectible" /> : null}
          {!imageDataUrl ? (
            <video ref={videoRef} playsInline muted aria-label="Camera preview" />
          ) : null}
          <div className="scan-reticle" aria-hidden="true" />
          {ding ? <div className="ding">DING</div> : null}
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="button" onClick={startCamera} type="button">
            Enable camera
          </button>
          <button
            className="button secondary"
            disabled={cameraState !== "ready"}
            onClick={captureFrame}
            type="button"
          >
            Capture
          </button>
          <label className="button secondary">
            Front upload
            <input
              accept="image/*"
              className="file-input-native"
              onChange={(event) => handleUpload(event.target.files?.[0])}
              type="file"
            />
          </label>
          <label className="button secondary">
            Back upload
            <input
              accept="image/*"
              className="file-input-native"
              onChange={(event) => handleBackUpload(event.target.files?.[0])}
              type="file"
            />
          </label>
          <button className="button warn" disabled={!imageDataUrl || analyzeState === "running"} onClick={analyzeFrame} type="button">
            {analyzeState === "running" ? "Analyzing" : "Analyze"}
          </button>
        </div>
        {warnings.length ? (
          <ul className="warning-list">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
        {cameraState === "blocked" ? (
          <p className="muted">Camera permission is unavailable. Use upload fallback.</p>
        ) : null}
        {backImageDataUrl ? <p className="pill">Back frame selected</p> : null}
      </section>

      <section className="card">
        <h2>Correction</h2>
        <p className="muted">Review the scanner output before adding it to the local catalog.</p>
        <div className="form">
          <div className="field">
            <label htmlFor="title">Item</label>
            <input
              id="title"
              onChange={(event) => updateDraft("title", event.target.value)}
              value={draft.title}
            />
          </div>
          <div className="grid two">
            <div className="field">
              <label htmlFor="category">Category</label>
              <select
                id="category"
                onChange={(event) => updateDraft("category", event.target.value as VaultItem["category"])}
                value={draft.category}
              >
                <option value="card">Card</option>
                <option value="sealed">Sealed</option>
                <option value="ticket">Ticket</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="grade">Condition benchmark</label>
              <input
                id="grade"
                onChange={(event) => updateDraft("grade", event.target.value)}
                value={draft.grade}
              />
            </div>
          </div>
          <div className="grid three">
            <div className="field">
              <label htmlFor="game">Game</label>
              <select
                id="game"
                onChange={(event) => updateDraft("game", event.target.value as VaultItem["game"])}
                value={draft.game}
              >
                <option value="unknown">Unknown</option>
                <option value="pokemon">Pokemon</option>
                <option value="sports">Sports</option>
                <option value="one-piece">One Piece</option>
                <option value="magic">Magic</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="setName">Set</label>
              <input id="setName" onChange={(event) => updateDraft("setName", event.target.value)} value={draft.setName} />
            </div>
            <div className="field">
              <label htmlFor="variant">Variant</label>
              <input id="variant" onChange={(event) => updateDraft("variant", event.target.value)} value={draft.variant} />
            </div>
          </div>
          <div className="grid three">
            {(["surfaceScore", "centeringScore", "edgeScore"] as const).map((key) => (
              <div className="field" key={key}>
                <label htmlFor={key}>{key.replace("Score", "")}</label>
                <input
                  id={key}
                  max="100"
                  min="0"
                  onChange={(event) => updateDraft(key, Number(event.target.value))}
                  type="number"
                  value={draft[key]}
                />
              </div>
            ))}
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              onChange={(event) => updateDraft("notes", event.target.value)}
              rows={4}
              value={draft.notes}
            />
          </div>
          <button className="button warn" onClick={saveDraft} type="button">
            Save to catalog
          </button>
          {saved ? <span className="pill">Saved locally</span> : null}
        </div>
      </section>
    </div>
  );
}
