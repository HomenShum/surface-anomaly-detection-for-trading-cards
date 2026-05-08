import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ownerDir } from "./store";

/**
 * Per-owner storage quotas. Vendor pilot scale assumes ~100 records and
 * ~10MB of images per active owner. We cap at 10x headroom so a runaway
 * intake script can't fill disk.
 *
 * Caps:
 *   MAX_RECORDS         = 1000  records per owner
 *   MAX_IMAGE_BYTES     = 100MB total uploaded image bytes per owner
 *   MAX_EVENTS          = 10_000 events per owner before rotation
 */

export const MAX_RECORDS = 1000;
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_EVENTS = 10_000;

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
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
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(path);
      else total += st.size;
    }
  }
  return total;
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

export type QuotaSnapshot = {
  records: number;
  recordsCap: number;
  imagesBytes: number;
  imagesBytesCap: number;
  events: number;
  eventsCap: number;
  recordsPctUsed: number;
  imagesPctUsed: number;
  eventsPctUsed: number;
  exceeded: { records: boolean; images: boolean; events: boolean };
};

export function quotaForOwner(ownerId: string): QuotaSnapshot {
  const root = ownerDir(ownerId);
  const records = lineCount(join(root, "records.jsonl"));
  const events = lineCount(join(root, "events.jsonl"));
  const imagesBytes = dirSize(join(root, "images"));
  const exceeded = {
    records: records >= MAX_RECORDS,
    images: imagesBytes >= MAX_IMAGE_BYTES,
    events: events >= MAX_EVENTS,
  };
  return {
    records,
    recordsCap: MAX_RECORDS,
    imagesBytes,
    imagesBytesCap: MAX_IMAGE_BYTES,
    events,
    eventsCap: MAX_EVENTS,
    recordsPctUsed: records / MAX_RECORDS,
    imagesPctUsed: imagesBytes / MAX_IMAGE_BYTES,
    eventsPctUsed: events / MAX_EVENTS,
    exceeded,
  };
}

/**
 * Throw a 4xx-shaped error when a write would push the owner over a cap.
 * Caller wraps it in a try/catch and turns it into a 413/422 response.
 */
export class QuotaExceededError extends Error {
  constructor(public readonly resource: "records" | "images" | "events", public readonly cap: number) {
    super(`quota_exceeded:${resource}`);
    this.name = "QuotaExceededError";
  }
}

export function assertCanCreateRecord(ownerId: string): void {
  const q = quotaForOwner(ownerId);
  if (q.exceeded.records) {
    throw new QuotaExceededError("records", q.recordsCap);
  }
}

export function assertCanUploadImage(ownerId: string, additionalBytes: number): void {
  const q = quotaForOwner(ownerId);
  if (q.imagesBytes + additionalBytes > q.imagesBytesCap) {
    throw new QuotaExceededError("images", q.imagesBytesCap);
  }
}

export function assertCanAppendEvent(ownerId: string): void {
  const q = quotaForOwner(ownerId);
  if (q.exceeded.events) {
    throw new QuotaExceededError("events", q.eventsCap);
  }
}
