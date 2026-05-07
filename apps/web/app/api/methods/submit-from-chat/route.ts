import { NextResponse } from "next/server";
import { submitMethodFromChatRemark } from "../../../../lib/agent/methods-bridge";

export const runtime = "nodejs";

type SubmitBody = {
  rawRemark?: string;
  contributorHandle?: string;
  contributorDisplayName?: string;
  consentPublicAttribution?: boolean;
  reportContext?: { finishType?: string; finding_type?: string; region?: string };
};

export async function POST(request: Request) {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.rawRemark?.trim()) {
    return NextResponse.json({ ok: false, error: "rawRemark required." }, { status: 400 });
  }
  if (!body.contributorHandle?.trim()) {
    return NextResponse.json({ ok: false, error: "contributorHandle required." }, { status: 400 });
  }
  try {
    const result = submitMethodFromChatRemark({
      rawRemark: body.rawRemark,
      contributorHandle: body.contributorHandle,
      contributorDisplayName: body.contributorDisplayName,
      consentPublicAttribution: Boolean(body.consentPublicAttribution),
      reportContext: body.reportContext,
    });
    return NextResponse.json({
      ok: true,
      skillId: result.skill.skillId,
      title: result.skill.title,
      publicRemark: result.publicRemark,
      contributorHandle: result.skill.contributor?.handle,
      consentPublicAttribution: result.skill.contributor?.consentPublicAttribution ?? false,
      versionHash: result.skill.versionHash,
      status: result.skill.status,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "submission failed" },
      { status: 500 },
    );
  }
}
