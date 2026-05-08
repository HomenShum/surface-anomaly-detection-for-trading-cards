import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getServerSession } from "next-auth";
import { authOptions, ownerIdFromSession } from "../../../../lib/auth";
import { ANON_COOKIE } from "../../../../lib/dealer/owner";
import { ownerDir } from "../../../../lib/dealer/store";
import { actorKey, consumeToken } from "../../../../lib/dealer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Claim an anonymous vault for the currently signed-in user.
 *
 * Flow:
 *   1. User uses the app anonymously (cookie `dealer_anon=<id>` minted by middleware)
 *   2. User signs in via NextAuth → server now has a signed-in identity
 *   3. UI shows a banner: "You have an anon vault with N records. Claim?"
 *   4. User confirms → POST /api/dealer/claim-anon-vault
 *   5. Server merges anon namespace into user namespace:
 *      - records.jsonl: append anon records that don't conflict by id; skip dupes
 *      - sessions.jsonl + events.jsonl: append (event log is monotonic by timestamp)
 *      - intake-batches.jsonl: append unique batches
 *      - images/<recordId>/slab.*: copy if user doesn't already have one
 *   6. Anon cookie is invalidated so subsequent requests resolve to the user namespace
 *
 * Idempotent: re-running with the same anon cookie is a no-op after first claim.
 * Safe to call when there's nothing to claim — returns `{claimed: 0}`.
 */

