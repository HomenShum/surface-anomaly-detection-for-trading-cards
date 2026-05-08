import { DealerDecisionFlow } from "../../components/DealerDecisionFlow";
import { DealerShell } from "../../components/DealerShell";
import { currentOwnerId } from "../../lib/dealer/owner";
import { loadAllRecords, resolveSlabImagePath } from "../../lib/dealer/store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Drop · Card Condition Vault",
  description:
    "Drop a card photo, stream the inspection, get one decision, save a signed proof packet. Vault-backed.",
};

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerHomePage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId);
  const sortedByRecent = records
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const replayableImageUrl = (record: (typeof records)[number]) => {
    if (!record.imageUrl) return undefined;
    if (!record.imageUrl.startsWith("/api/dealer/records/")) return record.imageUrl;
    return resolveSlabImagePath(ownerId, record.id) ? record.imageUrl : undefined;
  };
  const latestRecords = sortedByRecent.slice(0, 4).map((record) => ({
    id: record.id,
    title: record.cardIdentity ?? (record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : null) ?? `record ${record.id.slice(-6)}`,
    lane: record.lane,
    findings: record.modelFindings?.length ?? 0,
    proofSaved: Boolean(record.evidencePacket),
    imageUrl: replayableImageUrl(record),
    cert: record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : null,
    updatedAt: record.updatedAt,
    value: record.pricing?.rawHigh ?? record.pricing?.graded9 ?? null,
    grade: record.officialGrade ?? null,
  }));
  const vaultPreview = sortedByRecent
    .filter((r) => Boolean(replayableImageUrl(r)))
    .slice(0, 6)
    .map((record) => ({
      id: record.id,
      title:
        record.cardIdentity ??
        (record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : null) ??
        `Capture ${record.id.slice(-6)}`,
      grade: record.officialGrade ?? null,
      imageUrl: replayableImageUrl(record) as string,
      cert: record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : null,
    }));
  const vault = {
    totalRecords: records.length,
    proofPackets: records.filter((record) => record.evidencePacket).length,
    reviewedCount: records.filter((record) => record.humanReview).length,
    silverPlusCount: records.filter((record) => record.trustTier === "silver_plus").length,
    humanReviewCount: records.filter((record) => record.lane === "human_review").length,
    listedCount: records.filter(
      (record) => record.lane === "listed" || record.listing?.draftStatus === "ready",
    ).length,
    submittedCount: records.filter(
      (record) => record.lane === "submitted" || record.submission,
    ).length,
    inventoryValue: records.reduce(
      (sum, record) => sum + (record.pricing?.rawHigh ?? record.pricing?.rawMid ?? 0),
      0,
    ),
    latestRecords,
    vaultPreview,
  };

  return (
    <DealerShell active="drop" expert={expert}>
      <DealerDecisionFlow vault={vault} />
    </DealerShell>
  );
}
