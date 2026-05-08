import { NextResponse } from "next/server";
import { currentOwnerId } from "../../../../../../lib/dealer/owner";
import { loadRecord, upsertRecord } from "../../../../../../lib/dealer/store";
import type { DealerCostBasis } from "../../../../../../lib/dealer/types";
import {
  appendEvent,
  loadSessionsForRecord,
  openSession,
} from "../../../../../../lib/dealer/sessions";
import { getIdempotent, idempotencyKey, setIdempotent } from "../../../../../../lib/dealer/idempotency";
import { actorKey, consumeToken } from "../../../../../../lib/dealer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  acquisitionCost?: number;
  acquisitionDate?: string;
  acquisitionChannel?: DealerCostBasis["acquisitionChannel"];
  acquisitionNote?: string;
  // The drawer always sends `fees` (possibly empty array) so the server
  // can distinguish "user cleared fees" from "user didn't touch fees".
  fees?: Array<{ label: string; amount: number; paidAt?: string }>;
  salePrice?: number;
  saleDate?: string;
  saleChannel?: DealerCostBasis["saleChannel"];
  saleBuyer?: string;
};

type FieldErrors = Record<string, string>;

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1_000_000) return undefined;
  return value;
}

function sanitizeString(value: unknown, maxLen = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLen);
}

function sanitizeIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  // Reject dates wildly outside the dealer use case (1970 - now+30y).
  const minMs = Date.parse("1970-01-01T00:00:00Z");
  const maxMs = Date.now() + 30 * 365 * 86400 * 1000;
  if (t < minMs || t > maxMs) return undefined;
  return new Date(t).toISOString();
}

const VALID_ACQ_CHANNELS = new Set(["ebay", "tcgplayer", "cardmarket", "auction", "private", "other"] as const);
const VALID_SALE_CHANNELS = new Set(["ebay", "tcgplayer", "cardmarket", "private", "other"] as const);
const MAX_FEES = 32;

/**
 * Build a stable hash of the cost-basis for change detection. Used to
 * skip audit-log appends when the request would be a no-op.
 */
function fingerprint(cb: DealerCostBasis | null | undefined): string {
  if (!cb) return "null";
  const fees = [...(cb.fees ?? [])]
    .map((f) => ({ label: f.label, amount: f.amount, paidAt: f.paidAt ?? "" }))
    .sort((a, b) => (a.label + a.amount).localeCompare(b.label + b.amount));
  return JSON.stringify({
    ac: cb.acquisitionCost ?? null,
    ad: cb.acquisitionDate ?? null,
    ach: cb.acquisitionChannel ?? null,
    an: cb.acquisitionNote ?? null,
    fees,
    sp: cb.salePrice ?? null,
    sd: cb.saleDate ?? null,
    sch: cb.saleChannel ?? null,
    sb: cb.saleBuyer ?? null,
  });
}

/**
 * Surface what changed between two cost-basis snapshots so the audit
 * trail event payload describes the diff (instead of just the new state).
 */
