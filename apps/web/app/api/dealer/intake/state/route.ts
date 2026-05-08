import { NextResponse } from "next/server";
import { currentOwnerId } from "../../../../../lib/dealer/owner";
import { loadAllBatches, loadAllRecords } from "../../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await currentOwnerId();
  return NextResponse.json({
    records: loadAllRecords(ownerId),
    batches: loadAllBatches(ownerId),
  });
}
