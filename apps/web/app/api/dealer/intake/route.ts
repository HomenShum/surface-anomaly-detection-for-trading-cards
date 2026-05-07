import { NextResponse } from "next/server";
import { detectCertLabels, imageHash } from "../../../../lib/dealer/ocr";
import { newId, upsertBatch, upsertRecord } from "../../../../lib/dealer/store";
import type { DealerRecord, DealerIntakeBatch } from "../../../../lib/dealer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12MB cap on inline base64 — well above a phone photo.

type IntakeRequest = {
  imageBase64: string;
  filename?: string;
  uploaderHint?: string;
};

function parseGradeFromOcr(text: string): string | undefined {
  // Loose match: "GEM MT 10", "MINT 9", "NM-MT 8", "EX-MT 6", etc.
  const m = text.match(/\b(GEM\s*MT\s*10|MINT\s*9|NM-?MT\s*8|EX-?MT\s*6|EX\s*5|VG-?EX\s*4|VG\s*3|GOOD\s*2|FAIR\s*1|POOR\s*1|10|9|8|7|6|5|4|3|2|1)\b/i);
  return m ? m[0].replace(/\s+/g, " ").toUpperCase() : undefined;
}

function bandFromGrade(grade?: string): string | undefined {
  if (!grade) return undefined;
  const num = grade.match(/\b(10|9|8|7|6|5|4|3|2|1)\b/);
  if (!num) return undefined;
  switch (num[1]) {
    case "10":
      return "950+_gem_pristine";
    case "9":
      return "900-949_mint";
    case "8":
      return "850-899_strong_nm_mint";
    case "7":
      return "800-849_near_mint";
    default:
      return "700-799_visible_issues";
  }
}

export async function POST(request: Request) {
  let body: IntakeRequest;
  try {
    body = (await request.json()) as IntakeRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }
  const sizeBytes = Math.floor((body.imageBase64.length * 3) / 4);
  if (sizeBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "image_too_large", maxBytes: MAX_BYTES, gotBytes: sizeBytes },
      { status: 413 },
    );
  }

  const batchId = newId("batch");
  const uploadedAt = new Date().toISOString();
  const hash = imageHash(body.imageBase64);

  let detection;
  try {
    detection = await detectCertLabels(body.imageBase64);
  } catch (err) {
    const batch: DealerIntakeBatch = {
      batchId,
      uploadedAt,
      uploaderHint: body.uploaderHint,
      inputFilename: body.filename,
      imageHash: hash,
      uniqueCertNumbers: [],
      recordIds: [],
      status: "failed",
    };
    upsertBatch(batch);
    return NextResponse.json(
      { error: "detect_failed", message: (err as Error).message, batchId },
      { status: 502 },
    );
  }

  const recordIds: string[] = [];
  for (const label of detection.labels) {
    const cert = label.candidateCerts[0];
    const grade = label.candidateGrades[0] ?? parseGradeFromOcr(label.ocrText);
    const id = newId("dlr");
    const rec: DealerRecord = {
      id,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
      inventoryType: "graded",
      lane: cert ? "certs_detected" : "uploaded",
      sourceBatchId: batchId,
      certNumber: cert,
      certProvider: cert ? "PSA" : undefined,
      certUrl: cert ? `https://www.psacard.com/cert/${cert}` : undefined,
      cardIdentity: undefined,
      quantity: 1,
      imageHash: hash,
      ocrText: label.ocrText,
      officialGrade: grade,
      officialBand: bandFromGrade(grade),
      modelFindings: [],
      consentFlag: "pending",
      trustTier: cert ? "silver" : "bronze",
    };
    upsertRecord(rec);
    recordIds.push(id);
  }

  // If detection produced zero labels we still record an "uploaded" placeholder so
  // the operator can see it landed. They can manually attach cert metadata later.
  if (recordIds.length === 0) {
    const id = newId("dlr");
    const rec: DealerRecord = {
      id,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
      inventoryType: "raw",
      lane: "uploaded",
      sourceBatchId: batchId,
      quantity: 1,
      imageHash: hash,
      modelFindings: [],
      notes: "OCR found no PSA-style cert labels in this image. Treating as a raw-card photo for manual review.",
      consentFlag: "pending",
      trustTier: "bronze",
    };
    upsertRecord(rec);
    recordIds.push(id);
  }

  const batch: DealerIntakeBatch = {
    batchId,
    uploadedAt,
    uploaderHint: body.uploaderHint,
    inputFilename: body.filename,
    imageHash: hash,
    uniqueCertNumbers: detection.uniqueCerts,
    recordIds,
    status: detection.uniqueCerts.length ? "ocr_complete" : "ocr_complete",
  };
  upsertBatch(batch);

  return NextResponse.json({
    batchId,
    imageHash: hash,
    detectedLabels: detection.labels.length,
    uniqueCerts: detection.uniqueCerts,
    recordIds,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST imageBase64 + optional filename to ingest a batch." });
}
