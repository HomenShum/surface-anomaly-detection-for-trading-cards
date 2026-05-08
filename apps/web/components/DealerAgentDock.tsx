"use client";

import { useState, useRef, useCallback, useEffect, type FormEvent, type ChangeEvent } from "react";

/**
 * Codex-style floating agent dock.
 *
 * Pinned bottom-right of the viewport. Closed by default — summon with
 * ⌘J / Ctrl+J or by clicking any element with `[data-agent-summon]`
 * attribute (the SideNav's "Ask agent" footer button).
 *
 * Mirrors Linear's Codex panel: header with current focus + close ×,
 * structured tool-call/streaming feed, compose row at bottom with
 * attach + send. Stub backend produces canned topical replies until the
 * real LLM wires in.
 */

type Message = {
  id: string;
  role: "assistant" | "user" | "system" | "tool";
  content: string;
  timestamp: string;
  attachmentName?: string;
  toolName?: string;
  toolStatus?: "running" | "passed" | "failed";
};

const STARTER: Message[] = [
  {
    id: "ag-welcome",
    role: "assistant",
    content:
      "Pi is ready. Ask anything about the open record, request a comparison, draft a listing, or grade ROI. I read the vault state at /data/dealer/records.jsonl.",
    timestamp: "now",
  },
];

const QUICK_PROMPTS = [
  "What changed since last scan?",
  "Worth grading?",
  "Draft a listing.",
  "Compare front vs back.",
];

function newId(): string {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function ts(): string {
  return new Date().toISOString().slice(11, 16);
}

export function DealerAgentDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(STARTER);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // ⌘J / Ctrl+J to summon, Escape to dismiss.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // External summon handlers: any element with [data-agent-summon] toggles
  // the dock when clicked. Lets the SideNav footer button + record-detail
  // CTAs open the dock without prop drilling.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const summon = target?.closest("[data-agent-summon]") as HTMLElement | null;
      if (!summon) return;
      e.preventDefault();
      setOpen(true);
      const recordAttr = summon.getAttribute("data-agent-record-id");
      if (recordAttr) setFocusedRecordId(recordAttr);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Auto-scroll the thread to the latest message when it grows.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userMsg: Message = {
        id: newId(),
        role: "user",
        content: trimmed,
        timestamp: ts(),
        attachmentName: uploadName ?? undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setUploadName(null);
      setBusy(true);
      setError(null);

      // Linear-Codex pattern: surface tool events while the LLM thinks.
      // First event renders immediately so the panel feels grounded; the
      // real /api/dealer/agent server route reads vault state and runs the
      // configured LLM (pi-ai/Inflection/OpenRouter — see .env). The tool
      // events resolve to "passed" or "failed" based on the response.
      const toolReadId = newId();
      const toolSearchId = newId();
      setMessages((prev) => [
        ...prev,
        {
          id: toolReadId,
          role: "tool",
          content: focusedRecordId ? `Reading vault record ${focusedRecordId}…` : "Reading vault snapshot…",
          timestamp: ts(),
          toolName: "vault.read",
          toolStatus: "running",
        },
        {
          id: toolSearchId,
          role: "tool",
          content: "Indexing top-by-value + recent activity…",
          timestamp: ts(),
          toolName: "vault.search",
          toolStatus: "running",
        },
      ]);

      try {
        // Build the chat history excluding tool/system rows — the server
        // injects its own system prompt + vault snapshot.
        const chatHistory: { role: "user" | "assistant"; content: string }[] = [];
        for (const m of messages) {
          if (m.role === "user" || m.role === "assistant") {
            chatHistory.push({ role: m.role, content: m.content });
          }
        }
        chatHistory.push({ role: "user", content: trimmed });

        // SSE stream — tokens arrive incrementally. Pre-create the
        // assistant message so we can append chunks to it.
        const assistantId = newId();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "", timestamp: ts() },
        ]);

        const res = await fetch("/api/dealer/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chatHistory, focusedRecordId }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`agent stream HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let provider: string | undefined;
        let model: string | undefined;
        let streamError: string | undefined;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE messages are double-newline separated.
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;
            let eventName = "message";
            let dataLine = "";
            for (const line of rawEvent.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine);
              if (eventName === "tool") {
                const targetId = data.name === "vault.read" ? toolReadId : data.name === "vault.search" ? toolSearchId : null;
                if (targetId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === targetId
                        ? {
                            ...m,
                            toolStatus: data.status as "running" | "passed" | "failed",
                            content: data.label ?? m.content,
                          }
                        : m,
                    ),
                  );
                }
              } else if (eventName === "token") {
                if (typeof data.chunk === "string") {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + data.chunk } : m)),
                  );
                }
              } else if (eventName === "done") {
                provider = data.provider;
                model = data.model;
                streamError = data.error;
              }
            } catch {
              // skip malformed event payload
            }
          }
        }

        if (provider && provider !== "local-fallback" && provider !== "error") {
          const providerNote = `${provider}${model ? ` · ${model}` : ""}`;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, attachmentName: providerNote } : m)),
          );
        }
        if (streamError) {
          setError(streamError);
        }
      } catch (e) {
        // Mark tool events as failed so the panel reflects the error path.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === toolReadId || m.id === toolSearchId) {
              return { ...m, toolStatus: "failed" as const };
            }
            return m;
          }),
        );
        const fallback = await stubAgentReply(trimmed, focusedRecordId);
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: `${fallback}\n\n(LLM unreachable — using local fallback. Configure INFLECTION_API_KEY or pi-ai in apps/web/.env.local for live answers.)`,
            timestamp: ts(),
          },
        ]);
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [uploadName, focusedRecordId],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadName(file.name);
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: "system",
        content: `Attached ${file.name} (${Math.round(file.size / 1024)} KB). Drop it on the upload card on the canvas to start the inspection pipeline — the dock is for chat about existing records.`,
        timestamp: ts(),
        attachmentName: file.name,
      },
    ]);
  }, []);

  if (!open) {
    return (
      <button
        aria-label="Open agent (⌘J)"
        className="dealer-agent-dock-launcher"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden>✦</span>
        <span>Ask Pi</span>
        <span className="dealer-agent-dock-launcher-kbd" aria-hidden>⌘J</span>
      </button>
    );
  }

  return (
    <aside className="dealer-agent-dock" aria-label="Pi agent" role="dialog">
      <header className="dealer-agent-dock-head">
        <div>
          <span className="dealer-agent-dock-mark" aria-hidden>✦</span>
          <strong>Pi</strong>
          <span className="dealer-agent-dock-focus">
            {focusedRecordId ? `· ${focusedRecordId}` : "· vault read"}
          </span>
        </div>
        <button
          aria-label="Dismiss agent (Esc)"
          className="dealer-agent-dock-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </header>

      <div className="dealer-agent-dock-thread" ref={threadRef} aria-live="polite">
        {messages.map((m) => (
          <article className={`dealer-agent-dock-msg dealer-agent-dock-msg--${m.role}`} key={m.id}>
            {m.role === "tool" ? (
              <span className="dealer-agent-dock-tool">
                <span className="dealer-agent-dock-tool-tag">{m.toolName}</span>
                <span className="dealer-agent-dock-tool-status">{m.toolStatus === "passed" ? "✓" : m.toolStatus === "failed" ? "✕" : "…"}</span>
                <span className="dealer-agent-dock-tool-label">{m.content}</span>
                <time>{m.timestamp}</time>
              </span>
            ) : (
              <>
                <div className="dealer-agent-dock-msg-meta">
                  <strong>{m.role === "assistant" ? "Pi" : m.role === "system" ? "system" : "you"}</strong>
                  <time>{m.timestamp}</time>
                </div>
                <p>{m.content}</p>
                {m.attachmentName ? <small>📎 {m.attachmentName}</small> : null}
              </>
            )}
          </article>
        ))}
        {busy ? (
          <article className="dealer-agent-dock-msg dealer-agent-dock-msg--assistant is-busy">
            <div className="dealer-agent-dock-msg-meta">
              <strong>Pi</strong>
              <time>thinking…</time>
            </div>
          </article>
        ) : null}
        {error ? <p className="dealer-agent-dock-error">⚠ {error}</p> : null}
      </div>

      <div className="dealer-agent-dock-prompts">
        {QUICK_PROMPTS.map((p) => (
          <button
            className="dealer-agent-dock-prompt"
            disabled={busy}
            key={p}
            onClick={() => void send(p)}
            type="button"
          >
            {p}
          </button>
        ))}
      </div>

      <form className="dealer-agent-dock-compose" onSubmit={onSubmit}>
        <label className="dealer-agent-dock-attach" title="Attach a card photo">
          <input accept="image/*" hidden onChange={onFile} ref={fileRef} type="file" />
          <span aria-hidden>📎</span>
        </label>
        <textarea
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Message Pi…"
          rows={2}
          value={input}
        />
        <button
          className="dealer-agent-dock-send"
          disabled={busy || !input.trim()}
          type="submit"
        >
          Send
        </button>
      </form>
    </aside>
  );
}

