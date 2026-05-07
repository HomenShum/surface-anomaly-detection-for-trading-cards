import { NextResponse } from "next/server";
import {
  appendImportedCertifiedReferences,
  extractCertCandidates,
  loadAllCertifiedReferences,
  payloadToRawInputs,
  resolveCertifiedReference,
  type CertImportPayload,
  type CertReferenceCandidate,
} from "../../../../lib/cert-references";
import { extractFromCertImportFiles } from "../../../../lib/cert-references-ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    references: loadAllCertifiedReferences(),
  });
}

export async function POST(request: Request) {
  let body: CertImportPayload;
  try {
    body = (await request.json()) as CertImportPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // Text/filename candidates — same behaviour as before.
  const rawInputs = payloadToRawInputs(body);
  const textCandidates = extractCertCandidates(rawInputs);
  // Image OCR candidates — adapter is opt-in via OCR_ADAPTER env var; the
  // stub returns filename-derived candidates + adapter status notes.
  const ocr = await extractFromCertImportFiles(body.files ?? []);
  const merged = new Map<string, CertReferenceCandidate>();
  for (const c of textCandidates) merged.set(`${c.provider}:${c.certNumber}`, c);
  for (const c of ocr.candidates) merged.set(`${c.provider}:${c.certNumber}`, c);
  const candidates = [...merged.values()];

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No cert candidates found. Paste PSA cert URLs/numbers, TAG card URLs, or upload label screenshots with cert numbers in the filename/text.",
        ocrAdapterId: ocr.adapterId,
        ocrNotes: ocr.notes,
      },
      { status: 400 },
    );
  }

  const references = [];
  for (const candidate of candidates.slice(0, 50)) {
    references.push(await resolveCertifiedReference(candidate));
  }
  appendImportedCertifiedReferences(references);
  const allReferences = loadAllCertifiedReferences();

  return NextResponse.json({
    ok: true,
    candidates,
    references,
    allReferences,
    warnings: [
      ...references.flatMap((ref) => ref.warnings.map((warning) => `${ref.provider} ${ref.certNumber}: ${warning}`)),
      ...ocr.notes,
    ],
    ocrAdapterId: ocr.adapterId,
    message:
      "Certified references imported. PSA is API-first when a PSA API key is configured. TAG stays link-only unless user-provided screenshots or permission exists.",
  });
}
