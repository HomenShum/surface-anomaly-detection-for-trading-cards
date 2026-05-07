import { NextResponse } from "next/server";
import { loadAllBatches, loadAllRecords } from "../../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    records: loadAllRecords(),
    batches: loadAllBatches(),
  });
}
