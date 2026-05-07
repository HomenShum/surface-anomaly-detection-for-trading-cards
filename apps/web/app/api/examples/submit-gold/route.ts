import { NextResponse } from "next/server";
import { submitGoldExample, type SubmitGoldInput } from "../../../../lib/examples/gold-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: SubmitGoldInput;
  try {
    body = (await request.json()) as SubmitGoldInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.contributorHandle?.trim()) {
    return NextResponse.json({ ok: false, error: "contributorHandle required." }, { status: 400 });
  }
  if (!body?.title?.trim()) {
    return NextResponse.json({ ok: false, error: "title required." }, { status: 400 });
  }
  if (!Array.isArray(body?.dings)) {
    return NextResponse.json({ ok: false, error: "dings array required." }, { status: 400 });
  }
  if (!body?.imageDataUrl) {
    return NextResponse.json({ ok: false, error: "raw pre-submission imageDataUrl required for Gold." }, { status: 400 });
  }
  if (!body?.officialOutcome) {
    return NextResponse.json({ ok: false, error: "officialOutcome required for Gold." }, { status: 400 });
  }
  if (!body?.humanDingReviewApproved) {
    return NextResponse.json(
      { ok: false, error: "humanDingReviewApproved=true required for Gold, including clean-card reviews." },
      { status: 400 },
    );
  }
  if (!body?.ourPrediction) {
    return NextResponse.json({ ok: false, error: "ourPrediction required." }, { status: 400 });
  }

  const sanitized: SubmitGoldInput = {
    ...body,
    consentPublicAttribution: Boolean(body.consentPublicAttribution),
    consentPublicExample: Boolean(body.consentPublicExample),
    consentModelTraining: Boolean(body.consentModelTraining),
    humanDingReviewApproved: Boolean(body.humanDingReviewApproved),
    contributorHandle: body.contributorHandle.trim(),
    contributorDisplayName: body.contributorDisplayName?.trim(),
    dings: body.dings.slice(0, 32),
  };

  try {
    const record = submitGoldExample(sanitized);
    return NextResponse.json({
      ok: true,
      id: record.id,
      slug: record.slug,
      tier: "gold",
      contributorHandle: record.contributorHandle,
      consentPublicAttribution: record.consentPublicAttribution,
      consentPublicExample: record.consentPublicExample,
      consentModelTraining: record.consentModelTraining,
      message: record.consentPublicExample
        ? "Gold record saved. It will appear on /examples with a Gold trust badge. Raw image bytes are stored locally per your public-example consent."
        : "Gold record saved for evaluation/training gates. It will not appear publicly because public-example consent is off.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "submit-gold failed" },
      { status: 500 },
    );
  }
}
