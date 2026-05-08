import { NextResponse } from "next/server";
import { currentOwnerId } from "../../../../lib/dealer/owner";
import { loadAllRecords } from "../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight record projection for the cmd-K command palette + any other
 * client-side search surface. Returns a slim `{id, cert, card, lane}`
 * array — never the full record (which has bbox arrays + base64 image
 * hashes that would bloat the response).
 *
 * Bounded at 500 records (vendor pilot scale) so a runaway index op
 * can't exhaust memory or transfer time.
 */

const MAX_RECORDS = 500;

export async function GET() {
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId)
    .slice(0, MAX_RECORDS)
    .map((r) => ({
      id: r.id,
      cert: r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : null,
      card: r.cardIdentity ?? null,
      lane: r.lane,
      grade: r.officialGrade ?? null,
      rawHigh: r.pricing?.rawHigh ?? null,
    }));

  return NextResponse.json({
    records,
    total: records.length,
  });
}
