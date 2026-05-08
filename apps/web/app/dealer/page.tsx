import Link from "next/link";
import { AlphaBadge } from "../../components/AlphaBadge";
import { DealerDecisionFlow } from "../../components/DealerDecisionFlow";
import { DealerHeroContext } from "../../components/DealerHeroContext";
import { InferenceHealthPill } from "../../components/InferenceHealthPill";
import { loadAllRecords } from "../../lib/dealer/store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer - Drop card photo. Get decision. Save proof.",
  description:
    "Single-screen vendor pilot entrypoint: drop a card photo, stream the inspection, get one decision, and save a signed proof packet.",
};

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerHomePage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const records = loadAllRecords();
  const latestRecords = records
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
    .map((record) => ({
      id: record.id,
      title: record.cardIdentity ?? record.certNumber ?? "Raw card",
      lane: record.lane,
      findings: record.modelFindings?.length ?? 0,
      proofSaved: Boolean(record.evidencePacket),
    }));
  const vault = {
    totalRecords: records.length,
    proofPackets: records.filter((record) => record.evidencePacket).length,
    reviewedCount: records.filter((record) => record.humanReview).length,
    silverPlusCount: records.filter((record) => record.trustTier === "silver_plus").length,
    humanReviewCount: records.filter((record) => record.lane === "human_review").length,
    listedCount: records.filter((record) => record.lane === "listed" || record.listing?.draftStatus === "ready").length,
    submittedCount: records.filter((record) => record.lane === "submitted" || record.submission).length,
    inventoryValue: records.reduce((sum, record) => sum + (record.pricing?.rawHigh ?? record.pricing?.rawMid ?? 0), 0),
    latestRecords,
  };
  return (
    <main className="dealer-shell dealer-hero-shell">
      <header className="dealer-hero-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <div className="dealer-hero-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          {expert ? (
            <nav className="dealer-hero-expert" aria-label="Expert nav">
              <Link href="/dealer/intake?expert=1">Intake lanes</Link>
              <Link href="/dealer/dashboard?expert=1">Dashboard</Link>
              <Link href="/dealer/listings?expert=1">Listings</Link>
              <Link href="/dealer/submissions?expert=1">Submissions</Link>
              <Link href="/dealer/alerts?expert=1">Alerts</Link>
            </nav>
          ) : null}
        </div>
      </header>

      <DealerDecisionFlow vault={vault} />

      <DealerHeroContext expert={expert} />
    </main>
  );
}