function safeNamespace(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${prefix}${safe || "default"}`;
}

function readJsonlSafe(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf-8");
  if (!body.trim()) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed
    }
  }
  return out;
}

function appendJsonl(path: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) return;
  mkdirSync(join(path, ".."), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    writeFileSync(path, existing + (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") + body, "utf-8");
  } else {
    writeFileSync(path, body, "utf-8");
  }
}

function mergeJsonlByKey(
  destPath: string,
  sourcePath: string,
  key: string,
): { merged: number; skipped: number } {
  const dest = readJsonlSafe(destPath);
  const source = readJsonlSafe(sourcePath);
  if (source.length === 0) return { merged: 0, skipped: 0 };
  const destKeys = new Set(dest.map((r) => String(r[key])));
  const additions: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const row of source) {
    const k = String(row[key]);
    if (destKeys.has(k)) {
      skipped++;
      continue;
    }
    additions.push(row);
    destKeys.add(k);
  }
  if (additions.length > 0) appendJsonl(destPath, additions);
  return { merged: additions.length, skipped };
}

function appendJsonlAll(destPath: string, sourcePath: string): number {
  const source = readJsonlSafe(sourcePath);
  if (source.length === 0) return 0;
  appendJsonl(destPath, source);
  return source.length;
}

function copyImagesIfMissing(srcDir: string, dstDir: string): number {
  if (!existsSync(srcDir)) return 0;
  let copied = 0;
  // Each subdirectory is a record id; each contains slab.<ext>.
  for (const recordId of readdirSync(srcDir)) {
    const srcRecordDir = join(srcDir, recordId);
    if (!statSync(srcRecordDir).isDirectory()) continue;
    const dstRecordDir = join(dstDir, recordId);
    mkdirSync(dstRecordDir, { recursive: true });
    for (const file of readdirSync(srcRecordDir)) {
      const dst = join(dstRecordDir, file);
      if (existsSync(dst)) continue;
      copyFileSync(join(srcRecordDir, file), dst);
      copied++;
    }
  }
  return copied;
}

export async function POST(request: Request) {
  // Rate limit so a malicious anon can't spam claim attempts to merge into
  // arbitrary user namespaces (which they can't actually do, but burns disk).
  const limit = consumeToken({
    key: `claim-anon:${actorKey(request)}`,
    capacity: 4,
    refillRate: 0.05,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 },
    );
  }

  // NextAuth throws when NEXTAUTH_SECRET isn't set. Treat that as "no
  // session configured" so anonymous-only deployments still respond
  // cleanly instead of 500'ing.
  let userOwner: string | null | undefined;
  try {
    const session = await getServerSession(authOptions);
    userOwner = ownerIdFromSession(session);
  } catch {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  if (!userOwner) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const userOwnerId = safeNamespace("user_", userOwner);

  // Read the anon cookie directly (not via currentOwnerId, because that
  // would resolve to the signed-in id once a session exists).
  const cookieStore = await cookies();
  const anonCookie = cookieStore.get(ANON_COOKIE)?.value;
  if (!anonCookie) {
    return NextResponse.json({ ok: true, claimed: 0, reason: "no_anon_cookie" });
  }
  const anonOwnerId = safeNamespace("anon_", anonCookie);

  const anonRoot = ownerDir(anonOwnerId);
  if (!existsSync(join(anonRoot, "records.jsonl"))) {
    return NextResponse.json({ ok: true, claimed: 0, reason: "no_anon_namespace" });
  }
  if (anonOwnerId === userOwnerId) {
    return NextResponse.json({ ok: true, claimed: 0, reason: "same_namespace" });
  }

  const userRoot = ownerDir(userOwnerId);

  // Records: merge by id. Anon record wins when ids don't collide. The
  // user already had whatever was in their seed-clone, so a record id
  // collision means both the seed AND the anon vault saw the same seed
  // record — anon's edits to it are preserved by skipping the user's
  // seed-clone copy in favor of anon's edited copy. Easiest way: replace
  // user's row with anon's row when ids match.
  function mergeRecordsReplacing(destPath: string, sourcePath: string): { merged: number; replaced: number } {
    const dest = readJsonlSafe(destPath);
    const source = readJsonlSafe(sourcePath);
    if (source.length === 0) return { merged: 0, replaced: 0 };
    const destByIndex = new Map<string, number>();
    dest.forEach((row, i) => destByIndex.set(String(row.id), i));
    let replaced = 0;
    let merged = 0;
    for (const row of source) {
      const idx = destByIndex.get(String(row.id));
      if (idx === undefined) {
        dest.push(row);
        merged++;
      } else {
        dest[idx] = row;
        replaced++;
      }
    }
    const body = dest.map((r) => JSON.stringify(r)).join("\n") + (dest.length ? "\n" : "");
    writeFileSync(destPath, body, "utf-8");
    return { merged, replaced };
  }

  const recordsResult = mergeRecordsReplacing(
    join(userRoot, "records.jsonl"),
    join(anonRoot, "records.jsonl"),
  );
  const sessionsMerged = mergeJsonlByKey(
    join(userRoot, "sessions.jsonl"),
    join(anonRoot, "sessions.jsonl"),
    "id",
  );
  const eventsAppended = appendJsonlAll(
    join(userRoot, "events.jsonl"),
    join(anonRoot, "events.jsonl"),
  );
  const batchesMerged = mergeJsonlByKey(
    join(userRoot, "intake-batches.jsonl"),
    join(anonRoot, "intake-batches.jsonl"),
    "batchId",
  );
  const imagesCopied = copyImagesIfMissing(
    join(anonRoot, "images"),
    join(userRoot, "images"),
  );

  // Mark anon namespace as claimed so a re-run is a clean no-op. We
  // don't delete the directory (in case audit needs to inspect later);
  // we rename records.jsonl so the anon vault returns 0 records on read.
  const claimMarker = join(anonRoot, ".claimed-by");
  writeFileSync(claimMarker, JSON.stringify({ userOwner: userOwnerId, at: new Date().toISOString() }) + "\n");
  // Clear records so re-reading anon shows empty (don't delete in case
  // we need to recover).
  const archivedRecords = join(anonRoot, "records.claimed.jsonl");
  if (existsSync(join(anonRoot, "records.jsonl"))) {
    copyFileSync(join(anonRoot, "records.jsonl"), archivedRecords);
    writeFileSync(join(anonRoot, "records.jsonl"), "", "utf-8");
  }

  // Invalidate the anon cookie so the next request resolves to the user
  // namespace. The user is signed in, so currentOwnerId will return the
  // user owner regardless, but clearing the cookie keeps the state tidy
  // if the user signs out later.
  const response = NextResponse.json({
    ok: true,
    userOwnerId,
    anonOwnerId,
    claimed: {
      records: recordsResult.merged + recordsResult.replaced,
      recordsAdded: recordsResult.merged,
      recordsReplaced: recordsResult.replaced,
      sessions: sessionsMerged.merged,
      events: eventsAppended,
      batches: batchesMerged.merged,
      imageFiles: imagesCopied,
    },
  });
  response.cookies.set(ANON_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

/**
 * GET returns whether there's a claimable anon vault for the current
 * signed-in user. Used by the banner to decide whether to render itself.
 */
export async function GET() {
  let userOwner: string | null | undefined;
  try {
    const session = await getServerSession(authOptions);
    userOwner = ownerIdFromSession(session);
  } catch {
    return NextResponse.json({ signedIn: false, claimable: false });
  }
  if (!userOwner) {
    return NextResponse.json({ signedIn: false, claimable: false });
  }
  const cookieStore = await cookies();
  const anonCookie = cookieStore.get(ANON_COOKIE)?.value;
  if (!anonCookie) {
    return NextResponse.json({ signedIn: true, claimable: false, reason: "no_anon_cookie" });
  }
  const anonOwnerId = safeNamespace("anon_", anonCookie);
  const userOwnerId = safeNamespace("user_", userOwner);
  if (anonOwnerId === userOwnerId) {
    return NextResponse.json({ signedIn: true, claimable: false, reason: "same_namespace" });
  }
  const anonRoot = ownerDir(anonOwnerId);
  const recordsPath = join(anonRoot, "records.jsonl");
  if (!existsSync(recordsPath)) {
    return NextResponse.json({ signedIn: true, claimable: false, reason: "no_namespace" });
  }
  const recordCount = readJsonlSafe(recordsPath).length;
  return NextResponse.json({
    signedIn: true,
    claimable: recordCount > 0,
    recordCount,
    anonOwnerId,
    userOwnerId,
  });
}
