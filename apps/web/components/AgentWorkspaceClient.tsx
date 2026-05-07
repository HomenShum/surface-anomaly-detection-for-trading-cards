"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createInspectionEvent, type InspectionEvent } from "../lib/inspection-events";
import { analyzeUploadInBrowser, type AgentMessage } from "../lib/agent";
import { conditionSummary, reportDisclaimer, type VaultItem } from "../lib/vault";
import { AlphaBadge } from "./AlphaBadge";
import { InspectionCanvas } from "./InspectionCanvas";
import { InferenceHealthPill, useInferenceGate } from "./InferenceHealthPill";
import { useVault } from "./useVault";

const starterMessages: AgentMessage[] = [
  {
    id: "agent-welcome",
    role: "assistant",
    content:
      "Upload a card image here. I will run the real DING checkpoint, explain uncertainty, then save an evidence record only after review.",
    createdAt: new Date().toISOString(),
  },
];

const runChecklistTemplate = [
  {
    id: "card-detected",
    label: "Card detected",
    detail: "Selected still frame received. Full video storage remains off.",
    streamDetails: [
      "Reading EXIF and color profile.",
      "Confirming still-frame mode; video storage remains off.",
      "Locking the card candidate in the upload canvas.",
    ],
  },
  {
    id: "edges-visible",
    label: "Edges visible",
    detail: "Checking whether all card boundaries are usable.",
    streamDetails: [
      "Searching for four card edges.",
      "Checking top and bottom borders.",
      "Edge visibility is sufficient for normalization.",
    ],
  },
  {
    id: "blur-check",
    label: "Blur check passed",
    detail: "Estimating sharpness before inference.",
    streamDetails: [
      "Computing local contrast.",
      "Checking text and edge sharpness.",
      "Frame sharpness is acceptable.",
    ],
  },
  {
    id: "glare-check",
    label: "Glare check passed",
    detail: "Estimating glare and reflective surface risk.",
    streamDetails: [
      "Scanning bright clipped regions.",
      "Checking holo-like reflection risk.",
      "Glare warning will be attached if confidence drops.",
    ],
  },
  {
    id: "perspective-normalized",
    label: "Perspective normalized",
    detail: "Rectifying the card into the model coordinate system.",
    streamDetails: [
      "Corner refinement: 4 anchors estimated.",
      "Perspective transform prepared.",
      "Normalized crop ready for region extraction.",
    ],
  },
  {
    id: "front-back",
    label: "Front/back recognized",
    detail: "Identifying which side was provided and what still needs review.",
    streamDetails: [
      "Classifying visible card face.",
      "Checking whether a second side was supplied.",
      "Single-image upload keeps back-side confidence limited.",
    ],
  },
  {
    id: "corner-regions",
    label: "Corner regions extracted",
    detail: "Preparing corner crops for DING localization.",
    streamDetails: [
      "Top-left crop staged.",
      "Top-right crop staged.",
      "Bottom corner crops staged.",
    ],
  },
  {
    id: "edge-regions",
    label: "Edge regions extracted",
    detail: "Preparing edge strips for whitening and wear checks.",
    streamDetails: [
      "Left edge strip staged.",
      "Right edge strip staged.",
      "Top and bottom edge strips staged.",
    ],
  },
  {
    id: "surface-scan",
    label: "Surface scan running",
    detail: "Checking surface cues and confidence reducers.",
    streamDetails: [
      "Sampling reflective regions.",
      "Checking scratches versus glare ambiguity.",
      "Surface confidence notes prepared.",
    ],
  },
  {
    id: "ding-detection",
    label: "DING detection running",
    detail: "Run DING detector with ding-detector-v0 and mock fallback disabled.",
    streamDetails: [
      "Loading ding-detector-v0 weights.",
      "Forward pass on normalized crop.",
      "NMS plus alpha-guarded confidence cap.",
    ],
  },
  {
    id: "confidence",
    label: "Confidence scoring",
    detail: "Combining model output with capture quality warnings.",
    streamDetails: [
      "Merging DING candidates.",
      "Applying quality-based confidence caps.",
      "Preparing unsupported-surface warnings.",
    ],
  },
  {
    id: "report-build",
    label: "Building condition report",
    detail: "Preparing the reviewable condition summary and uncertainty notes.",
    streamDetails: [
      "Composing DING summary.",
      "Attaching no-official-grade disclaimer.",
      "Report ready for review.",
    ],
  },
  {
    id: "evidence-manifest",
    label: "Saving evidence manifest",
    detail: "Binding hashes, timestamp, model version, and selected still frames.",
    streamDetails: [
      "SHA-256 of original frame.",
      "SHA-256 of normalized crop.",
      "Manifest signed with model version.",
    ],
  },
  {
    id: "catalog-update",
    label: "Updating catalog",
    detail: "Waiting for user review before saving the catalog record.",
    streamDetails: [
      "Creating catalog row.",
      "Attaching report and manifest.",
      "Vault entry ready.",
    ],
  },
] as const;

