import { NextResponse } from "next/server";
import { runBenchmarkForSkill } from "../../../../lib/agent/benchmark";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { skillId?: string; folder?: "promoted" | "drafts" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.skillId) return NextResponse.json({ ok: false, error: "skillId required." }, { status: 400 });
  try {
    const record = await runBenchmarkForSkill({ skillId: body.skillId, folder: body.folder });
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "benchmark failed" },
      { status: 500 },
    );
  }
}
