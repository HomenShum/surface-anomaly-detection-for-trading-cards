/**
 * Owner-scoped JSONL store for the dealer-OS.
 *
 * Per-owner data layout:
 *   data/dealer/owners/<ownerId>/records.jsonl
 *   data/dealer/owners/<ownerId>/intake-batches.jsonl
 *   data/dealer/owners/<ownerId>/sessions.jsonl
 *   data/dealer/owners/<ownerId>/events.jsonl
 *   data/dealer/owners/<ownerId>/images/<recordId>/slab.{jpg,png,...}
 *
 * Legacy (un-namespaced) files at `data/dealer/<file>.jsonl` are the
 * **shared seed**: every new owner gets a one-time clone of those JSONL
 * files into their own namespace on first read. Image lookups also
 * fall through to the legacy `data/dealer/images/...` directory so the
 * 60+ Pokemon TCG fixtures we already have on disk don't have to be
 * copied for every new user.
 *
 * Persistence semantics:
 *   - JSONL files: read-replace-write atomically via temp file + rename
 *   - Append-only events: appendFileSync (no read-write cycle)
 *   - Updates are upsert-by-id; ids never change
 *
 * Vendor-pilot scale only. Past ~10k records or ~50 concurrent owners,
 * swap the JSONL backend for SQLite + per-owner row scoping.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { DealerRecord, DealerIntakeBatch, DealerLane } from "./types";

function repoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybe = resolve(cwd, "..", "..");
  if (existsSync(join(maybe, "pnpm-workspace.yaml"))) return maybe;
  return cwd;
}

/**
 * Repo-level dealer data dir — `data/dealer/`. Holds the shared seed
 * JSONL files at its top level + an `owners/` subdir for per-owner
 * namespaces.
 */
