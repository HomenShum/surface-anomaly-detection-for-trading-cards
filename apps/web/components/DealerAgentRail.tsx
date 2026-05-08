"use client";

import { useState, useRef, useCallback, type FormEvent, type ChangeEvent } from "react";
import Link from "next/link";

type Message = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  timestamp: string;
  attachmentName?: string;
};

const STARTER: Message[] = [
  {
    id: "ag-welcome",
    role: "assistant",
    content:
      "Drop a card photo or paste a cert link. I'll run the inspection, surface DING annotations, and save the proof packet to your vault. Ask anything: retake advice, compare two scans, grading ROI, listing copy.",
    timestamp: "now",
  },
];

const QUICK_PROMPTS = [
  "What changed since the last scan?",
  "Is this worth grading?",
  "Draft a listing description.",
  "Compare front and back wear.",
];

function newId(): string {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function DealerAgentRail() {
  const [messages, setMessages] = useState<Message[]>(STARTER);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userMsg: Message = {
        id: newId(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString().slice(11, 16),
        attachmentName: uploadName ?? undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setUploadName(null);
      setBusy(true);
      setError(null);

      // Local-first reply: the rail is wired to the same dealer endpoints
      // but the chat backend itself is a stub for the vendor pilot. We
      // generate a contextual response based on what the user said + any
      // recent vault state. Real LLM streaming wires in later.
      try {
        const reply = await stubAgentReply(trimmed);
        const assistant: Message = {
          id: newId(),
          role: "assistant",
          content: reply,
          timestamp: new Date().toISOString().slice(11, 16),
        };
        setMessages((prev) => [...prev, assistant]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [uploadName],
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
        content: `Attached ${file.name} (${Math.round(file.size / 1024)} KB). Drop it on the upload card to start the inspection pipeline.`,
        timestamp: new Date().toISOString().slice(11, 16),
        attachmentName: file.name,
      },
    ]);
  }, []);

  return (
    <aside className="dealer-agent-rail" aria-label="Agent chat">
      <header className="dealer-agent-rail-head">
        <div>
          <span className="dealer-agent-rail-kicker">Pi-assisted ops</span>
          <h2>Agent</h2>
        </div>
        <span className="dealer-agent-rail-status">
          <span className="dealer-agent-rail-dot" /> ready
        </span>
      </header>

      <div className="dealer-agent-rail-thread" aria-live="polite">
        {messages.map((m) => (
          <article className={`dealer-agent-msg dealer-agent-msg--${m.role}`} key={m.id}>
            <div className="dealer-agent-msg-meta">
              <strong>{m.role === "assistant" ? "agent" : m.role === "system" ? "system" : "you"}</strong>
              <time>{m.timestamp}</time>
            </div>
            <p>{m.content}</p>
            {m.attachmentName ? (
              <small className="dealer-agent-msg-attachment">attached: {m.attachmentName}</small>
            ) : null}
          </article>
        ))}
        {busy ? (
          <article className="dealer-agent-msg dealer-agent-msg--assistant is-busy">
            <div className="dealer-agent-msg-meta">
              <strong>agent</strong>
              <time>thinking...</time>
            </div>
          </article>
        ) : null}
        {error ? <p className="dealer-agent-rail-error">Warning: {error}</p> : null}
      </div>

      <div className="dealer-agent-rail-prompts" aria-label="Quick prompts">
        {QUICK_PROMPTS.map((p) => (
          <button
            className="dealer-agent-rail-prompt"
            disabled={busy}
            key={p}
            onClick={() => void send(p)}
            type="button"
          >
            {p}
          </button>
        ))}
      </div>

      <form className="dealer-agent-rail-compose" onSubmit={onSubmit}>
        <label className="dealer-agent-rail-attach" title="Attach a card photo">
          <input
            accept="image/*"
            hidden
            onChange={onFile}
            ref={fileRef}
            type="file"
          />
          <span aria-hidden>+</span>
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
          placeholder="Ask about a card, request comparison, draft a listing..."
          rows={2}
          value={input}
        />
        <button
          className="dealer-agent-rail-send"
          disabled={busy || !input.trim()}
          type="submit"
        >
          Send
        </button>
      </form>

      <footer className="dealer-agent-rail-foot">
        Local-first stub - real LLM streaming queued post-pilot -{" "}
        <Link href="/dealer/dashboard">open vault -&gt;</Link>
      </footer>
    </aside>
  );
}

// Stub agent reply. No LLM yet; pilot-stage canned answers.

async function stubAgentReply(prompt: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 380 + Math.random() * 320));
  const lower = prompt.toLowerCase();
  if (/list|listing|description|ebay|tcg/i.test(prompt)) {
    return "Listing draft starts from the most recent vault record with `decision = sell_raw`. I can populate eBay title + condition copy + recommended price + photos-ready check from the stored evidence packet. Open `/dealer/listings` to see drafts in queue.";
  }
  if (/grade|grading|psa|submit|roi/i.test(prompt)) {
    return "Grading ROI for any record sits under the workbench's `Pricing & ROI` panel. The recommendation is one of submit / sell_raw / hold / rescan / human_review with a net EV vs raw cost. Submission tracker lives at `/dealer/submissions`.";
  }
  if (/compare|before|after|return|dispute/i.test(prompt)) {
    return "Before/after compare reuses the existing /compare flow against two evidence packets. The flywheel auto-flags new DING candidates between pre-shipping and post-return. Tag a decision = `before_after_evidence` on the workbench to start the dispute trail.";
  }
  if (/save|proof|packet|evidence|sign/i.test(prompt)) {
    return "Each saved record produces an HMAC-SHA256 signed evidence packet with cert URL, image hash, model version, accepted findings, reviewer, and timestamp. Drop a card on the upload zone and tap Save proof packet; the share link auto-copies.";
  }
  if (/dim|cert|psa cert|tag cert/i.test(prompt)) {
    return "Cert metadata comes from the OCR pass on label crops + a hash-match against the seeded reference set. PSA = blue, TAG = sky, CGC + BGS = neutral. Trust tier is inferred from whether a slab image and grader URL are both attached.";
  }
  return "I have your message. The pilot agent is local-first and reads vault state at `data/dealer/records.jsonl`. Drop a real card photo on the upload zone to run the inspection pipeline live, or open the admin dashboard to drill into any record.";
}