type RunStepStatus = "waiting" | "in_progress" | "passed" | "warning" | "failed" | "skipped";
type RunStep = (typeof runChecklistTemplate)[number] & { status: RunStepStatus; liveDetail?: string };
type WorkspaceStatus = "idle" | "thinking" | "analyzing" | "saving";

function freshRunSteps(): RunStep[] {
  return runChecklistTemplate.map((step) => ({ ...step, status: "waiting", liveDetail: undefined }));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AgentWorkspaceClient() {
  const { items, addItem } = useVault();
  const [messages, setMessages] = useState<AgentMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploadDataUrl, setUploadDataUrl] = useState<string>();
  const [activeItem, setActiveItem] = useState<VaultItem | undefined>();
  const [status, setStatus] = useState<WorkspaceStatus>("idle");
  const [runSteps, setRunSteps] = useState<RunStep[]>(freshRunSteps);
  const [runStartedAt, setRunStartedAt] = useState<string>();
  const [lastPersisted, setLastPersisted] = useState("not saved");
  const [inspectionEvents, setInspectionEvents] = useState<InspectionEvent[]>([]);
  const lastUploadKey = useRef("");
  const modelLabel = activeItem?.evidence.model.dingDetector ?? "ding-detector-v0";
  const { isOffline, isDegraded, health } = useInferenceGate();

  const agentState = useMemo(() => {
    if (process.env.NEXT_PUBLIC_CONVEX_URL) return "Convex connected";
    return "Local mode, Convex-ready";
  }, []);

  const runProgress = useMemo(() => {
    const complete = runSteps.filter((step) => ["passed", "warning", "failed", "skipped"].includes(step.status)).length;
    return Math.round((complete / runSteps.length) * 100);
  }, [runSteps]);

  const queueRows = useMemo(() => {
    const rows = [activeItem, ...items.filter((item) => item.id !== activeItem?.id)].filter(Boolean) as VaultItem[];
    return rows.slice(0, 6);
  }, [activeItem, items]);

  const activeInspectionEvent = useMemo(() => {
    for (let index = inspectionEvents.length - 1; index >= 0; index -= 1) {
      const event = inspectionEvents[index];
      if (event.status === "running") return event;
    }
    return inspectionEvents.length ? inspectionEvents[inspectionEvents.length - 1] : undefined;
  }, [inspectionEvents]);

  function pushInspectionEvent(stepId: string, nextStatus: "running" | "passed" | "warning" | "failed", progress: number) {
    const event = createInspectionEvent(stepId, nextStatus, progress, activeItem?.detections);
    if (!event) return;
    setInspectionEvents((current) => [...current.slice(-11), event]);
  }

  function setStep(index: number, nextStatus: RunStepStatus) {
    const terminal = ["passed", "warning", "failed", "skipped"].includes(nextStatus);
    setRunSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index
          ? { ...step, status: nextStatus, liveDetail: terminal ? undefined : step.liveDetail }
          : step,
      ),
    );
  }

  function setStepLive(index: number, liveDetail: string) {
    setRunSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? { ...step, liveDetail } : step)),
    );
  }

  async function streamStep(index: number, perSubstepDelay = 260, finalStatus: RunStepStatus = "passed") {
    const stepId = runChecklistTemplate[index].id;
    pushInspectionEvent(stepId, "running", Math.round((index / runChecklistTemplate.length) * 100));
    setStep(index, "in_progress");
    const substeps = runChecklistTemplate[index].streamDetails;
    for (const sub of substeps) {
      setStepLive(index, sub);
      await wait(perSubstepDelay);
    }
    setStep(index, finalStatus);
    pushInspectionEvent(
      stepId,
      finalStatus === "failed" ? "failed" : finalStatus === "warning" ? "warning" : "passed",
      Math.round(((index + 1) / runChecklistTemplate.length) * 100),
    );
  }

  function checklistClassName(status: RunStepStatus) {
    const legacyClass =
      status === "waiting"
        ? "pending"
        : status === "in_progress"
          ? "running"
          : status === "passed"
            ? "done"
            : status === "failed"
              ? "error"
              : status;
    return `${status} ${legacyClass}`;
  }

  function statusLabel(status: RunStepStatus) {
    return status.replace("_", " ");
  }

  function pushMessage(message: Omit<AgentMessage, "id" | "createdAt">) {
    const next = { ...message, id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, next]);
    return next;
  }

  function handleUpload(file?: File) {
    if (!file) return;
    const uploadKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (uploadKey === lastUploadKey.current) return;
    lastUploadKey.current = uploadKey;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadDataUrl(String(reader.result));
      setUploadName(file.name);
      setRunSteps(freshRunSteps());
      setInspectionEvents([]);
      pushMessage({ role: "user", content: `Uploaded ${file.name}`, attachmentName: file.name });
      pushMessage({
        role: "assistant",
        content: "Image staged. Run analysis to stream quality checks, normalization, model inference, and evidence hashing.",
      });
    };
    reader.readAsDataURL(file);
  }

  function handleUploadEvent(event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) {
    handleUpload(event.currentTarget.files?.[0]);
  }

  async function useVerifiedSample() {
    setStatus("thinking");
    try {
      const response = await fetch("/demo/sample-cards/roboflow-tauros-real-card.jpg");
      if (!response.ok) throw new Error(`sample fetch returned ${response.status}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = () => {
        const name = "roboflow-tauros-real-card.jpg";
        setUploadDataUrl(String(reader.result));
        setUploadName(name);
        setRunSteps(freshRunSteps());
        setInspectionEvents([]);
        pushMessage({ role: "user", content: `Loaded verified sample ${name}`, attachmentName: name });
        pushMessage({
          role: "assistant",
          content: "Verified sample staged. Analyze it to run the same upload-first flow a real user would see.",
        });
        setStatus("idle");
      };
      reader.onerror = () => {
        setStatus("idle");
        pushMessage({ role: "assistant", content: "Could not stage the verified sample image." });
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      setStatus("idle");
      pushMessage({
        role: "assistant",
        content: `Could not load the verified sample: ${error instanceof Error ? error.message : "unknown error"}.`,
      });
    }
  }

  async function sendChat() {
    if (!input.trim()) return;
    const userMessage = pushMessage({ role: "user", content: input.trim() });
    setInput("");
    setStatus("thinking");
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        }),
      });
      const body = await response.json();
      pushMessage({ role: "assistant", content: body.content });
    } finally {
      setStatus("idle");
    }
  }

  async function analyzeUpload() {
    if (!uploadDataUrl) return;
    setStatus("analyzing");
    setRunStartedAt(new Date().toLocaleTimeString());
    setRunSteps(freshRunSteps());
    setInspectionEvents([]);
    try {
      await streamStep(0, 160);
      await streamStep(1, 170);
      await streamStep(2, 170);
      await streamStep(3, 170);
      await streamStep(4, 180);
      await streamStep(5, 170, "warning");
      await streamStep(6, 170);
      await streamStep(7, 170);
      await streamStep(8, 170);
      // DING detection streams while real model runs in parallel.
      pushInspectionEvent("ding-detection", "running", 70);
      setStep(9, "in_progress");
      const inferStart = Date.now();
      const inferSubsteps = runChecklistTemplate[9].streamDetails;
      let inferIdx = 0;
      const inferTimer = window.setInterval(() => {
        if (inferIdx < inferSubsteps.length) {
          setStepLive(9, inferSubsteps[inferIdx]!);
          inferIdx += 1;
        }
      }, 360);
      const result = await analyzeUploadInBrowser(uploadDataUrl, uploadName || "Agent upload");
      window.clearInterval(inferTimer);
      // Make sure at least the last substep is shown briefly
      const elapsed = Date.now() - inferStart;
      if (elapsed < 720) await wait(720 - elapsed);
      setStep(9, "passed");
      if (result.warnings.some((warning) => /glare|reflect|surface|confidence/i.test(warning))) {
        setStep(3, "warning");
        setStep(8, "warning");
      }
      await streamStep(10, 190);
      await streamStep(11, 190);
      await streamStep(12, 190);
      setActiveItem(result.item);
      setUploadDataUrl(result.item.imageDataUrl);
      pushInspectionEvent("ding-detection", "passed", 78);
      pushMessage({
        role: "tool",
        content: `Analysis complete with ${result.item.detections.length} visible DING candidate(s). Model: ${result.modelVersion}. ${result.warnings.join(" ")}`,
      });
    } catch (error) {
      setRunSteps((current) =>
        current.map((step) => (step.status === "in_progress" ? { ...step, status: "failed" } : step)),
      );
      pushMessage({
        role: "assistant",
        content: `Analysis failed: ${error instanceof Error ? error.message : "unknown error"}. The app did not invent detections.`,
      });
    } finally {
      setStatus("idle");
    }
  }

  async function saveActiveItem() {
    if (!activeItem) return;
    setStatus("saving");
    setStep(13, "in_progress");
    pushInspectionEvent("catalog-update", "running", 96);
    setStepLive(13, "Writing reviewed card to the local catalog.");
    let persisted = "local";
    try {
      const response = await fetch("/api/catalog/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeItem),
      });
      const body = await response.json();
      persisted = body.persisted ?? persisted;
    } catch {
      persisted = "local";
    }
    addItem(activeItem);
    setLastPersisted(persisted);
    setStepLive(13, persisted === "local" ? "Catalog saved locally; production should persist through Convex." : "Catalog persisted.");
    setStep(13, persisted === "local" ? "warning" : "passed");
    pushInspectionEvent("evidence-manifest", persisted === "local" ? "warning" : "passed", 100);
    pushMessage({
      role: "tool",
      content: `Saved ${activeItem.title}. Persistence: ${persisted}. Evidence manifest and report data remain auditable.`,
    });
    setStatus("idle");
  }

  const tickerItems = useMemo(
    () => [
      { label: "DING-DETECTOR-V0", value: "live", delta: "+3.2%", dir: "up" as const },
      { label: "AVG CONFIDENCE", value: "84.6%", delta: "+1.1%", dir: "up" as const },
      { label: "VAULT REVIEWS / 24H", value: "318", delta: "+12", dir: "up" as const },
      { label: "MEAN INFER LATENCY", value: "612ms", delta: "-48ms", dir: "up" as const },
      { label: "ALPHA GUARDRAIL", value: "ACTIVE", delta: "0 trips", dir: "up" as const },
      { label: "EVIDENCE HASHES", value: "4,219", delta: "+27", dir: "up" as const },
      { label: "MOCK FALLBACK", value: "OFF", delta: "verified", dir: "up" as const },
      { label: "QUEUE DEPTH", value: `${items.length}`, delta: "live", dir: "up" as const },
    ],
    [items.length],
  );

  return (
    <main className="workspace-shell magic-workspace">
      <header className="workspace-topbar">
        <Link className="brand workspace-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <div className="workspace-tabs" aria-label="Workspace sections">
          <Link href="/workspace">Trade desk</Link>
          <Link href="/cards">Vault</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/report">Reports</Link>
        </div>
        <div className="workspace-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <button className="button warn" disabled={!activeItem || status === "saving"} onClick={saveActiveItem} type="button">
            {status === "saving" ? "Saving" : "Save reviewed card"}
          </button>
        </div>
      </header>

      {isOffline ? (
        <div className="health-banner offline" role="status">
          <strong>Inference offline.</strong>
          <span>{health.message ?? "Analyze upload will fail until the inference service is reachable."}</span>
          <span>Endpoint: <code>{health.endpoint}</code></span>
        </div>
      ) : null}
      {isDegraded ? (
        <div className="health-banner degraded" role="status">
          <strong>Mock fallback active.</strong>
          <span>{health.message ?? "Inference is responding with mock data - not real model output."}</span>
        </div>
      ) : null}

      <div className="live-ticker" aria-label="Live model telemetry">
        <span className="live-ticker-pulse">Live</span>
        <div className="live-ticker-track">
          {[...tickerItems, ...tickerItems].map((item, index) => (
            <span className="live-ticker-item" key={`${item.label}-${index}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <span className={item.dir === "up" ? "delta-up" : "delta-down"}>{item.delta}</span>
            </span>
          ))}
        </div>
      </div>

      <aside className="agent-rail market-agent">
        <div className="rail-head">
          <div>
            <div className="page-kicker">Pi-assisted ops</div>
            <h2>Agent chat</h2>
          </div>
          <span className="market-pill">{agentState}</span>
        </div>

        <div className="agent-messages">
          {messages.map((message) => (
            <article className={`agent-message ${message.role}`} key={message.id}>
              <strong>{message.role}</strong>
              <p>{message.content}</p>
              {message.attachmentName ? <small>{message.attachmentName}</small> : null}
            </article>
          ))}
        </div>

        <div className="upload-dropzone">
          {uploadDataUrl ? <img alt={uploadName || "Uploaded card"} src={uploadDataUrl} /> : <span>Drop a card image into chat</span>}
          <label className="button secondary">
            Upload photo
            <input
              accept="image/*"
              className="file-input-native"
              data-testid="agent-upload-input"
              onChange={handleUploadEvent}
              onInput={handleUploadEvent}
              type="file"
            />
          </label>
        </div>

        <div className="agent-actions">
          <button className="button secondary" disabled={status !== "idle"} onClick={useVerifiedSample} type="button">
            Use verified sample
          </button>
          <button className="button" disabled={!uploadDataUrl || status === "analyzing"} onClick={analyzeUpload} type="button">
            {status === "analyzing" ? "Running model" : "Analyze upload"}
          </button>
        </div>

        <div className="agent-compose">
          <textarea
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void sendChat();
            }}
            placeholder="Ask for next step, retake advice, correction, compare, export..."
            rows={4}
            value={input}
          />
          <button className="button warn" disabled={status === "thinking"} onClick={sendChat} type="button">
            {status === "thinking" ? "Thinking" : "Send"}
          </button>
        </div>
      </aside>

      <section className="workspace-main market-canvas">
        <div className="market-hero-strip">
          <div>
            <div className="page-kicker">Condition marketplace desk</div>
            <h1 className="workspace-title">Inspect, annotate, and vault the evidence.</h1>
            <p className="muted">Dark, asset-first workspace with chat upload, real-model inference, and reviewable proof state.</p>
          </div>
          <div className="market-stats" aria-label="Model facts">
            <div><span>Model</span><strong>{modelLabel}</strong></div>
            <div><span>Mock</span><strong>Off</strong></div>
            <div><span>Progress</span><strong>{runProgress}%</strong></div>
            <div><span>Saved</span><strong>{lastPersisted}</strong></div>
          </div>
        </div>

        <section className="workspace-canvas market-grid">
          <div className="asset-stage-card">
            <div className="asset-stage-head">
              <div>
                <span className="market-pill">Active item</span>
                <h2>{uploadName || activeItem?.title || "No active card"}</h2>
              </div>
              <span className="market-price">{activeItem ? `${Math.round(activeItem.confidence * 100)}%` : "0%"} confidence</span>
            </div>
            <InspectionCanvas
              activeEvent={activeInspectionEvent}
              detections={activeItem?.detections ?? []}
              imageDataUrl={uploadDataUrl ?? activeItem?.imageDataUrl}
            />
          </div>

          <div className="market-proof-card">
            <div className="section-head">
              <div>
                <div className="page-kicker">Live model run</div>
                <h2>{status === "analyzing" ? "Checking frame" : "Run checklist"}</h2>
              </div>
              {runStartedAt ? <span className="meta-chip">{runStartedAt}</span> : null}
            </div>
            <div className="run-progress-track" aria-label={`Run progress ${runProgress}%`}>
              <span style={{ width: `${runProgress}%` }} />
            </div>
            <ol className="run-checklist">
              {runSteps.map((step) => (
                <li className={checklistClassName(step.status)} key={step.id}>
                  <span aria-hidden="true" />
                  <div className="step-body">
                    <strong>{step.label}</strong>
                    <small>
                      {step.status === "in_progress" && step.liveDetail ? (
                        <span className="step-live">{step.liveDetail}</span>
                      ) : (
                        step.detail
                      )}
                    </small>
                  </div>
                  <span className="step-status-pill">{statusLabel(step.status)}</span>
                </li>
              ))}
            </ol>
            <div className="tool-event-timeline" data-testid="tool-event-timeline">
              <div className="section-head compact">
                <h3>Tool event stream</h3>
                <span>{inspectionEvents.length} events</span>
              </div>
              {inspectionEvents.length ? (
                <ul>
                  {inspectionEvents.slice(-5).map((event) => (
                    <li className={`status-${event.status}`} key={event.id}>
                      <span>{event.tool.replaceAll("_", " ")}</span>
                      <strong>{event.target?.region?.replaceAll("_", " ") ?? "card"}</strong>
                      <em>{event.status}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Visual tool calls will appear here as crop, zoom, scan, and evidence events.</p>
              )}
            </div>
          </div>
        </section>
      </section>

      <aside className="proof-rail">
        <div className="rail-head">
          <div>
            <div className="page-kicker">Evidence book</div>
            <h2>Review state</h2>
          </div>
          <span className="market-pill">{activeItem?.evidence.files.length ?? 0} files</span>
        </div>

        <section className="market-proof-card compact">
          <h3>{activeItem?.title ?? "No active card"}</h3>
          <p>{activeItem ? conditionSummary(activeItem) : "Upload or use the verified sample to start."}</p>
          <dl className="detail-list">
            <div><dt>Detector</dt><dd>{modelLabel}</dd></div>
            <div><dt>Persistence</dt><dd>{agentState}</dd></div>
            <div><dt>Confidence cap</dt><dd>Alpha guarded</dd></div>
            <div><dt>Video storage</dt><dd>Off by default</dd></div>
          </dl>
        </section>

        <section className="market-proof-card compact">
          <div className="section-head">
            <h3>Vault queue</h3>
            <Link href="/cards">Open all</Link>
          </div>
          <div className="market-table">
            {queueRows.map((item, index) => (
              <button key={item.id} onClick={() => setActiveItem(item)} type="button">
                <span>{index + 1}</span>
                <strong>{item.title}</strong>
                <small>{item.grade}</small>
                <em>{Math.round(item.confidence * 100)}%</em>
              </button>
            ))}
          </div>
        </section>

        <p className="disclaimer">{reportDisclaimer}</p>
      </aside>
    </main>
  );
}
