import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDealerDetector } from "../../../../../../lib/dealer/detector";
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

  let detectorResult;
  try {
    detectorResult = await runDealerDetector(imageBase64);
  } catch (err) {
    // Persist the image attachment even if detector fails — operator can retry.
    const next = await upsertRecord({
      ...record,
      imageUrl: `/api/dealer/records/${id}/image`,
      imageHash: detectorResult?.imageHash,
      lane: "image_attached",
      notes: [record.notes, `Detector unreachable: ${(err as Error).message}`].filter(Boolean).join(" · "),
    });
    return NextResponse.json({ record: next, detectorError: (err as Error).message }, { status: 502 });
  }

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

  return NextResponse.json({
    record: updated,
    findings: detectorResult.findings,
    summary: detectorResult.summary,
    modelVersion: detectorResult.modelVersion,
  });
}