async function stubAgentReply(prompt: string, recordId?: string | null): Promise<string> {
  await new Promise((r) => setTimeout(r, 320 + Math.random() * 240));
  const tail = recordId ? `\n\nFocused on record ${recordId}.` : "";
  if (/list|listing|description|ebay|tcg/i.test(prompt))
    return `Listing draft pulls from the most recent record with decision = sell_raw. I can populate eBay title + condition copy + recommended price + photos-ready check from the stored evidence packet. Open /dealer/listings to see drafts in queue.${tail}`;
  if (/grade|grading|psa|submit|roi|worth/i.test(prompt))
    return `Grading ROI lives on the record's Pricing & ROI panel. The recommendation is one of submit / sell_raw / hold / rescan / human_review with a net EV vs raw cost. Submission tracker is /dealer/submissions.${tail}`;
  if (/compare|before|after|return|dispute|front|back/i.test(prompt))
    return `Before/after compare reuses /compare against two evidence packets. The flywheel auto-flags new DING candidates between pre-shipping and post-return. Tag decision = before_after_evidence on the workbench to start a dispute trail.${tail}`;
  if (/save|proof|packet|evidence|sign/i.test(prompt))
    return `Each saved record produces an HMAC-SHA256 signed evidence packet with cert URL, image hash, model version, accepted findings, reviewer, timestamp. Drop a card on the upload zone and tap Save proof packet — the share link auto-copies.${tail}`;
  if (/cert|psa cert|tag cert|verify/i.test(prompt))
    return `Cert metadata comes from OCR on label crops + a hash-match against the seeded reference set. Trust tier is inferred from whether a slab image and grader URL are both attached.${tail}`;
  if (/changed|since|last/i.test(prompt))
    return `I read the audit trail for the focused record (sessions.jsonl + events.jsonl). Recent events are visible on /dealer/records/<id> under "Audit trail". Re-running the inspection appends new events; existing evidence packets keep their signatures.${tail}`;
  return `I have your message. The pilot agent is local-first and reads vault state at data/dealer/records.jsonl. Drop a real card photo on the upload zone to run the inspection pipeline live, or open the admin dashboard to drill into any record.${tail}`;
}
