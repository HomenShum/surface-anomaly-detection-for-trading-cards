import { NextResponse } from "next/server";
import { buildEvidenceBody, evidencePacketHtml, evidencePacketSummary, signEvidence } from "../../../../../../lib/dealer/evidence";
import { appendEvent, openSession } from "../../../../../../lib/dealer/sessions";
import { loadRecord, upsertRecord } from "../../../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = loadRecord(id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (format === "html") {
    const html = evidencePacketHtml(record);
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const body = buildEvidenceBody(record);
  const signed = signEvidence(body);
  return NextResponse.json(signed);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = loadRecord(id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const summary = evidencePacketSummary(record);
  const updated = await upsertRecord({ ...record, evidencePacket: summary });
  const session = openSession({ mode: "slab_scan", recordId: id, notes: "evidence:save" });
  appendEvent({
    sessionId: session.id,
    recordId: id,
    type: "evidence.saved",
    label: `Signed evidence packet generated · ${summary.acceptedDetectionsCount}/${summary.detectionsCount} accepted`,
    status: "passed",
    payload: { packetId: summary.packetId, signature: summary.signature?.slice(0, 16) },
  });
  return NextResponse.json({ record: updated, evidencePacket: summary, sessionId: session.id });
}
