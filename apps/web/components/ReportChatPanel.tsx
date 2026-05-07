"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentReportContext } from "../lib/agent/tools";
import { RewardToast } from "./RewardToast";

type ToolCallTraceUI = {
  tool: string;
  argsKeys: string[];
  durationMs: number;
  ok: boolean;
  resultSummary?: string;
};

type ZoomAction = { kind: "zoom"; region: string; bbox: [number, number, number, number]; label?: string };
type CropPreviewAction = {
  kind: "preview_crop";
  cropId: string;
  cropDataUrl: string;
  region: string;
  label?: string;
  width: number;
  height: number;
};
type RerunResultAction = {
  kind: "rerun_result";
  cropId: string;
  findingsCount: number;
  modelVersion: string;
};
type UIAction = ZoomAction | CropPreviewAction | RerunResultAction;

type AssistantTurn = {
  id: string;
  role: "assistant";
  content: string;
  provider: string;
  toolTraces: ToolCallTraceUI[];
  proposedSkillIds: string[];
  uiActions: UIAction[];
  error?: string;
};

type UserTurn = { id: string; role: "user"; content: string; couldBeMethod: boolean };

type Turn = UserTurn | AssistantTurn;

type SubmittedMethodPayload = {
  skillId: string;
  title: string;
  publicRemark: string;
  contributorHandle: string;
  consentPublicAttribution: boolean;
};

