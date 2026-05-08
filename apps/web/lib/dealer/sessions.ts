/**
 * Owner-scoped ScanSession + InspectionEvent store.
 *
 * Per-owner files (under data/dealer/owners/<ownerId>/):
 *   sessions.jsonl   one row per session (status, mode, vault link)
 *   events.jsonl     one row per event (sessionId, type, label, bbox)
 *
 * Append-only. The seed-clone in store.ts copies the legacy
 * `data/dealer/{sessions,events}.jsonl` into a new owner's namespace
 * on first read so the demo timeline survives the migration.
 */

import { existsSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newId, ownerDir } from "./store";

export type ScanSessionMode =
  | "raw_scan"
  | "slab_scan"
  | "cert_import"
  | "before_after"
  | "demo";

export type ScanSessionStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "complete"
  | "failed";

export type ScanSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  mode: ScanSessionMode;
  status: ScanSessionStatus;
  vaultRecordId?: string;
  inputImageHashes: string[];
  reportId?: string;
  evidenceManifestId?: string;
  notes?: string;
};

export type InspectionEventType =
  | "stage.started"
  | "stage.completed"
  | "tool.started"
  | "tool.completed"
  | "warning"
  | "report.updated"
  | "evidence.saved"
  | "vault.saved";

export type InspectionEvent = {
  id: string;
  sessionId: string;
  recordId?: string;
  timestamp: string;
  type: InspectionEventType;
  label: string;
  targetRegion?: string;
  bboxNorm?: [number, number, number, number];
  status?: "waiting" | "running" | "passed" | "warning" | "failed";
  payload?: unknown;
};

function sessionsPath(ownerId: string): string {
  return join(ownerDir(ownerId), "sessions.jsonl");
}
function eventsPath(ownerId: string): string {
  return join(ownerDir(ownerId), "events.jsonl");
}

function readJsonl<T>(path: string): T[] {
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

export function openSession(
  ownerId: string,
  input: {
    mode?: ScanSessionMode;
    recordId?: string;
    inputImageHash?: string;
    notes?: string;
    userId?: string;
  },
): ScanSession {
  const now = new Date().toISOString();
  const session: ScanSession = {
    id: newId("ses"),
    createdAt: now,
    updatedAt: now,
    userId: input.userId ?? ownerId,
    mode: input.mode ?? "slab_scan",
    status: "running",
    vaultRecordId: input.recordId,
    inputImageHashes: input.inputImageHash ? [input.inputImageHash] : [],
    notes: input.notes,
  };
  appendFileSync(sessionsPath(ownerId), JSON.stringify(session) + "\n", "utf-8");
  return session;
}

export function appendEvent(
  ownerId: string,
  event: Omit<InspectionEvent, "id" | "timestamp">,
): InspectionEvent {
  const stamped: InspectionEvent = {
    ...event,
    id: newId("evt"),
    timestamp: new Date().toISOString(),
  };
  appendFileSync(eventsPath(ownerId), JSON.stringify(stamped) + "\n", "utf-8");
  return stamped;
}

export function loadEventsForSession(ownerId: string, sessionId: string): InspectionEvent[] {
  return readJsonl<InspectionEvent>(eventsPath(ownerId)).filter((e) => e.sessionId === sessionId);
}

export function loadEventsForRecord(ownerId: string, recordId: string): InspectionEvent[] {
  return readJsonl<InspectionEvent>(eventsPath(ownerId)).filter((e) => e.recordId === recordId);
}

export function loadSessionsForRecord(ownerId: string, recordId: string): ScanSession[] {
  return readJsonl<ScanSession>(sessionsPath(ownerId)).filter((s) => s.vaultRecordId === recordId);
}

export function loadAllSessions(ownerId: string): ScanSession[] {
  return readJsonl<ScanSession>(sessionsPath(ownerId));
}

export function loadSession(ownerId: string, sessionId: string): ScanSession | null {
  return readJsonl<ScanSession>(sessionsPath(ownerId)).find((s) => s.id === sessionId) ?? null;
}
