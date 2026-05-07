import { NextResponse } from "next/server";
import { explainCardReport } from "../../../../lib/agent/card-report-agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const response = await explainCardReport({
    cardId: body.cardId,
    prompt: String(body.prompt ?? "Explain this card condition report."),
    reportJson: body.reportJson,
    evidenceManifest: body.evidenceManifest,
  });
  return NextResponse.json(response);
}