function SubmitMethodCTA({
  rawRemark,
  contributorHandle,
  reportContext,
  onSubmitted,
}: {
  rawRemark: string;
  contributorHandle: string;
  reportContext: AgentReportContext;
  onSubmitted: (payload: SubmittedMethodPayload) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SubmittedMethodPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState(contributorHandle);

  if (done) {
    return (
      <div className="chat-method-cta chat-method-cta--done" role="status">
        <strong>Method candidate submitted</strong>
        <p>{done.publicRemark}</p>
        <small>
          Logged as <code>{done.skillId}</code>. It will appear on the public methods board after benchmark + human
          review. Attribution: @{done.contributorHandle}
          {done.consentPublicAttribution ? "" : " (private until you opt in)"}.
        </small>
      </div>
    );
  }

  if (!opened) {
    return (
      <button
        className="chat-method-cta-button"
        onClick={() => setOpened(true)}
        type="button"
      >
        Submit this as a method candidate →
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/methods/submit-from-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawRemark,
          contributorHandle: handle,
          contributorDisplayName: handle,
          consentPublicAttribution: consent,
          reportContext: { finishType: reportContext.finishType },
        }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error ?? "submit failed");
      const payload: SubmittedMethodPayload = {
        skillId: body.skillId,
        title: body.title,
        publicRemark: body.publicRemark,
        contributorHandle: body.contributorHandle,
        consentPublicAttribution: body.consentPublicAttribution,
      };
      setDone(payload);
      onSubmitted(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-method-cta">
      <strong>Submit as a method candidate</strong>
      <p>
        We rewrite your message into a public-safe summary. The raw text and any image bytes stay private. Benchmark +
        human review gate any production rollout.
      </p>
      <label className="chat-method-cta-row">
        <span>Handle</span>
        <input onChange={(event) => setHandle(event.target.value)} value={handle} type="text" />
      </label>
      <label className="chat-method-cta-row chat-method-cta-consent">
        <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
        <span>Allow public attribution to my handle when this method is verified.</span>
      </label>
      <div className="chat-method-cta-actions">
        <button className="button warn" disabled={busy || !handle.trim()} onClick={submit} type="button">
          {busy ? "Submitting…" : "Submit candidate"}
        </button>
        <button className="button secondary" disabled={busy} onClick={() => setOpened(false)} type="button">
          Cancel
        </button>
      </div>
      {error ? <small className="chat-method-cta-error">{error}</small> : null}
    </div>
  );
}

function looksLikeMethodProposal(message: string): boolean {
  const lc = message.toLowerCase();
  const triggers = [
    /\b(maybe (you|the agent|it) should|what if|why don't|why not|try( |ing) to|you could|let's|let me|how about)\b/,
    /\b(crop|zoom|rotate|tilt|mask|filter|enhance|compare|rerun|re-run)\b/,
    /\b(method|workflow|pattern|technique|approach|trick|hack)\b/,
    /\b(should|could) (try|test|use|do|run)\b/,
  ];
  return triggers.filter((re) => re.test(lc)).length >= 2;
}

type Props = {
  reportContext: AgentReportContext;
  userId?: string;
  /** Called when the agent fires a zoom action so the parent can drive ZoomLensOverlay. */
  onZoomAction?: (action: ZoomAction) => void;
};

const SUGGESTIONS = [
  "What are the biggest issues?",
  "Is that really a scratch or just glare?",
  "Is this worth grading?",
  "What should I retake?",
  "Build a dispute summary",
  "Show me the top-left corner",
];

function toolEmoji(name: string): string {
  if (name === "request_zoom_animation") return "🔍";
  if (name === "evaluate_glare_risk") return "✦";
  if (name === "get_finding_detail") return "□";
  if (name === "cite_evidence") return "#";
  if (name === "lookup_promoted_skill") return "★";
  if (name === "compare_to_baseline") return "≈";
  if (name === "recommend_retake") return "📷";
  if (name === "propose_inspection_method") return "✎";
  return "·";
}

export function ReportChatPanel({ reportContext, userId, onZoomAction }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingZoom, setPendingZoom] = useState<ZoomAction | null>(null);
  const [candidateToastIds, setCandidateToastIds] = useState<string[]>([]);
  const [submittedMethods, setSubmittedMethods] = useState<SubmittedMethodPayload[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  async function ask(message: string) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    const userTurn: UserTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      couldBeMethod: looksLikeMethodProposal(trimmed),
    };
    const history = turns.slice(-6).map((turn) => ({
      role: turn.role,
      content: turn.role === "assistant" ? turn.content : turn.content,
    })) as Array<{ role: "user" | "assistant"; content: string }>;
    setTurns((previous) => [...previous, userTurn]);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/agent/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history, reportContext, userId }),
      });
      const body = await response.json();
      const assistantTurn: AssistantTurn = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: String(body.content ?? "No response."),
        provider: String(body.provider ?? "unknown"),
        toolTraces: Array.isArray(body.toolTraces) ? body.toolTraces : [],
        proposedSkillIds: Array.isArray(body.proposedSkillIds) ? body.proposedSkillIds : [],
        uiActions: Array.isArray(body.uiActions) ? body.uiActions : [],
        error: typeof body.error === "string" ? body.error : undefined,
      };

      // Fire zoom actions sequentially so user sees each one.
      for (const action of assistantTurn.uiActions) {
        if (action.kind === "zoom") {
          setPendingZoom(action);
          onZoomAction?.(action);
          await new Promise((res) => setTimeout(res, 1200));
        }
      }
      setPendingZoom(null);
      setTurns((previous) => [...previous, assistantTurn]);
      if (assistantTurn.proposedSkillIds.length > 0) {
        setCandidateToastIds(assistantTurn.proposedSkillIds);
      }
      // Surface the post-turn memory summary in the dev console for debugging.
      if (typeof body.memorySummary === "string" && body.memorySummary.length > 0) {
        // eslint-disable-next-line no-console
        console.debug("[memory]", body.memorySummary);
      }
    } catch (error) {
      const errorTurn: AssistantTurn = {
        id: `a-err-${Date.now()}`,
        role: "assistant",
        content: `Inspection agent unavailable: ${error instanceof Error ? error.message : "unknown error"}.`,
        provider: "error",
        toolTraces: [],
        proposedSkillIds: [],
        uiActions: [],
      };
      setTurns((previous) => [...previous, errorTurn]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="report-chat" aria-label="Report inspection chat">
      {candidateToastIds.length > 0 ? (
        <RewardToast key={candidateToastIds.join(":")} variant="candidate" candidateIds={candidateToastIds} delayMs={0} />
      ) : null}
      <header className="report-chat-head">
        <div>
          <span className="page-kicker">Pi-assisted inspector</span>
          <h2>Inspection chat</h2>
        </div>
        <span className="meta-chip">Self-evolving · candidates logged</span>
      </header>

      <div className="report-chat-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            className="suggestion-chip"
            disabled={loading}
            key={suggestion}
            onClick={() => void ask(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="report-chat-transcript" ref={transcriptRef}>
        {turns.length === 0 ? (
          <p className="muted report-chat-empty">
            Ask anything about this report. The agent will look at findings, fire the zoom-lens on the regions it inspects, cite evidence, and propose reusable inspection skills when it spots a useful pattern. Proposed skills are NOT activated automatically — they go to a draft queue for benchmark + human review.
          </p>
        ) : (
          turns.map((turn) =>
            turn.role === "user" ? (
              <div className="chat-bubble chat-bubble--user" key={turn.id}>
                <span className="chat-role">You</span>
                <p>{turn.content}</p>
                {turn.couldBeMethod ? (
                  <SubmitMethodCTA
                    rawRemark={turn.content}
                    contributorHandle={userId ?? "anon"}
                    reportContext={reportContext}
                    onSubmitted={(payload) => {
                      setSubmittedMethods((previous) => [...previous, payload]);
                      setCandidateToastIds([payload.skillId]);
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="chat-bubble chat-bubble--assistant" key={turn.id}>
                <span className="chat-role">
                  Agent <em className="chat-provider">{turn.provider}</em>
                </span>
                {turn.toolTraces.length > 0 ? (
                  <ul className="chat-tool-list">
                    {turn.toolTraces.map((trace, idx) => (
                      <li className={trace.ok ? "ok" : "fail"} key={`${turn.id}-tool-${idx}`}>
                        <span className="chat-tool-emoji">{toolEmoji(trace.tool)}</span>
                        <code>{trace.tool}</code>
                        {trace.argsKeys.length > 0 ? (
                          <em className="chat-tool-args">{trace.argsKeys.join(", ")}</em>
                        ) : null}
                        <span className="chat-tool-ms">{trace.durationMs}ms</span>
                        {trace.resultSummary ? (
                          <small className="chat-tool-summary">{trace.resultSummary}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {turn.uiActions.some((a) => a.kind === "preview_crop" || a.kind === "rerun_result") ? (
                  <div className="chat-pixel-actions">
                    {turn.uiActions
                      .filter((action): action is CropPreviewAction => action.kind === "preview_crop")
                      .map((action) => (
                        <figure className="chat-crop-preview" key={`${turn.id}-crop-${action.cropId}`}>
                          <img alt={`Crop of ${action.label ?? action.region}`} src={action.cropDataUrl} />
                          <figcaption>
                            <span className="chat-crop-region">{action.region.replaceAll("_", " ")}</span>
                            <span className="chat-crop-meta">
                              {action.width}×{action.height} · <code>{action.cropId.slice(0, 12)}…</code>
                            </span>
                          </figcaption>
                        </figure>
                      ))}
                    {turn.uiActions
                      .filter((action): action is RerunResultAction => action.kind === "rerun_result")
                      .map((action) => (
                        <div className="chat-rerun-pill" key={`${turn.id}-rerun-${action.cropId}`}>
                          <strong>Detector re-ran on crop</strong>
                          <span>
                            {action.findingsCount} finding(s) on the closer look · model{" "}
                            <code>{action.modelVersion}</code>
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
                {turn.proposedSkillIds.length > 0 ? (
                  <div className="chat-skill-proposal" role="status">
                    <strong>Self-proposed inspection method logged</strong>
                    <p>
                      Draft only. Benchmark proof and human approval are required before this can reach the public
                      methods board.
                    </p>
                    <ul>
                      {turn.proposedSkillIds.map((id) => (
                        <li key={id}>
                          <code>{id}</code> · status <em>draft</em> · awaiting benchmark
                        </li>
                      ))}
                    </ul>
                    <div className="chat-skill-links">
                      <a href="/skills?tab=proposals">Review draft queue</a>
                      <a href="/methods">Public verified board</a>
                    </div>
                  </div>
                ) : null}
                <pre className="chat-content">{turn.content}</pre>
                {turn.error ? <small className="chat-error">{turn.error}</small> : null}
              </div>
            ),
          )
        )}
        {loading ? (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--loading">
            <span className="chat-role">Agent</span>
            <p>
              {pendingZoom
                ? `Inspecting ${pendingZoom.region.replaceAll("_", " ")}…`
                : "Thinking through tools…"}
            </p>
          </div>
        ) : null}
      </div>

      <form
        className="report-chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <textarea
          aria-label="Ask the inspection agent"
          disabled={loading}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void ask(input);
            }
          }}
          placeholder="Ask about this report — try 'is that scratch real or just glare?'"
          rows={2}
          value={input}
        />
        <button className="button warn" disabled={loading || !input.trim()} type="submit">
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <p className="report-chat-disclaimer muted">
        Agent answers cite tool outputs only. No official grade claims, no legal proof claims. Self-proposed inspection methods are logged as drafts; benchmarks gate promotion.
      </p>
    </section>
  );
}
