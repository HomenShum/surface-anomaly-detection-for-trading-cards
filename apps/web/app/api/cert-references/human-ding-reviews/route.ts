import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { loadAllCertifiedReferences, repoRoot } from "../../../../lib/cert-references";
import type { ExampleDing } from "../../../../lib/examples/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HumanDingReviewInput = {
  certId: string;
  reviewerHandle: string;
  consentToStoreReview: boolean;
  reviewedImageSource?: "raw_pre_submission" | "slab_front" | "slab_back" | "other";
  cleanCardAttestation?: boolean;
  dings: ExampleDing[];
  notes?: string;
};

function reviewPath() {
  const dir = join(repoRoot(), "data", "cert-references");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "human-ding-reviews.jsonl");
}

function normalizeHandle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "anon-reviewer";
}

function validateDing(ding: ExampleDing) {
  if (!Array.isArray(ding.bbox) || ding.bbox.length !== 4) return "Each DING bbox must be [x1,y1,x2,y2].";
  if (ding.bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return "Each DING bbox coordinate must be 0..100 percent.";
  }
  if (!ding.type || !ding.severity || typeof ding.materialToGrade !== "boolean" || !ding.note || !ding.source) {
    return "Each DING requires type, severity, materialToGrade, note, and source.";
  }
  return null;
}

export async function GET() {
  const path = reviewPath();
  const reviews = existsSync(path)
    ? readFileSync(path, "utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
  return NextResponse.json({ ok: true, count: reviews.length, reviews });
}

export async function POST(request: Request) {
  let body: HumanDingReviewInput;
  try {
    body = (await request.json()) as HumanDingReviewInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const certId = String(body.certId ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(certId)) {
    return NextResponse.json({ ok: false, error: "certId must match [a-z0-9_]+." }, { status: 400 });
  }
  if (!body.consentToStoreReview) {
    return NextResponse.json({ ok: false, error: "consentToStoreReview=true is required." }, { status: 400 });
  }
  if (!body.reviewerHandle?.trim()) {
    return NextResponse.json({ ok: false, error: "reviewerHandle required." }, { status: 400 });
  }
  if (!Array.isArray(body.dings)) {
    return NextResponse.json({ ok: false, error: "dings array required." }, { status: 400 });
  }
  if (body.dings.length === 0 && !body.cleanCardAttestation) {
    return NextResponse.json(
      { ok: false, error: "Clean cards require cleanCardAttestation=true when no DINGs are present." },
      { status: 400 },
    );
  }
  for (const ding of body.dings) {
    const problem = validateDing(ding);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  }

  const ref = loadAllCertifiedReferences().find((item) => item.id === certId);
  const review = {
    schemaVersion: 1,
    reviewId: `hdr_${createHash("sha256")
      .update(`${certId}:${body.reviewerHandle}:${Date.now()}:${JSON.stringify(body.dings)}`)
      .digest("hex")
      .slice(0, 12)}`,
    certId,
    provider: ref?.provider ?? null,
    certNumber: ref?.certNumber ?? null,
    reviewerHandle: normalizeHandle(body.reviewerHandle),
    reviewedImageSource: body.reviewedImageSource ?? "other",
    cleanCardAttestation: Boolean(body.cleanCardAttestation),
    dingCount: body.dings.length,
    dings: body.dings,
    notes: body.notes ?? null,
    consentToStoreReview: true,
    createdAt: new Date().toISOString(),
  };

  appendFileSync(reviewPath(), `${JSON.stringify(review)}\n`, "utf-8");
  return NextResponse.json({
    ok: true,
    review,
    message:
      "Human DING review stored. Production readiness will count it after the readiness/eval scripts reload the cert-reference registry.",
  });
}
