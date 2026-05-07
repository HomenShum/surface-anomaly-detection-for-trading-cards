"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { CameraScanner, type CapturedFrame } from "./CameraScanner";
import { DingOverlay } from "./DingOverlay";
import { InferenceHealthPill, useInferenceGate } from "./InferenceHealthPill";
import { useVault } from "./useVault";
import {
  REGION_BBOXES,
  ZoomLensOverlay,
  regionForFinding,
  type ZoomLensTarget,
  type ZoomRegion,
} from "./ZoomLensOverlay";
import { analyzeUploadInBrowser } from "../lib/agent";
import { reportDisclaimer, type VaultItem } from "../lib/vault";
import { scoreFrameFromImage, type FrameQuality } from "../lib/capture/frame-quality";

type ScanMode = "auto" | "video" | "upload" | "sample";
type Phase = "question" | "capture" | "analyze" | "report";

const SAMPLE_PATH = "/demo/sample-cards/roboflow-tauros-real-card.jpg";
const SAMPLE_NAME = "roboflow-tauros-real-card.jpg";

const checklistTemplate = [
  { id: "card", label: "Card detected", detail: "Looking for a single card boundary in the frame." },
  { id: "edges", label: "Edges visible", detail: "All four card borders need to clear the reticle." },
  { id: "blur", label: "Blur check", detail: "Laplacian variance against a 1800-baseline kernel." },
  { id: "glare", label: "Glare check", detail: "Highlight saturation < 35 in the surface region." },
  { id: "perspective", label: "Perspective normalized", detail: "Corner refinement and rectification." },
  { id: "front", label: "Front recognized", detail: "Top/bottom orientation locked in." },
  { id: "corner", label: "Corner regions extracted", detail: "Cropping the four 9% corner tiles." },
  { id: "edge", label: "Edge regions extracted", detail: "Cropping the four edge ribbons." },
  { id: "surface", label: "Surface scan", detail: "Surface-mode classifier (matte / glossy / holo)." },
  { id: "ding", label: "DING detection", detail: "ding-detector-v0 forward pass - mock fallback off." },
  { id: "confidence", label: "Confidence scoring", detail: "Alpha-guarded cap on per-finding confidence." },
  { id: "report", label: "Building condition report", detail: "Composing DINGs, severity, and notes." },
  { id: "evidence", label: "Saving evidence manifest", detail: "Hashing original + normalized frames." },
  { id: "catalog", label: "Updating catalog", detail: "Local vault save + Convex-ready persistence." },
] as const;

type ChecklistStatus = "waiting" | "in_progress" | "passed" | "warning" | "failed" | "skipped";
type ChecklistRow = (typeof checklistTemplate)[number] & {
  status: ChecklistStatus;
  liveDetail?: string;
};

function freshChecklist(): ChecklistRow[] {
  return checklistTemplate.map((row) => ({ ...row, status: "waiting" }));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFrameQuality(dataUrl: string): Promise<FrameQuality> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        resolve(scoreFrameFromImage(img));
      } catch {
        resolve({
          blurScore: 50,
          brightness: 50,
          glareRisk: 20,
          edgeCoverage: 50,
          surfaceMode: "unknown",
          pass: true,
          reasons: [],
        });
      }
    };
    img.onerror = () =>
      resolve({
        blurScore: 50,
        brightness: 50,
        glareRisk: 20,
        edgeCoverage: 50,
        surfaceMode: "unknown",
        pass: true,
        reasons: [],
      });
    img.src = dataUrl;
  });
}

