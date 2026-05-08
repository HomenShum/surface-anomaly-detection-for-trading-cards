/**
 * Persistent ScanSession + InspectionEvent store.
 *
 * Each /api/dealer/intake POST opens a session. attach-image, review,
 * and evidence endpoints append events. The audit trail on the report
 * page replays the events in order: same data the friend sees in the
 * "Audit trail" expandable on the focused workbench.
 *
 * Files (under data/dealer/):
 *   sessions.jsonl       one row per session (status, mode, vault link)
 *   events.jsonl         one row per event (sessionId, type, label, bbox)
 *
 * No DB. Append-only. Vendor-pilot scale.
 */

import { existsSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dealerDataDir, newId } from "./store";

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

const SESSIONS_PATH = () => join(dealerDataDir(), "sessions.jsonl");
const EVENTS_PATH = () => join(dealerDataDir(), "events.jsonl");

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
      // skip
    }
  }
  return out;
}

export function openSession(input: {
  mode?: ScanSessionMode;
  recordId?: string;
  inputImageHash?: string;
  notes?: string;
  userId?: string;
}): ScanSession {
  const now = new Date().toISOString();
  const session: ScanSession = {
    id: newId("ses"),
    createdAt: now,
    updatedAt: now,
    userId: input.userId,
    mode: input.mode ?? "slab_scan",
    status: "running",
    vaultRecordId: input.recordId,
    inputImageHashes: input.inputImageHash ? [input.inputImageHash] : [],
    notes: input.notes,
  };
  appendFileSync(SESSIONS_PATH(), JSON.stringify(session) + "\n", "utf-8");
  return session;
}

export function appendEvent(event: Omit<InspectionEvent, "id" | "timestamp">): InspectionEvent {
  const stamped: InspectionEvent = {
    ...event,
    id: newId("evt"),
    timestamp: new Date().toISOString(),
  };
  appendFileSync(EVENTS_PATH(), JSON.stringify(stamped) + "\n", "utf-8");
  return stamped;
}

export function loadEventsForSession(sessionId: string): InspectionEvent[] {
  return readJsonl<InspectionEvent>(EVENTS_PATH()).filter((e) => e.sessionId === sessionId);
}

export function loadEventsForRecord(recordId: string): InspectionEvent[] {
  return readJsonl<InspectionEvent>(EVENTS_PATH()).filter((e) => e.recordId === recordId);
}

export function loadSessionsForRecord(recordId: string): ScanSession[] {
  return readJsonl<ScanSession>(SESSIONS_PATH()).filter((s) => s.vaultRecordId === recordId);
}

export function loadAllSessions(): ScanSession[] {
  return readJsonl<ScanSession>(SESSIONS_PATH());
}

export function loadSession(sessionId: string): ScanSession | null {
  return readJsonl<ScanSession>(SESSIONS_PATH()).find((s) => s.id === sessionId) ?? null;
}
