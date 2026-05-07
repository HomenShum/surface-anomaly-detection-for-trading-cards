import { NextResponse } from "next/server";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dealerDataDir } from "../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "drop",
  "decisionShown",
  "proofSaved",
  "seeWhyOpened",
  "returnVisit",
  "expertModeOpened",
]);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const event = String(body.event ?? "");
  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  }
  const stamped = { ...body, event, ts: new Date().toISOString() };
  const dir = dealerDataDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "behavior.jsonl");
  appendFileSync(path, JSON.stringify(stamped) + "\n", "utf-8");
  return NextResponse.json({ ok: true });
}
