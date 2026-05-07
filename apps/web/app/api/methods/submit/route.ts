import { NextResponse } from "next/server";
import { createInspectionSkillCandidate, type InspectionToolName } from "../../../../lib/agent/inspection-skill-evolution";
import { appendSkillProposal, type SkillProposalRecord } from "../../../../lib/agent/skill-store";

export const runtime = "nodejs";

const ALLOWED_TOOLS: InspectionToolName[] = [
  "normalize_card",
  "crop_region",
  "zoom_region",
  "rotate_image",
  "enhance_contrast",
  "run_glare_check",
  "run_ding_detector",
  "run_surface_anomaly",
  "compare_regions",
  "save_evidence_crop",
  "explain_uncertainty",
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52);
}

function parseTools(value: string): InspectionToolName[] {
  const tokens = value
    .split(/[-=]+>|,|\n/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tools = tokens.filter((token): token is InspectionToolName =>
    ALLOWED_TOOLS.includes(token as InspectionToolName),
  );
  return tools.length > 0 ? tools : ["crop_region", "zoom_region", "run_glare_check", "run_ding_detector", "explain_uncertainty"];
}

export async function POST(request: Request) {
  let body: {
    handle?: string;
    remark?: string;
    problem?: string;
    steps?: string;
    publicRemarkConsent?: boolean;
    noRawImageConsent?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const handle = body.handle?.trim().replace(/^@/, "");
  const remark = body.remark?.trim();
  const problem = body.problem?.trim();
  const steps = body.steps?.trim();

  if (!handle || !remark || !problem || !steps) {
    return NextResponse.json({ error: "handle, remark, problem, and steps are required." }, { status: 400 });
  }
  if (!body.publicRemarkConsent || !body.noRawImageConsent) {
    return NextResponse.json({ error: "Contribution and privacy consent are required." }, { status: 400 });
  }

  const skillId = `draft_manual_${slugify(problem)}_${Date.now()}`;
  const tools = parseTools(steps);
  const candidate = createInspectionSkillCandidate({
    skillId,
    title: "Human-submitted inspection method candidate",
    trigger: {
      userQuestionIntent: "manual_submit",
    },
    steps: tools.map((tool) => ({
      tool,
      purpose: `Run ${tool} as part of the submitted inspection workflow.`,
    })),
    consentScope: "anonymized_method_stats",
    storesDerivedCrops: true,
    sharesAcrossUsers: false,
  });

  const proposal: SkillProposalRecord = {
    proposalId: `prop-${Date.now()}-${skillId}`,
    ts: new Date().toISOString(),
    source: "human_authored",
    proposed: candidate,
    evidenceTraceIds: [],
    rationale: `Contributor @${handle} submitted: ${problem}. Raw remark retained privately for review; public publication requires approved summary. Remark: ${remark}`,
  };

  appendSkillProposal(proposal);

  return NextResponse.json({
    ok: true,
    proposalId: proposal.proposalId,
    skillId,
    status: candidate.status,
    message: "Draft method candidate saved. Benchmark proof and human review are required before public attribution.",
  });
}