function describeDiff(prev: DealerCostBasis | undefined, next: DealerCostBasis): {
  changedFields: string[];
  feeChange: { added: number; removed: number; same: number } | null;
} {
  const fields: string[] = [];
  const compare = (key: keyof DealerCostBasis) => {
    if ((prev?.[key] ?? null) !== (next[key] ?? null)) fields.push(String(key));
  };
  compare("acquisitionCost");
  compare("acquisitionDate");
  compare("acquisitionChannel");
  compare("acquisitionNote");
  compare("salePrice");
  compare("saleDate");
  compare("saleChannel");
  compare("saleBuyer");

  let feeChange: { added: number; removed: number; same: number } | null = null;
  const prevFees = prev?.fees ?? [];
  const nextFees = next.fees ?? [];
  if (prevFees.length !== nextFees.length || JSON.stringify(prevFees) !== JSON.stringify(nextFees)) {
    fields.push("fees");
    const prevKey = (f: NonNullable<DealerCostBasis["fees"]>[number]) => `${f.label}:${f.amount}`;
    const prevSet = new Set(prevFees.map(prevKey));
    const nextSet = new Set(nextFees.map(prevKey));
    let added = 0;
    let removed = 0;
    let same = 0;
    for (const k of nextSet) (prevSet.has(k) ? same++ : added++);
    for (const k of prevSet) (nextSet.has(k) ? null : removed++);
    feeChange = { added, removed, same };
  }
  return { changedFields: fields, feeChange };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // ─── Rate limit (per-actor) ───────────────────────────────────────
  const ratelimit = consumeToken({
    key: `cost-basis:${actorKey(request, "anonymous")}`,
    capacity: 30,
    refillRate: 1,
  });
  if (!ratelimit.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: ratelimit.retryAfterMs },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ratelimit.retryAfterMs / 1000)),
          "X-RateLimit-Reset": String(Math.floor(ratelimit.resetAt / 1000)),
        },
      },
    );
  }

  // ─── Idempotency: dedupe within 60s window ────────────────────────
  const idemHeader = request.headers.get("idempotency-key");
  const cacheKey = idempotencyKey(`cost-basis:${id}`, idemHeader);
  if (cacheKey) {
    const cached = getIdempotent(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        status: 200,
        headers: { "X-Idempotent-Replay": "true" },
      });
    }
  }

  // ─── Owner scoping (anon cookie or signed-in session) ─────────────
  const ownerId = await currentOwnerId();
  const reviewerId = ownerId;

  const record = loadRecord(ownerId, id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // ─── Field-level validation with structured errors ────────────────
  const errors: FieldErrors = {};
  if (body.acquisitionCost !== undefined && sanitizeNumber(body.acquisitionCost) === undefined) {
    errors.acquisitionCost = "must be a number between 0 and 1,000,000";
  }
  if (body.acquisitionDate !== undefined && sanitizeIso(body.acquisitionDate) === undefined) {
    errors.acquisitionDate = "invalid ISO date";
  }
  if (
    body.acquisitionChannel !== undefined &&
    body.acquisitionChannel !== null &&
    !VALID_ACQ_CHANNELS.has(body.acquisitionChannel as never)
  ) {
    errors.acquisitionChannel = `must be one of ${[...VALID_ACQ_CHANNELS].join(", ")}`;
  }
  if (body.salePrice !== undefined && sanitizeNumber(body.salePrice) === undefined) {
    errors.salePrice = "must be a number between 0 and 1,000,000";
  }
  if (body.saleDate !== undefined && sanitizeIso(body.saleDate) === undefined) {
    errors.saleDate = "invalid ISO date";
  }
  if (
    body.saleChannel !== undefined &&
    body.saleChannel !== null &&
    !VALID_SALE_CHANNELS.has(body.saleChannel as never)
  ) {
    errors.saleChannel = `must be one of ${[...VALID_SALE_CHANNELS].join(", ")}`;
  }
  if (Array.isArray(body.fees) && body.fees.length > MAX_FEES) {
    errors.fees = `max ${MAX_FEES} fees per record`;
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "validation_failed", fields: errors }, { status: 422 });
  }

  // ─── Sanitize fees ────────────────────────────────────────────────
  const incomingFees = Array.isArray(body.fees) ? body.fees.slice(0, MAX_FEES) : null;
  const sanitizedFees: Array<{ label: string; amount: number; paidAt?: string }> = [];
  if (incomingFees) {
    for (const f of incomingFees) {
      const label = sanitizeString(f?.label, 64);
      const amount = sanitizeNumber(f?.amount);
      const paidAt = sanitizeIso(f?.paidAt);
      if (!label || amount === undefined) continue;
      sanitizedFees.push({ label, amount, paidAt });
    }
  }

  const acquisitionChannel =
    typeof body.acquisitionChannel === "string" && VALID_ACQ_CHANNELS.has(body.acquisitionChannel as never)
      ? body.acquisitionChannel
      : undefined;
  const saleChannel =
    typeof body.saleChannel === "string" && VALID_SALE_CHANNELS.has(body.saleChannel as never)
      ? body.saleChannel
      : undefined;

  // ─── Merge: respect explicit fees:[] as "clear all fees" ─────────
  // Spread existing first, then patch with values that came in.
  // Fees are special: when the client sent the array (even empty), we
  // honor it as the source of truth — that's how the user clears fees.
  // Other fields use omit-when-undefined PATCH semantics so a partial
  // payload doesn't blow away unrelated fields.
  const merged: DealerCostBasis = {
    ...(record.costBasis ?? {}),
    ...(sanitizeNumber(body.acquisitionCost) !== undefined && {
      acquisitionCost: sanitizeNumber(body.acquisitionCost),
    }),
    ...(sanitizeIso(body.acquisitionDate) !== undefined && {
      acquisitionDate: sanitizeIso(body.acquisitionDate),
    }),
    ...(acquisitionChannel !== undefined && { acquisitionChannel }),
    ...(sanitizeString(body.acquisitionNote, 480) !== undefined && {
      acquisitionNote: sanitizeString(body.acquisitionNote, 480),
    }),
    ...(incomingFees !== null && { fees: sanitizedFees }),
    ...(sanitizeNumber(body.salePrice) !== undefined && { salePrice: sanitizeNumber(body.salePrice) }),
    ...(sanitizeIso(body.saleDate) !== undefined && { saleDate: sanitizeIso(body.saleDate) }),
    ...(saleChannel !== undefined && { saleChannel }),
    ...(sanitizeString(body.saleBuyer, 120) !== undefined && {
      saleBuyer: sanitizeString(body.saleBuyer, 120),
    }),
  };

  // ─── No-op detection — skip the write entirely if nothing changed ─
  const prevPrint = fingerprint(record.costBasis);
  const nextPrint = fingerprint(merged);
  if (prevPrint === nextPrint) {
    const response = { ok: true, record, noChange: true as const };
    if (cacheKey) setIdempotent(cacheKey, response);
    return NextResponse.json(response, {
      status: 200,
      headers: { "X-No-Change": "true" },
    });
  }

  // ─── Write the change ────────────────────────────────────────────
  const becameSold = !record.costBasis?.salePrice && Boolean(merged.salePrice);
  const updated = upsertRecord(ownerId, {
    ...record,
    costBasis: merged,
    lane: becameSold ? "sold" : record.lane,
  });

  // ─── Diff-aware audit log (only the changed fields, not the snapshot)
  const diff = describeDiff(record.costBasis, merged);
  if (diff.changedFields.length > 0) {
    const sessions = loadSessionsForRecord(ownerId, id);
    const session =
      sessions.find((s) => s.mode === "cert_import") ??
      openSession(ownerId, { recordId: id, mode: "cert_import", userId: reviewerId });

    let label: string;
    if (becameSold) {
      label = `marked sold @ $${merged.salePrice!.toLocaleString()}`;
    } else if (diff.changedFields.includes("acquisitionCost") && record.costBasis?.acquisitionCost == null) {
      label = `acquisition cost set @ $${merged.acquisitionCost?.toLocaleString() ?? 0}`;
    } else {
      label = `cost-basis edited (${diff.changedFields.join(", ")})`;
    }

    appendEvent(ownerId, {
      sessionId: session.id,
      recordId: id,
      type: "report.updated",
      label,
      status: "passed",
      payload: {
        actor: reviewerId,
        changedFields: diff.changedFields,
        feeChange: diff.feeChange,
        before: {
          acquisitionCost: record.costBasis?.acquisitionCost ?? null,
          salePrice: record.costBasis?.salePrice ?? null,
          feesCount: record.costBasis?.fees?.length ?? 0,
        },
        after: {
          acquisitionCost: merged.acquisitionCost ?? null,
          salePrice: merged.salePrice ?? null,
          feesCount: merged.fees?.length ?? 0,
        },
      },
    });
  }

  const response = {
    ok: true as const,
    record: updated,
    changedFields: diff.changedFields,
    becameSold,
  };
  if (cacheKey) setIdempotent(cacheKey, response);
  return NextResponse.json(response);
}
