import { currentOwnerId } from "../../../../lib/dealer/owner";
import { loadAllRecords } from "../../../../lib/dealer/store";
import { computePnL } from "../../../../lib/dealer/pnl";
import type { DealerRecord } from "../../../../lib/dealer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export for the vendor pilot. Real dealers need this for tax,
 * insurance, accounting, and IRS Form 8949. Three formats keyed by
 * ?format= query param:
 *
 *   inventory  - one row per record (default)
 *   sold       - only realized records, with cost-basis + sale price
 *   submissions - records currently in the grading pipeline
 *
 * Columns are stable + machine-readable. Currency values are bare
 * numbers (no $) so accountants can parse them directly.
 */

type Format = "inventory" | "sold" | "submissions";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function inventoryRow(r: DealerRecord): Array<unknown> {
  const pnl = computePnL(r.costBasis);
  return [
    r.id,
    r.createdAt,
    r.updatedAt,
    r.lane,
    r.inventoryType,
    r.certProvider ?? "",
    r.certNumber ?? "",
    r.cardIdentity ?? "",
    r.officialGrade ?? "",
    r.modelFindings?.length ?? 0,
    r.pricing?.rawHigh ?? "",
    r.pricing?.graded9 ?? "",
    r.pricing?.graded10 ?? "",
    r.roi?.expectedGradedEv ?? "",
    r.roi?.recommendation ?? "",
    r.roi?.dealScore ?? "",
    r.costBasis?.acquisitionCost ?? "",
    r.costBasis?.acquisitionDate ?? "",
    r.costBasis?.acquisitionChannel ?? "",
    pnl?.feesTotal ?? "",
    r.costBasis?.salePrice ?? "",
    r.costBasis?.saleDate ?? "",
    r.costBasis?.saleChannel ?? "",
    pnl?.cost ?? "",
    pnl?.net ?? "",
    pnl?.marginPct ? (pnl.marginPct * 100).toFixed(2) : "",
    pnl?.status ?? "untracked",
    r.evidencePacket?.packetId ?? "",
    r.evidencePacket?.signature?.slice(0, 16) ?? "",
    r.imageHash ?? "",
  ];
}

const INVENTORY_HEADERS = [
  "id",
  "createdAt",
  "updatedAt",
  "lane",
  "inventoryType",
  "certProvider",
  "certNumber",
  "cardIdentity",
  "officialGrade",
  "dingsCount",
  "rawHigh",
  "graded9",
  "graded10",
  "expectedGradedEv",
  "recommendation",
  "dealScore",
  "acquisitionCost",
  "acquisitionDate",
  "acquisitionChannel",
  "feesTotal",
  "salePrice",
  "saleDate",
  "saleChannel",
  "totalCost",
  "netPnL",
  "marginPct",
  "pnlStatus",
  "evidencePacketId",
  "evidenceSignaturePrefix",
  "imageHash",
];

function soldRow(r: DealerRecord): Array<unknown> {
  const pnl = computePnL(r.costBasis);
  return [
    r.id,
    r.costBasis?.saleDate ?? "",
    r.certProvider ?? "",
    r.certNumber ?? "",
    r.cardIdentity ?? "",
    r.officialGrade ?? "",
    r.costBasis?.acquisitionCost ?? "",
    r.costBasis?.acquisitionDate ?? "",
    pnl?.feesTotal ?? "",
    r.costBasis?.salePrice ?? "",
    r.costBasis?.saleChannel ?? "",
    r.costBasis?.saleBuyer ?? "",
    pnl?.cost ?? "",
    pnl?.net ?? "",
    pnl?.marginPct ? (pnl.marginPct * 100).toFixed(2) : "",
  ];
}

const SOLD_HEADERS = [
  "id",
  "saleDate",
  "certProvider",
  "certNumber",
  "cardIdentity",
  "officialGrade",
  "acquisitionCost",
  "acquisitionDate",
  "feesTotal",
  "salePrice",
  "saleChannel",
  "saleBuyer",
  "totalCost",
  "netPnL",
  "marginPct",
];

function submissionRow(r: DealerRecord): Array<unknown> {
  return [
    r.id,
    r.submission?.submissionId ?? "",
    r.submission?.status ?? "",
    r.submission?.submittedAt ?? "",
    r.submission?.expectedReturnAt ?? "",
    r.certProvider ?? "",
    r.certNumber ?? "",
    r.cardIdentity ?? "",
    r.submission?.declaredValue ?? "",
    r.pricing?.rawHigh ?? "",
    r.roi?.expectedGradedEv ?? "",
    r.submission?.returnedGrade ?? "",
    r.submission?.deltaVsExpected ?? "",
    r.submission?.preSubmissionEvidenceId ?? "",
  ];
}

const SUBMISSION_HEADERS = [
  "id",
  "submissionId",
  "status",
  "submittedAt",
  "expectedReturnAt",
  "certProvider",
  "certNumber",
  "cardIdentity",
  "declaredValue",
  "rawHigh",
  "expectedGradedEv",
  "returnedGrade",
  "deltaVsExpected",
  "preSubmissionEvidenceId",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "inventory") as Format;
  const ownerId = await currentOwnerId();
  const all = loadAllRecords(ownerId);

  let headers: string[];
  let rows: Array<Array<unknown>>;
  let filename: string;

  if (format === "sold") {
    const realized = all.filter((r) => r.costBasis?.salePrice);
    headers = SOLD_HEADERS;
    rows = realized.map(soldRow);
    filename = `dealer_sold_${new Date().toISOString().slice(0, 10)}.csv`;
  } else if (format === "submissions") {
    const subs = all.filter((r) => r.submission);
    headers = SUBMISSION_HEADERS;
    rows = subs.map(submissionRow);
    filename = `dealer_submissions_${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    headers = INVENTORY_HEADERS;
    rows = all.map(inventoryRow);
    filename = `dealer_inventory_${new Date().toISOString().slice(0, 10)}.csv`;
  }

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  const csv = lines.join("\n") + "\n";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