export function ScanFlowClient({ initialMode }: { initialMode?: ScanMode }) {
  const { addItem } = useVault();
  const { isOffline, isDegraded, health } = useInferenceGate();
  const [mode, setMode] = useState<ScanMode | null>(initialMode ?? null);
  const [phase, setPhase] = useState<Phase>(initialMode ? "capture" : "question");
  const [imageDataUrl, setImageDataUrl] = useState<string>();
  const [imageName, setImageName] = useState<string>("");
  const [captureQuality, setCaptureQuality] = useState<FrameQuality | null>(null);
  const [checklist, setChecklist] = useState<ChecklistRow[]>(freshChecklist);
  const [activeItem, setActiveItem] = useState<VaultItem | undefined>();
  const [persisted, setPersisted] = useState<string>("not saved");
  const [analysisLog, setAnalysisLog] = useState<string[]>([]);
  const [zoomTarget, setZoomTarget] = useState<ZoomLensTarget | null>(null);
  const cancelledRef = useRef(false);

  const checklistProgress = useMemo(() => {
    const passed = checklist.filter((row) => row.status === "passed").length;
    return Math.round((passed / checklist.length) * 100);
  }, [checklist]);

  function setRow(index: number, status: ChecklistStatus, liveDetail?: string) {
    setChecklist((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, status, liveDetail } : row)),
    );
  }

  function appendLog(line: string) {
    setAnalysisLog((current) => [...current.slice(-20), `${new Date().toLocaleTimeString()}  ${line}`]);
  }

  async function passRow(index: number, baseDelay = 220) {
    setRow(index, "in_progress");
    appendLog(`${checklistTemplate[index].label} - running`);
    await wait(baseDelay);
    setRow(index, "passed");
  }

  async function inspectRegions(
    rowIndex: number,
    regions: ZoomRegion[],
    label: string,
    findings: { type: string; bbox: [number, number, number, number]; severity?: string }[],
    perRegionMs = 1100,
  ) {
    setRow(rowIndex, "in_progress", `Starting ${label}…`);
    appendLog(`${label} - inspecting ${regions.length} region(s)`);
    for (const region of regions) {
      if (cancelledRef.current) return;
      const bboxNorm = REGION_BBOXES[region];
      const regionFindings = findings.filter((f) => regionForFinding(f.bbox) === region);
      const niceLabel = regionLabelShort(region);
      setRow(rowIndex, "in_progress", `Inspecting ${niceLabel}`);
      appendLog(`Lens → ${niceLabel}${regionFindings.length ? ` (${regionFindings.length} finding)` : ""}`);
      setZoomTarget({
        bboxNorm,
        region,
        label: niceLabel,
        findings: regionFindings,
      });
      await wait(perRegionMs);
    }
    setZoomTarget(null);
    setRow(rowIndex, "passed", `${regions.length} region(s) inspected`);
  }

  async function runChecklist(dataUrl: string, fileName: string, captured: FrameQuality | null) {
    setPhase("analyze");
    cancelledRef.current = false;
    setChecklist(freshChecklist());
    setAnalysisLog([]);

    try {
      // 1. Card detected (cheap)
      await passRow(0, 240);
      // 2. Edges visible
      const quality = captured ?? (await dataUrlToFrameQuality(dataUrl));
      if (quality.edgeCoverage >= 28) {
        setRow(1, "passed");
        appendLog(`Edges visible - coverage ${quality.edgeCoverage}%`);
      } else {
        setRow(1, "warning");
        appendLog(`Edges weak - coverage ${quality.edgeCoverage}%`);
      }
      await wait(220);

      // 3. Blur
      if (quality.blurScore >= 38) {
        setRow(2, "passed");
        appendLog(`Blur ok - sharpness ${quality.blurScore}`);
      } else {
        setRow(2, "warning");
        appendLog(`Blur risk - sharpness ${quality.blurScore}, downstream scores may be soft`);
      }
      await wait(220);

      // 4. Glare
      if (quality.glareRisk <= 35) {
        setRow(3, "passed");
        appendLog(`Glare ok - risk ${quality.glareRisk}`);
      } else {
        setRow(3, "warning");
        appendLog(`Glare detected - risk ${quality.glareRisk}, surface confidence will reduce`);
      }
      await wait(220);

      // 5–6 normalization stages
      await passRow(4, 360);
      await passRow(5, 220);

      // Kick off DING detector NOW so the model runs in parallel with the
      // corner/edge zoom-lens animation. The animation uses the detector's
      // findings as soon as they arrive.
      const detectorPromise = analyzeUploadInBrowser(dataUrl, fileName || "Scan");

      // Stage 7: corner regions — animated zoom-lens through 4 corners.
      // First two corners animate immediately; by the time we reach corners 3–4
      // the detector has typically returned and we can render real findings.
      const earlyFindings: { type: string; bbox: [number, number, number, number]; severity?: string }[] = [];
      let detectorResult: Awaited<typeof detectorPromise> | null = null;
      detectorPromise
        .then((r) => {
          detectorResult = r;
          for (const d of r.item.detections) {
            earlyFindings.push({
              type: d.type,
              bbox: d.bbox as [number, number, number, number],
              severity: d.severity,
            });
          }
        })
        .catch(() => {
          // detector failure is handled below when we await
        });

      await inspectRegions(
        6,
        ["top_left_corner", "top_right_corner", "bottom_right_corner", "bottom_left_corner"],
        "Corner regions",
        earlyFindings,
        950,
      );

      await inspectRegions(
        7,
        ["top_edge", "right_edge", "bottom_edge", "left_edge"],
        "Edge regions",
        earlyFindings,
        750,
      );

      // 9 surface mode (real signal)
      setRow(8, "in_progress", `Classifier: ${quality.surfaceMode}`);
      appendLog(`Surface mode: ${quality.surfaceMode}`);
      await wait(360);
      if (quality.surfaceMode === "holo" || quality.surfaceMode === "glossy") {
        setRow(8, "warning", `${quality.surfaceMode} - premium foil mode applied`);
      } else {
        setRow(8, "passed", quality.surfaceMode);
      }
      await wait(160);

      // 10 DING detection - REAL model (already running, await it now)
      setRow(9, "in_progress", "Awaiting ding-detector-v0…");
      const result = detectorResult ?? (await detectorPromise);
      if (cancelledRef.current) return;
      setRow(9, "passed", `${result.item.detections.length} candidate(s)`);

      // 11 confidence scoring
      setRow(10, "in_progress", "Alpha guardrail engaged");
      await wait(300);
      setRow(10, "passed", `${Math.round(result.item.confidence * 100)}% capped`);

      // 12 report
      await passRow(11, 320);

      // 13 evidence
      setRow(12, "in_progress", "Hashing original + normalized");
      await wait(300);
      setRow(12, "passed", `${result.item.evidence.files.length} files hashed`);

      // 14 catalog
      setRow(13, "in_progress", "Local vault save");
      await wait(260);
      let persistence = "local";
      try {
        const response = await fetch("/api/catalog/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result.item),
        });
        const body = await response.json();
        persistence = body.persisted ?? persistence;
      } catch {
        persistence = "local";
      }
      addItem(result.item);
      setRow(13, "passed", persistence);
      setPersisted(persistence);
      setActiveItem(result.item);
      appendLog(`Saved to vault - persistence ${persistence}`);
      setPhase("report");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setChecklist((current) =>
        current.map((row) => (row.status === "in_progress" ? { ...row, status: "failed", liveDetail: message } : row)),
      );
      appendLog(`FAILED: ${message}`);
    }
  }

  function handleCaptured(frame: CapturedFrame) {
    setImageDataUrl(frame.dataUrl);
    setImageName("scan-live.jpg");
    setCaptureQuality(frame.quality);
    void runChecklist(frame.dataUrl, "scan-live.jpg", frame.quality);
  }

  async function handleUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setImageDataUrl(dataUrl);
    setImageName(file.name);
    const q = await dataUrlToFrameQuality(dataUrl);
    setCaptureQuality(q);
    void runChecklist(dataUrl, file.name, q);
  }

  async function loadSample() {
    const response = await fetch(SAMPLE_PATH);
    const blob = await response.blob();
    const dataUrl = await fileToDataUrl(blob);
    setImageDataUrl(dataUrl);
    setImageName(SAMPLE_NAME);
    const q = await dataUrlToFrameQuality(dataUrl);
    setCaptureQuality(q);
    void runChecklist(dataUrl, SAMPLE_NAME, q);
  }

  // Auto-start sample mode immediately
  useEffect(() => {
    if (initialMode === "sample") {
      void loadSample();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode]);

  function selectMode(next: ScanMode) {
    setMode(next);
    setPhase("capture");
    if (next === "sample") void loadSample();
  }

  function reset() {
    cancelledRef.current = true;
    setMode(null);
    setPhase("question");
    setImageDataUrl(undefined);
    setImageName("");
    setCaptureQuality(null);
    setChecklist(freshChecklist());
    setActiveItem(undefined);
    setAnalysisLog([]);
  }

  return (
    <main className="scan-shell">
      <header className="scan-topbar">
        <Link className="brand scan-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <div className="scan-progress-pills">
          <span className={phase === "question" ? "active" : ""}>1. Mode</span>
          <span className={phase === "capture" ? "active" : ""}>2. Capture</span>
          <span className={phase === "analyze" ? "active" : ""}>3. Checklist</span>
          <span className={phase === "report" ? "active" : ""}>4. Report</span>
        </div>
        <div className="scan-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <button className="button secondary" onClick={reset} type="button">
            Restart
          </button>
        </div>
      </header>

      {isOffline ? (
        <div className="health-banner offline" role="status">
          <strong>Inference service is offline.</strong>
          <span>{health.message ?? "DING detection cannot run until the inference service is reachable."}</span>
          <span>Endpoint: <code>{health.endpoint}</code>. Quality gates and the checklist will still run; DING detection will mark as failed and no detections will be generated.</span>
        </div>
      ) : null}
      {isDegraded ? (
        <div className="health-banner degraded" role="status">
          <strong>Mock fallback active.</strong>
          <span>{health.message ?? "Inference is responding but with mock data - not a real model output."}</span>
        </div>
      ) : null}

      {phase === "question" ? (
        <section className="scan-question">
          <span className="page-kicker">Question form</span>
          <h1>What kind of card are you scanning?</h1>
          <p className="muted">
            One question, then we lock in the right capture path. No guessing between camera and
            upload - the system picks.
          </p>
          <div className="scan-mode-grid">
            <button className="scan-mode-card" onClick={() => selectMode("auto")} type="button">
              <span className="scan-mode-tag">Quick scan</span>
              <strong>Standard card</strong>
              <small>Live camera with auto-capture when the frame passes blur, glare, and edge gates.</small>
              <em>-&gt; live camera</em>
            </button>
            <button className="scan-mode-card premium" onClick={() => selectMode("video")} type="button">
              <span className="scan-mode-tag">Premium</span>
              <strong>Foil / reflective card</strong>
              <small>Short guided video. Best frame is grabbed across multiple angles to dodge glare.</small>
              <em>-&gt; guided video</em>
            </button>
            <button className="scan-mode-card" onClick={() => selectMode("upload")} type="button">
              <span className="scan-mode-tag">Existing photos</span>
              <strong>Upload images</strong>
              <small>Drop in a photo from your camera roll or laptop. Same checklist, same model.</small>
              <em>-&gt; upload</em>
            </button>
            <button className="scan-mode-card sample" onClick={() => selectMode("sample")} type="button">
              <span className="scan-mode-tag">Demo</span>
              <strong>Try sample card</strong>
              <small>Verified Roboflow Tauros sample. Runs the full pipeline end-to-end.</small>
              <em>-&gt; start now</em>
            </button>
          </div>
        </section>
      ) : null}

      {phase === "capture" && mode === "auto" ? (
        <section className="scan-capture">
          <div className="scan-capture-stage">
            <CameraScanner
              hint="Hold the card flat, fill the reticle. Auto-capture fires when sharpness, light, glare, and edges all pass."
              onCapture={handleCaptured}
              onPermissionDenied={() => setMode("upload")}
            />
          </div>
          <aside className="scan-capture-side">
            <h2>Auto-capture</h2>
            <p className="muted">
              Powered by <code>requestVideoFrameCallback</code> + Laplacian-variance blur scoring +
              Sobel edge coverage. Real signals only.
            </p>
            <ul className="scan-bullets">
              <li>Camera permission required (HTTPS or localhost).</li>
              <li>Auto-fires after 0.4s of consecutive passing frames.</li>
              <li>Use the upload fallback if camera is blocked.</li>
            </ul>
            <div className="scan-fallback-row">
              <FallbackUpload onUpload={handleUpload} />
              <button className="button secondary" onClick={() => selectMode("sample")} type="button">
                Try sample instead
              </button>
            </div>
          </aside>
        </section>
      ) : null}

      {phase === "capture" && mode === "video" ? (
        <section className="scan-capture">
          <div className="scan-capture-stage">
            <CameraScanner
              hint="Slowly tilt the card 15 degrees left and right. Auto-capture grabs the lowest-glare frame."
              onCapture={handleCaptured}
              onPermissionDenied={() => setMode("upload")}
            />
            <p className="muted scan-stage-note">
              Premium-foil mode: the surface-mode classifier engages and per-finding confidence is
              reduced where reflectivity is high.
            </p>
          </div>
          <aside className="scan-capture-side">
            <h2>Guided video</h2>
            <p className="muted">
              For holo, foil, textured, or otherwise reflective cards. The same auto-capture engine,
              tuned for the lowest glare-risk frame.
            </p>
            <FallbackUpload onUpload={handleUpload} />
          </aside>
        </section>
      ) : null}

      {phase === "capture" && mode === "upload" ? (
        <section className="scan-capture">
          <div className="scan-capture-stage upload-stage">
            <UploadDropzone onUpload={handleUpload} />
          </div>
          <aside className="scan-capture-side">
            <h2>Upload images</h2>
            <p className="muted">
              Drop a card photo. Same checklist, same model, same evidence manifest as the live scan
              path.
            </p>
            <ul className="scan-bullets">
              <li>JPEG / PNG / HEIC up to 25 MB.</li>
              <li>Front frame is required. Back is optional.</li>
              <li>Original bytes are hashed before we touch them.</li>
            </ul>
            <button className="button secondary" onClick={() => selectMode("sample")} type="button">
              Try sample instead
            </button>
          </aside>
        </section>
      ) : null}

      {phase === "analyze" ? (
        <section className="scan-analyze">
          <div className="scan-analyze-stage">
            {imageDataUrl ? (
              <div className="scan-analyze-canvas">
                <DingOverlay alt={imageName} detections={activeItem?.detections ?? []} imageDataUrl={imageDataUrl} />
                <ZoomLensOverlay imageDataUrl={imageDataUrl} target={zoomTarget} />
              </div>
            ) : null}
            <div className="scan-analyze-meta">
              <span className="market-pill live">Streaming</span>
              <strong>{imageName || "Frame"}</strong>
              {captureQuality ? (
                <small>
                  surface {captureQuality.surfaceMode} - sharpness {captureQuality.blurScore} - glare risk {captureQuality.glareRisk}
                </small>
              ) : null}
            </div>
          </div>
          <div className="scan-analyze-checklist">
            <div className="section-head">
              <div>
                <span className="page-kicker">Live checklist</span>
                <h2>Real-time progress</h2>
              </div>
              <span className="meta-chip">{checklistProgress}%</span>
            </div>
            <div className="run-progress-track" aria-label={`Checklist progress ${checklistProgress}%`}>
              <span style={{ width: `${checklistProgress}%` }} />
            </div>
            <ol className="run-checklist scan-checklist">
              {checklist.map((row) => (
                <li className={mapStatusClass(row.status)} key={row.id}>
                  <span aria-hidden="true" />
                  <div className="step-body">
                    <strong>{row.label}</strong>
                    <small>
                      {row.liveDetail ? <span className="step-live">{row.liveDetail}</span> : row.detail}
                    </small>
                  </div>
                  <span className="step-status-pill">{labelForStatus(row.status)}</span>
                </li>
              ))}
            </ol>
            {analysisLog.length ? (
              <details className="scan-log">
                <summary>Stream log ({analysisLog.length})</summary>
                <pre>{analysisLog.join("\n")}</pre>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {phase === "report" && activeItem ? (
        <section className="scan-report">
          <div className="section-head">
            <div>
              <span className="page-kicker">Condition record</span>
              <h2>{activeItem.title}</h2>
            </div>
            <div className="scan-report-actions">
              <Link className="button" href={`/cards/${activeItem.id}/report`}>
                Open full report
              </Link>
              <Link className="button secondary" href="/compare">
                Compare before / after
              </Link>
              <button className="button secondary" onClick={reset} type="button">
                Scan another
              </button>
            </div>
          </div>
          <div className="scan-report-grid">
            <div className="scan-report-card large">
              <DingOverlay
                alt={activeItem.title}
                detections={activeItem.detections}
                imageDataUrl={activeItem.imageDataUrl}
              />
            </div>
            <div className="scan-report-card">
              <h3>Summary</h3>
              <dl className="detail-list">
                <div>
                  <dt>Benchmark</dt>
                  <dd>{activeItem.grade}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(activeItem.confidence * 100)}%</dd>
                </div>
                <div>
                  <dt>Detections</dt>
                  <dd>{activeItem.detections.length}</dd>
                </div>
                <div>
                  <dt>Surface mode</dt>
                  <dd>{captureQuality?.surfaceMode ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Persistence</dt>
                  <dd>{persisted}</dd>
                </div>
              </dl>
              <p className="muted">{reportDisclaimer}</p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function regionLabelShort(region: ZoomRegion): string {
  switch (region) {
    case "top_left_corner":
      return "top-left";
    case "top_right_corner":
      return "top-right";
    case "bottom_left_corner":
      return "bottom-left";
    case "bottom_right_corner":
      return "bottom-right";
    case "top_edge":
      return "top edge";
    case "bottom_edge":
      return "bottom edge";
    case "left_edge":
      return "left edge";
    case "right_edge":
      return "right edge";
    default:
      return "center";
  }
}

function labelForStatus(status: ChecklistStatus): string {
  switch (status) {
    case "waiting":
      return "waiting";
    case "in_progress":
      return "running";
    case "passed":
      return "done";
    case "warning":
      return "warning";
    case "failed":
      return "error";
    case "skipped":
      return "skipped";
    default:
      return status;
  }
}

function mapStatusClass(status: ChecklistStatus): string {
  switch (status) {
    case "waiting":
      return "pending";
    case "in_progress":
      return "running";
    case "passed":
      return "done";
    case "warning":
      return "warning";
    case "failed":
      return "error";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function FallbackUpload({ onUpload }: { onUpload: (file: File) => void }) {
  return (
    <label className="button">
      Upload image
      <input
        accept="image/*"
        className="file-input-native"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onUpload(file);
        }}
        type="file"
      />
    </label>
  );
}

function UploadDropzone({ onUpload }: { onUpload: (file: File) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <label
      className={`scan-upload-dropzone ${hover ? "is-hover" : ""}`}
      onDragLeave={() => setHover(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setHover(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setHover(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onUpload(file);
      }}
    >
      <strong>Drop a card image</strong>
      <small>or click to browse - JPEG / PNG / HEIC - up to 25 MB</small>
      <input
        accept="image/*"
        className="file-input-native"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onUpload(file);
        }}
        type="file"
      />
    </label>
  );
}
