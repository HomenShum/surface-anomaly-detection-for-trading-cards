import { NextResponse } from "next/server";
import type { DealerCostBasis } from "../../../../../lib/dealer/types";
import { actorKey, consumeToken } from "../../../../../lib/dealer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI-powered cost-basis parser.
 *
 * Takes free-form vendor notes ("won bid 3/14 for $87, paid $35 grading
 * fee on 4/2, $8 shipping to PSA, sold to @drewz on eBay 5/22 for $260")
 * and returns a structured Partial<DealerCostBasis> the drawer can use
 * to prefill the form. The user always confirms before saving — the AI
 * is a starting point, not the authority.
 *
 * Wire format:
 *   POST { notes: string }
 *   200  { parsed: Partial<DealerCostBasis>, provider, model }
 *
 * Backed by Gemini's responseSchema constrained-decoding so the model
 * can't hallucinate fields outside our schema. Falls back to a regex
 * extractor if no LLM key is configured so the drawer still works in
 * offline / dev environments.
 */

type Body = { notes?: string; recordId?: string };

const VALID_ACQ_CHANNELS = ["ebay", "tcgplayer", "cardmarket", "auction", "private", "other"] as const;
const VALID_SALE_CHANNELS = ["ebay", "tcgplayer", "cardmarket", "private", "other"] as const;

const PARSE_INSTRUCTIONS = `You parse free-form trading-card dealer notes into a structured cost-basis object.

Extract ONLY what is explicitly stated in the notes. If a field is not mentioned, OMIT it from the output (do not invent values).

Rules:
- Money amounts: numbers only, no $ or commas. Reject anything > $1,000,000.
- Dates: ISO format (YYYY-MM-DD). Resolve relative dates (yesterday, last Tuesday) against the current date in the prompt.
- Channel enums: must be one of the allowed values OR omitted.
- Fees: an array of {label, amount, paidAt?}. Common labels: grading, shipping, supplies, slabbing, postage, insurance.
- Note: a clean 1-line summary of the acquisition story (max 120 chars), if useful.
- DO NOT include fields you can't confirm. Empty object {} is a valid response when the notes are too vague.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    acquisitionCost: { type: "number" },
    acquisitionDate: { type: "string", description: "ISO date YYYY-MM-DD" },
    acquisitionChannel: {
      type: "string",
      enum: ["ebay", "tcgplayer", "cardmarket", "auction", "private", "other"],
    },
    acquisitionNote: { type: "string" },
    fees: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          amount: { type: "number" },
          paidAt: { type: "string", description: "ISO date YYYY-MM-DD" },
        },
        required: ["label", "amount"],
      },
    },
    salePrice: { type: "number" },
    saleDate: { type: "string", description: "ISO date YYYY-MM-DD" },
    saleChannel: {
      type: "string",
      enum: ["ebay", "tcgplayer", "cardmarket", "private", "other"],
    },
    saleBuyer: { type: "string" },
  },
};

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) return undefined;
  return value;
}

function sanitizeIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Accept YYYY-MM-DD literally; otherwise parse and re-emit as YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

function sanitizeString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function normalizeParsed(raw: unknown): Partial<DealerCostBasis> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<DealerCostBasis> = {};
  const acq = sanitizeNumber(r.acquisitionCost);
  if (acq !== undefined) out.acquisitionCost = acq;
  const acqDate = sanitizeIso(r.acquisitionDate);
  if (acqDate) out.acquisitionDate = new Date(acqDate).toISOString();
  if (typeof r.acquisitionChannel === "string" && VALID_ACQ_CHANNELS.includes(r.acquisitionChannel as never)) {
    out.acquisitionChannel = r.acquisitionChannel as DealerCostBasis["acquisitionChannel"];
  }
  const note = sanitizeString(r.acquisitionNote, 480);
  if (note) out.acquisitionNote = note;
  if (Array.isArray(r.fees)) {
    const fees: NonNullable<DealerCostBasis["fees"]> = [];
    for (const fee of r.fees.slice(0, 32)) {
      if (!fee || typeof fee !== "object") continue;
      const f = fee as Record<string, unknown>;
      const label = sanitizeString(f.label, 64);
      const amount = sanitizeNumber(f.amount);
      const paidAt = sanitizeIso(f.paidAt);
      if (!label || amount === undefined) continue;
      fees.push({ label, amount, paidAt: paidAt ? new Date(paidAt).toISOString() : undefined });
    }
    if (fees.length > 0) out.fees = fees;
  }
  const sale = sanitizeNumber(r.salePrice);
  if (sale !== undefined) out.salePrice = sale;
  const saleDate = sanitizeIso(r.saleDate);
  if (saleDate) out.saleDate = new Date(saleDate).toISOString();
  if (typeof r.saleChannel === "string" && VALID_SALE_CHANNELS.includes(r.saleChannel as never)) {
    out.saleChannel = r.saleChannel as DealerCostBasis["saleChannel"];
  }
  const buyer = sanitizeString(r.saleBuyer, 120);
  if (buyer) out.saleBuyer = buyer;
  return out;
}

async function parseWithGemini(notes: string, apiKey: string, model: string): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `${PARSE_INSTRUCTIONS}\n\nToday's date: ${today}\n\nDealer notes:\n${notes}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini parse HTTP ${res.status}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

/**
 * Regex fallback when no LLM is available. Hits the most common dealer
 * note shapes: "$X paid", "won for $X", "$X grading", "$X shipping",
 * "sold for $X", "@username". Lossy but useful for offline dev.
 */
function parseWithRegex(notes: string): Partial<DealerCostBasis> {
  const out: Partial<DealerCostBasis> = {};
  const moneyRe = /\$\s?([\d,]+(?:\.\d{2})?)/g;
  const grading = /grad(?:ing|ed)\s+(?:fee\s+)?(?:of\s+)?\$\s?([\d,]+(?:\.\d{2})?)/i.exec(notes);
  const shipping = /ship(?:ping)?\s+(?:fee\s+)?(?:of\s+)?\$\s?([\d,]+(?:\.\d{2})?)/i.exec(notes);
  const sold = /sold\s+(?:to\s+\S+\s+)?(?:for\s+)?\$\s?([\d,]+(?:\.\d{2})?)/i.exec(notes);
  const won = /(?:won|paid|bought|bid)\s+(?:bid\s+)?(?:for\s+)?\$\s?([\d,]+(?:\.\d{2})?)/i.exec(notes);
  const buyer = /(?:to|sold to)\s+@(\w+)/i.exec(notes);

  if (won) out.acquisitionCost = Number(won[1]!.replace(/,/g, ""));
  if (sold) out.salePrice = Number(sold[1]!.replace(/,/g, ""));
  if (buyer) out.saleBuyer = `@${buyer[1]}`;
  const fees: NonNullable<DealerCostBasis["fees"]> = [];
  if (grading) fees.push({ label: "grading", amount: Number(grading[1]!.replace(/,/g, "")) });
  if (shipping) fees.push({ label: "shipping", amount: Number(shipping[1]!.replace(/,/g, "")) });
  if (fees.length > 0) out.fees = fees;
  // Cheap channel inference from keywords.
  if (/ebay|e-bay/i.test(notes)) out.acquisitionChannel = "ebay";
  else if (/tcgplayer/i.test(notes)) out.acquisitionChannel = "tcgplayer";
  else if (/cardmarket/i.test(notes)) out.acquisitionChannel = "cardmarket";
  else if (/auction/i.test(notes)) out.acquisitionChannel = "auction";
  if (out.salePrice && /ebay|e-bay/i.test(notes)) out.saleChannel = "ebay";
  // Use the first sentence as the note — capped.
  const sentenceEnd = notes.search(/[.!\n]/);
  const summary = (sentenceEnd > 0 ? notes.slice(0, sentenceEnd) : notes).trim().slice(0, 120);
  if (summary) out.acquisitionNote = summary;
  // Drop money matches we already consumed via specific regexes.
  void moneyRe;
  return out;
}

export async function POST(request: Request) {
  // ─── Rate limit (per-actor) ───────────────────────────────────────
  // LLM calls are the expensive resource here. 10 req burst, 0.2 req/s
  // sustained = 12 req/min. Plenty for a real dealer; blocks abuse.
  const limit = consumeToken({
    key: `cost-basis-parse:${actorKey(request, "anonymous")}`,
    capacity: 10,
    refillRate: 0.2,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          "X-RateLimit-Reset": String(Math.floor(limit.resetAt / 1000)),
        },
      },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const notes = (body.notes ?? "").trim();
  if (!notes) {
    return NextResponse.json({ parsed: {}, provider: "noop", model: "noop" });
  }
  if (notes.length > 4000) {
    return NextResponse.json({ error: "notes_too_long", max: 4000 }, { status: 400 });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.CARD_AGENT_GEMINI_MODEL ?? "gemini-2.5-flash";

  if (geminiKey) {
    try {
      const raw = await parseWithGemini(notes, geminiKey, geminiModel);
      const parsed = normalizeParsed(raw);
      return NextResponse.json({ parsed, provider: "gemini-direct", model: geminiModel });
    } catch (err) {
      // Fall through to regex fallback.
      const parsed = parseWithRegex(notes);
      return NextResponse.json({
        parsed,
        provider: "regex-fallback",
        model: "regex",
        error: err instanceof Error ? err.message : "gemini failed",
      });
    }
  }

  const parsed = parseWithRegex(notes);
  return NextResponse.json({ parsed, provider: "regex-fallback", model: "regex" });
}