export function dealerDataDir(): string {
  const root = repoRoot();
  const dir = join(root, "data", "dealer");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-owner data dir (creates it if missing). */
export function ownerDir(ownerId: string): string {
  const dir = join(dealerDataDir(), "owners", ownerId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-owner image dir for a given record. */
export function ownerImageDir(ownerId: string, recordId: string): string {
  const dir = join(ownerDir(ownerId), "images", recordId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SEED_FILES = ["records.jsonl", "intake-batches.jsonl", "sessions.jsonl", "events.jsonl"] as const;

/** Track which owner namespaces we've already seeded this process. */
const seededOwners = new Set<string>();

/**
 * Bootstrap a fresh owner namespace by copying the legacy seed files.
 * Called on every store entry point — the in-memory `seededOwners`
 * cache makes subsequent calls a no-op after the first.
 */
function seedOwnerIfMissing(ownerId: string): void {
  if (seededOwners.has(ownerId)) return;
  const dir = ownerDir(ownerId);
  // If records.jsonl already exists in the owner's dir, treat the
  // namespace as initialized even if the other files are missing.
  if (existsSync(join(dir, "records.jsonl"))) {
    seededOwners.add(ownerId);
    return;
  }
  const legacy = dealerDataDir();
  for (const name of SEED_FILES) {
    const src = join(legacy, name);
    const dst = join(dir, name);
    if (existsSync(dst)) continue;
    if (existsSync(src)) {
      try {
        copyFileSync(src, dst);
      } catch {
        // best-effort: fall through to the empty file write below
      }
    }
    if (!existsSync(dst)) {
      // Create an empty file so we don't try to seed again.
      writeFileSync(dst, "", "utf-8");
    }
  }
  seededOwners.add(ownerId);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

function readLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf-8");
  if (!body.trim()) return [];
  const out: T[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // skip malformed
    }
  }
  return out;
}

function writeAll(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, path);
}

// ─── Path helpers ──────────────────────────────────────────────────────

export function recordsPath(ownerId: string): string {
  seedOwnerIfMissing(ownerId);
  return join(ownerDir(ownerId), "records.jsonl");
}

export function batchesPath(ownerId: string): string {
  seedOwnerIfMissing(ownerId);
  return join(ownerDir(ownerId), "intake-batches.jsonl");
}

// ─── Identity-cache hydration (shared, not per-owner) ──────────────────

type IdentityCacheEntry = { imageUrl?: string; matchedName?: string; setName?: string | null };

let identityCacheCache: { mtime: number; data: Record<string, IdentityCacheEntry> } | null = null;

function loadIdentityCache(): Record<string, IdentityCacheEntry> {
  const path = join(repoRoot(), "data", "cert-references", "identity-cache.json");
  if (!existsSync(path)) return {};
  try {
    const stat = require("node:fs").statSync(path);
    const mtime = stat.mtimeMs;
    if (identityCacheCache && identityCacheCache.mtime === mtime) return identityCacheCache.data;
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, IdentityCacheEntry>;
    identityCacheCache = { mtime, data };
    return data;
  } catch {
    return {};
  }
}

function hydrateRecord(record: DealerRecord, cache: Record<string, IdentityCacheEntry>): DealerRecord {
  const candidateKeys: string[] = [];
  if (record.certNumber && record.certProvider) {
    candidateKeys.push(`${record.certProvider.toLowerCase()}_${record.certNumber}`);
  }
  if (record.id.startsWith("dlr_seed_")) {
    candidateKeys.push(record.id.slice("dlr_seed_".length));
  }
  let cacheHit: IdentityCacheEntry | undefined;
  for (const key of candidateKeys) {
    if (cache[key]) {
      cacheHit = cache[key];
      break;
    }
  }
  if (!cacheHit) return record;
  const next: DealerRecord = { ...record };
  if (!next.imageUrl && cacheHit.imageUrl) next.imageUrl = cacheHit.imageUrl;
  if (!next.cardIdentity && cacheHit.matchedName) {
    const setSuffix = cacheHit.setName ? ` · ${cacheHit.setName}` : "";
    next.cardIdentity = `${cacheHit.matchedName}${setSuffix}`;
  }
  return next;
}

// ─── Records (owner-scoped, with mtime-keyed read cache) ───────────────

/**
 * Per-owner records cache. Keyed by ownerId; invalidated when the
 * file's mtime changes. Cuts SSR latency for pages that call
 * `loadAllRecords()` from ~5ms (parse 90 records) to <0.1ms (cache hit).
 *
 * Bounded at 64 owners — older entries are evicted when a 65th lands.
 * For a 10-vendor pilot this never evicts; for larger scale the
 * pattern still holds because access is bursty per-owner.
 */
const RECORDS_CACHE_MAX = 64;
let recordsCache = new Map<string, { mtime: number; data: DealerRecord[] }>();

function mtimeOf(path: string): number {
  try {
    const stat = require("node:fs").statSync(path) as { mtimeMs: number };
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

export function loadAllRecords(ownerId: string): DealerRecord[] {
  const path = recordsPath(ownerId);
  const mtime = mtimeOf(path);
  const cached = recordsCache.get(ownerId);
  if (cached && cached.mtime === mtime && mtime > 0) {
    // Refresh insertion order (LRU touch).
    recordsCache.delete(ownerId);
    recordsCache.set(ownerId, cached);
    return cached.data;
  }
  const rows = readLines<DealerRecord>(path);
  const cache = loadIdentityCache();
  const hydrated = rows.map((r) => hydrateRecord(r, cache));
  recordsCache.set(ownerId, { mtime, data: hydrated });
  if (recordsCache.size > RECORDS_CACHE_MAX) {
    const firstKey = recordsCache.keys().next().value;
    if (firstKey !== undefined) recordsCache.delete(firstKey);
  }
  return hydrated;
}

/** Invalidate the records cache for a single owner. Called automatically
 *  by upsertRecord/deleteRecord after writes. */
function invalidateRecordsCache(ownerId: string): void {
  recordsCache.delete(ownerId);
}

export function loadRecord(ownerId: string, id: string): DealerRecord | null {
  return loadAllRecords(ownerId).find((r) => r.id === id) ?? null;
}

export function upsertRecord(ownerId: string, record: DealerRecord): DealerRecord {
  const rows = loadAllRecords(ownerId);
  const idx = rows.findIndex((r) => r.id === record.id);
  const stamped = { ...record, updatedAt: new Date().toISOString() };
  if (idx >= 0) rows[idx] = stamped;
  else rows.push(stamped);
  writeAll(recordsPath(ownerId), rows);
  invalidateRecordsCache(ownerId);
  return stamped;
}

export function deleteRecord(ownerId: string, id: string): boolean {
  const rows = loadAllRecords(ownerId);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  rows.splice(idx, 1);
  writeAll(recordsPath(ownerId), rows);
  invalidateRecordsCache(ownerId);
  return true;
}

export function recordsByLane(ownerId: string, lane: DealerLane): DealerRecord[] {
  return loadAllRecords(ownerId).filter((r) => r.lane === lane);
}

// ─── Batches (owner-scoped) ────────────────────────────────────────────

export function loadAllBatches(ownerId: string): DealerIntakeBatch[] {
  return readLines<DealerIntakeBatch>(batchesPath(ownerId));
}

export function loadBatch(ownerId: string, batchId: string): DealerIntakeBatch | null {
  return loadAllBatches(ownerId).find((b) => b.batchId === batchId) ?? null;
}

export function upsertBatch(ownerId: string, batch: DealerIntakeBatch): DealerIntakeBatch {
  const rows = loadAllBatches(ownerId);
  const idx = rows.findIndex((r) => r.batchId === batch.batchId);
  if (idx >= 0) rows[idx] = batch;
  else rows.push(batch);
  writeAll(batchesPath(ownerId), rows);
  return batch;
}

// ─── Aggregates ─────────────────────────────────────────────────────────

export function recordsCountByLane(ownerId: string): Record<DealerLane, number> {
  const counts: Record<DealerLane, number> = {
    uploaded: 0,
    certs_detected: 0,
    verified: 0,
    image_attached: 0,
    ready: 0,
    human_review: 0,
    listed: 0,
    submitted: 0,
    sold: 0,
  };
  for (const r of loadAllRecords(ownerId)) counts[r.lane] = (counts[r.lane] ?? 0) + 1;
  return counts;
}

// ─── Image path resolution ─────────────────────────────────────────────

/**
 * Find the image file for a record. Owner-scoped path takes priority
 * (so user uploads aren't shadowed by seed images), but we fall back
 * to the legacy `data/dealer/images/<recordId>/` so that the 60+
 * fixture cards seeded into every new vault still render their slab
 * art without having to copy bytes per-owner.
 */
export function resolveSlabImagePath(ownerId: string, recordId: string): { path: string; ext: string } | null {
  const candidates = ["slab.jpg", "slab.jpeg", "slab.png", "slab.webp"];
  const owned = join(ownerDir(ownerId), "images", recordId);
  for (const name of candidates) {
    const p = join(owned, name);
    if (existsSync(p)) return { path: p, ext: name.slice(name.lastIndexOf(".")) };
  }
  const legacy = join(dealerDataDir(), "images", recordId);
  for (const name of candidates) {
    const p = join(legacy, name);
    if (existsSync(p)) return { path: p, ext: name.slice(name.lastIndexOf(".")) };
  }
  return null;
}
