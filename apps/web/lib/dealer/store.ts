/**
 * File-backed JSONL store for the dealer pilot.
 *
 * - One file per surface (intake.jsonl, listings.jsonl, submissions.jsonl,
 *   alerts.jsonl) under data/dealer/.
 * - Each line is one record. Updates are upsert-by-id, written by reading
 *   all rows, replacing the matching id, and rewriting atomically via a
 *   temp-file + rename so a crash mid-write doesn't corrupt the file.
 * - No DB. No locking primitives. Vendor pilot scale only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { DealerRecord, DealerIntakeBatch, DealerLane } from "./types";

function repoRoot(): string {
  const cwd = process.cwd();
  // From apps/web (next runtime), repo root is two up; from repo root, cwd is correct.
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybe = resolve(cwd, "..", "..");
  if (existsSync(join(maybe, "pnpm-workspace.yaml"))) return maybe;
  return cwd;
}

export function dealerDataDir(): string {
  const root = repoRoot();
  const dir = join(root, "data", "dealer");
  mkdirSync(dir, { recursive: true });
  return dir;
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
      // skip malformed line
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

// ─── Records ────────────────────────────────────────────────────────────

const RECORDS_PATH = () => join(dealerDataDir(), "records.jsonl");

export function loadAllRecords(): DealerRecord[] {
  return readLines<DealerRecord>(RECORDS_PATH());
}

export function loadRecord(id: string): DealerRecord | null {
  return loadAllRecords().find((r) => r.id === id) ?? null;
}

export function upsertRecord(record: DealerRecord): DealerRecord {
  const rows = loadAllRecords();
  const idx = rows.findIndex((r) => r.id === record.id);
  const stamped = { ...record, updatedAt: new Date().toISOString() };
  if (idx >= 0) rows[idx] = stamped;
  else rows.push(stamped);
  writeAll(RECORDS_PATH(), rows);
  return stamped;
}

export function deleteRecord(id: string): boolean {
  const rows = loadAllRecords();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  rows.splice(idx, 1);
  writeAll(RECORDS_PATH(), rows);
  return true;
}

export function recordsByLane(lane: DealerLane): DealerRecord[] {
  return loadAllRecords().filter((r) => r.lane === lane);
}

// ─── Batches ────────────────────────────────────────────────────────────

const BATCHES_PATH = () => join(dealerDataDir(), "intake-batches.jsonl");

export function loadAllBatches(): DealerIntakeBatch[] {
  return readLines<DealerIntakeBatch>(BATCHES_PATH());
}

export function loadBatch(batchId: string): DealerIntakeBatch | null {
  return loadAllBatches().find((b) => b.batchId === batchId) ?? null;
}

export function upsertBatch(batch: DealerIntakeBatch): DealerIntakeBatch {
  const rows = loadAllBatches();
  const idx = rows.findIndex((r) => r.batchId === batch.batchId);
  if (idx >= 0) rows[idx] = batch;
  else rows.push(batch);
  writeAll(BATCHES_PATH(), rows);
  return batch;
}

// ─── Aggregates ─────────────────────────────────────────────────────────

export function recordsCountByLane(): Record<DealerLane, number> {
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
  for (const r of loadAllRecords()) counts[r.lane] = (counts[r.lane] ?? 0) + 1;
  return counts;
}
