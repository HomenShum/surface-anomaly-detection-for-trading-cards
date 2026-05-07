import { NextResponse } from "next/server";
import { runClustering } from "../../../../lib/agent/clusterer";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = runClustering();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "clustering failed" },
      { status: 500 },
    );
  }
}
