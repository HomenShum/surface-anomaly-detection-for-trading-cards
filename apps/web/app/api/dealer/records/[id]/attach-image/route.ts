import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDealerDetector } from "../../../../../../lib/dealer/detector";
import { appendEvent, openSession } from "../../../../../../lib/dealer/sessions";
import { dealerDataDir, loadRecord, upsertRecord } from "../../../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = loadRecord(id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const imageBase64 = body.imageBase64;
  if (!imageBase64) return NextResponse.json({ error: "missing_image" }, { status: 400 });
  const sizeBytes = Math.floor((imageBase64.length * 3) / 4);
  if (sizeBytes > MAX_BYTES) {
    return NextResponse.json({ error: "image_too_large", maxBytes: MAX_BYTES }, { status: 413 });
  }

  const ext = (body.mimeType ?? "image/jpeg").includes("png") ? ".png" : ".jpg";
  const dir = join(dealerDataDir(), "images", id);
  mkdirSync(dir, { recursive: true });
  const filename = `slab${ext}`;
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, Buffer.from(imageBase64, "base64"));

  // Open a per-attach session so the audit trail captures the inspection
  // even when there is no upstream intake session (manual reupload via the
  // workbench). Existing intake sessions get their events appended too.
  const session = openSession({ mode: "slab_scan", recordId: id, notes: "attach-image" });
  appendEvent({
    sessionId: session.id,
    recordId: id,
    type: "stage.started",
    label: "Detector run",
    status: "running",
    targetRegion: "full_card",
  });

  let detectorResult;
  try {
    detectorResult = await runDealerDetector(imageBase64);
  } catch (err) {
    appendEvent({
      sessionId: session.id,
      recordId: id,
      type: "warning",
      label: `Detector unreachable: ${(err as Error).message}`,
      status: "failed",
    });
    // Persist the image attachment even if detector fails — operator can retry.
    const next = await upsertRecord({
      ...record,
      imageUrl: `/api/dealer/records/${id}/image`,
      imageHash: detectorResult?.imageHash,
      lane: "image_attached",
      notes: [record.notes, `Detector unreachable: ${(err as Error).message}`].filter(Boolean).join(" · "),
    });
    return NextResponse.json({ record: next, sessionId: session.id, detectorError: (err as Error).message }, { status: 502 });
  }

  // Emit one event per finding so the audit trail can replay zoom-region
  // and DING-detection moments later.
  for (const f of detectorResult.findings) {
    const [x1, y1, x2, y2] = f.bbox;
    appendEvent({
      sessionId: session.id,
      recordId: id,
      type: "tool.completed",
      label: `${f.type.replaceAll("_", " ")} (${Math.round(f.confidence * 100)}%) · ${f.severity}`,
      targetRegion: f.region ?? f.type,
      bboxNorm: [x1 / 100, y1 / 100, x2 / 100, y2 / 100],
      status: "passed",
      payload: { modelVersion: f.modelVersion },
    });
  }
  appendEvent({
    sessionId: session.id,
    recordId: id,
    type: "stage.completed",
    label: `Detector complete: ${detectorResult.findings.length} candidate finding(s)`,
    status: "passed",
    payload: { modelVersion: detectorResult.modelVersion },
  });

  const updated = await upsertRecord({
    ...record,
    imageUrl: `/api/dealer/records/${id}/image`,
    imageHash: detectorResult.imageHash,
    modelFindings: detectorResult.findings,
    lane: detectorResult.findings.length > 0 ? "human_review" : "ready",
    notes: detectorResult.summary
      ? [record.notes, `Detector: ${detectorResult.summary}`].filter(Boolean).join(" · ")
      : record.notes,
  });

  appendEvent({
    sessionId: session.id,
    recordId: id,
    type: "vault.saved",
    label: `Vault record updated · lane=${updated.lane}`,
    status: "passed",
  });

  return NextResponse.json({
    record: updated,
    sessionId: session.id,
    findings: detectorResult.findings,
    summary: detectorResult.summary,
    modelVersion: detectorResult.modelVersion,
  });
}
