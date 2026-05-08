import { currentOwnerId } from "../../../../../lib/dealer/owner";
import { loadAllRecords, loadRecord } from "../../../../../lib/dealer/store";
import type { DealerRecord } from "../../../../../lib/dealer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming agent endpoint. Returns text/event-stream so the dealer-OS
 * agent dock can render tokens as they arrive, instead of waiting 3-8s
 * for the full response.
 *
 * Currently streams from the Gemini Generative Language API directly
 * (`streamGenerateContent` endpoint) since that's the LLM the existing
 * card-report-agent fallback chain reaches first when OpenRouter is
 * unavailable. If GEMINI_API_KEY isn't configured, we synthesize a
 * single-shot SSE response from the local fallback explainer so the dock
 * UX is consistent regardless of provider availability.
 *
 * Wire format:
 *   event: tool, data: {"name":"vault.read","status":"running","label":"..."}
 *   event: tool, data: {"name":"vault.read","status":"passed","label":"..."}
 *   event: tool, data: {"name":"vault.search","status":"passed","label":"..."}
 *   event: token, data: {"chunk":"Here are "}
 *   event: token, data: {"chunk":"the top 3 records..."}
 *   event: done,  data: {"provider":"gemini","model":"gemini-2.5-flash"}
 */

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type Body = { messages?: ChatMessage[]; focusedRecordId?: string | null };

function snapshotRecord(r: DealerRecord): string {
  const dings = r.modelFindings?.length ?? 0;
  const cert = r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : "raw";
  return [
    `id=${r.id}`,
    `cert=${cert}`,
    `card=${r.cardIdentity ?? "(no identity)"}`,
    `grade=${r.officialGrade ?? "no grade"}`,
    `lane=${r.lane}`,
    `dings=${dings}`,
    `recommendation=${r.roi?.recommendation ?? "n/a"}`,
    `rawHigh=${r.pricing?.rawHigh ?? "n/a"}`,
    `expectedGradedEv=${r.roi?.expectedGradedEv ?? "n/a"}`,
    `evidence-packet=${r.evidencePacket ? "yes" : "no"}`,
    `human-review=${r.humanReview?.decision ?? "pending"}`,
  ].join(" | ");
}

function buildVaultContext(ownerId: string, focusedRecordId: string | null | undefined): string {
  const all = loadAllRecords(ownerId);
  const totalRecords = all.length;
  const reviewed = all.filter((r) => r.humanReview).length;
  const needsReview = all.filter((r) => r.lane === "human_review").length;
  const listed = all.filter((r) => r.listing).length;
  const submitted = all.filter((r) => r.submission).length;
  const inventory = all.reduce((s, r) => s + (r.pricing?.rawHigh ?? 0), 0);
  const top = [...all]
    .filter((r) => r.pricing?.rawHigh)
    .sort((a, b) => (b.pricing?.rawHigh ?? 0) - (a.pricing?.rawHigh ?? 0))
    .slice(0, 6);
  const recent = [...all]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);
  const focused = focusedRecordId ? loadRecord(ownerId, focusedRecordId) : null;

  const lines: string[] = [
    "# Live vault snapshot",
    `total=${totalRecords} reviewed=${reviewed} needs_review=${needsReview} listed=${listed} submitted=${submitted} inventory_rawHigh=$${inventory}`,
  ];
  if (focused) {
    lines.push("", "## Focused record (the user is asking about this)", snapshotRecord(focused));
  } else if (focusedRecordId) {
    lines.push("", `## Focused record id=${focusedRecordId} (NOT FOUND)`);
  }
  if (top.length > 0) {
    lines.push("", "## Top by raw value");
    for (const r of top) lines.push(snapshotRecord(r));
  }
  if (recent.length > 0) {
    lines.push("", "## Most recent activity");
    for (const r of recent) lines.push(snapshotRecord(r));
  }
  return lines.join("\n");
}

const SYSTEM_RULES = `You are Pi, the Card Condition Vault dealer-OS agent. You help vendors triage card-grading decisions on a private trading-card pilot.

Ground rules:
- Never claim official grades. The vault produces "AI-assisted visible condition only".
- Always cite specific record ids, cert numbers, DING counts, and dollar values from the vault snapshot above.
- Recommendations: submit, sell_raw, hold, rescan, human_review. Pick one and explain why in 2-3 lines.
- If asked about a record that isn't in the vault snapshot, say so plainly.
- Keep replies under 6 sentences unless the user explicitly asks for a long answer.
- Tone: terse, technical, dealer-friendly. No marketing fluff.`;

function flattenHistory(messages: ChatMessage[]): string {
  const turns = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-8);
  return turns
    .map((m) => `${m.role === "user" ? "Dealer" : "Pi"}: ${m.content.trim()}`)
    .join("\n\n");
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* streamFromGemini(prompt: string, apiKey: string, model: string): AsyncGenerator<string> {
  // Gemini Generative Language API streaming endpoint. Returns chunks
  // as JSON arrays separated by newlines; we extract candidate text.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Gemini stream HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {
        // skip malformed
      }
    }
  }
}

async function* fallbackStream(prompt: string): AsyncGenerator<string> {
  const message = `(LLM unreachable — using local fallback. The agent dock is reading the vault state at /data/dealer/records.jsonl directly. Configure GEMINI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY to get streaming AI answers grounded in the vault snapshot.)`;
  const tokens = message.split(/(\s+)/);
  for (const t of tokens) {
    yield t;
    await new Promise((r) => setTimeout(r, 16));
  }
}

export async function POST(request: Request) {
  const { messages = [], focusedRecordId = null }: Body = await request.json();
  const ownerId = await currentOwnerId();
  const vaultContext = buildVaultContext(ownerId, focusedRecordId);
  const last = messages.at(-1)?.content?.trim() ?? "Help me triage the workbench.";
  const history = flattenHistory(messages.slice(0, -1));
  const prompt = [
    vaultContext,
    "",
    "----",
    SYSTEM_RULES,
    "----",
    history.length > 0 ? `Prior conversation:\n${history}\n\n----` : "",
    `Dealer's new question:\n${last}\n\nAnswer using the vault snapshot above. Cite cert numbers and dollar values when relevant.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.CARD_AGENT_GEMINI_MODEL ?? "gemini-2.5-flash";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      try {
        // Tool events first.
        send("tool", {
          name: "vault.read",
          status: "running",
          label: focusedRecordId ? `loading record ${focusedRecordId}…` : "loading vault snapshot…",
        });
        send("tool", {
          name: "vault.read",
          status: "passed",
          label: focusedRecordId ? `loaded record ${focusedRecordId}` : "loaded vault snapshot",
        });
        send("tool", {
          name: "vault.search",
          status: "passed",
          label: "indexed top-by-value + recent activity",
        });

        let provider = "local-fallback";
        let model = "stub";
        try {
          if (geminiKey) {
            for await (const chunk of streamFromGemini(prompt, geminiKey, geminiModel)) {
              send("token", { chunk });
            }
            provider = "gemini-stream";
            model = geminiModel;
          } else {
            for await (const chunk of fallbackStream(prompt)) {
              send("token", { chunk });
            }
          }
        } catch (err) {
          send("tool", {
            name: "vault.search",
            status: "failed",
            label: `LLM stream failed: ${err instanceof Error ? err.message : "unknown"}`,
          });
          for await (const chunk of fallbackStream(prompt)) {
            send("token", { chunk });
          }
        }

        send("done", { provider, model });
        controller.close();
      } catch (err) {
        send("done", { provider: "error", error: err instanceof Error ? err.message : "unknown" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
