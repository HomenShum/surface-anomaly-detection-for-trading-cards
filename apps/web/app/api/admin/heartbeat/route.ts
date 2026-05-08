import { NextResponse } from "next/server";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dealerDataDir } from "../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token-protected admin heartbeat. Returns the current per-owner
 * snapshot (count, last activity) plus a `threshold_exceeded` flag
 * the user wired to the 10-user alert.
 *
 * Auth: requires `Authorization: Bearer <ADMIN_HEARTBEAT_TOKEN>`. The
 * token is set as a Render env var; deploy guide explains how. If no
 * token is configured at all, the route returns 503 — never returns
 * the data unauthenticated.
 *
 * Side effects:
 *   - When `?notify=1` AND active owners > threshold, fires a webhook
 *     POST to `ADMIN_ALERT_WEBHOOK_URL` (Discord/Slack/Resend/etc).
 *     Idempotent within a 24h window via a simple in-memory marker.
 */

const DEFAULT_THRESHOLD = 10;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // owner counts as "active" if touched in last 7 days

let lastNotifiedAt: number | null = null;
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function ownersRoot(): string {
  return join(dealerDataDir(), "owners");
}

type OwnerSnapshot = {
  ownerId: string;
  kind: "anon" | "user" | "other";
  records: number;
  imagesBytes: number;
  lastActivityMs: number;
};

function safeStat(path: string): { size: number; mtimeMs: number } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function dirSize(dir: string): { bytes: number; latestMtime: number } {
  if (!existsSync(dir)) return { bytes: 0, latestMtime: 0 };
  let bytes = 0;
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(current, name);
      const st = safeStat(path);
      if (!st) continue;
      if ("isDirectory" in (st as object) && (statSync(path)).isDirectory()) {
        stack.push(path);
      } else {
        bytes += st.size;
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      }
    }
  }
  return { bytes, latestMtime: latest };
}

function lineCount(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const body = readFileSync(path, "utf-8");
    if (!body.trim()) return 0;
    return body.split(/\r?\n/).filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function snapshotOwner(ownerId: string): OwnerSnapshot {
  const root = join(ownersRoot(), ownerId);
  const recordsFile = join(root, "records.jsonl");
  const eventsFile = join(root, "events.jsonl");
  const imagesDir = join(root, "images");
  const records = lineCount(recordsFile);
  const recordsStat = safeStat(recordsFile);
  const eventsStat = safeStat(eventsFile);
  const imagesInfo = dirSize(imagesDir);
  const lastActivityMs = Math.max(
    recordsStat?.mtimeMs ?? 0,
    eventsStat?.mtimeMs ?? 0,
    imagesInfo.latestMtime,
  );
  const kind = ownerId.startsWith("anon_") ? "anon" : ownerId.startsWith("user_") ? "user" : "other";
  return { ownerId, kind, records, imagesBytes: imagesInfo.bytes, lastActivityMs };
}

async function fireWebhook(payload: Record<string, unknown>): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, error: "no_webhook_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Discord-friendly content key works for most webhook services;
        // payload is also flat at the top level for Slack/Resend/etc.
        content: payload.summary,
        ...payload,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fetch_failed" };
  }
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_HEARTBEAT_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "admin_heartbeat_disabled", hint: "Set ADMIN_HEARTBEAT_TOKEN env var to enable." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const threshold = Number(url.searchParams.get("threshold") ?? DEFAULT_THRESHOLD);
  const notifyOnExceeded = url.searchParams.get("notify") === "1";

  const root = ownersRoot();
  const ownerIds = existsSync(root)
    ? readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory())
    : [];
  const snapshots = ownerIds.map(snapshotOwner);
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const active = snapshots.filter((s) => s.lastActivityMs >= cutoff);

  const summary = {
    timestamp: new Date().toISOString(),
    totalOwners: snapshots.length,
    activeOwners: active.length,
    threshold,
    thresholdExceeded: active.length > threshold,
    anonOwners: snapshots.filter((s) => s.kind === "anon").length,
    signedInOwners: snapshots.filter((s) => s.kind === "user").length,
    totalRecords: snapshots.reduce((s, o) => s + o.records, 0),
    totalImageBytes: snapshots.reduce((s, o) => s + o.imagesBytes, 0),
  };

  let notify: { fired: boolean; reason?: string; webhook?: { ok: boolean; status?: number; error?: string } } = {
    fired: false,
  };
  if (notifyOnExceeded && summary.thresholdExceeded) {
    const cooldownActive = lastNotifiedAt !== null && Date.now() - lastNotifiedAt < NOTIFY_COOLDOWN_MS;
    if (cooldownActive) {
      notify = { fired: false, reason: "cooldown" };
    } else {
      const result = await fireWebhook({
        summary: `🚨 Card Condition Vault: ${summary.activeOwners} active owners exceeds threshold of ${threshold} (total ${summary.totalOwners}, ${summary.signedInOwners} signed in).`,
        ...summary,
      });
      lastNotifiedAt = Date.now();
      notify = { fired: true, webhook: result };
    }
  }

  return NextResponse.json(
    {
      ...summary,
      notify,
      owners: snapshots
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
        .slice(0, 50)
        .map((s) => ({
          ownerId: s.ownerId,
          kind: s.kind,
          records: s.records,
          imagesBytes: s.imagesBytes,
          lastActivity: new Date(s.lastActivityMs).toISOString(),
        })),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
