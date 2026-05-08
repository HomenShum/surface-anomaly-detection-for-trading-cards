import { DealerListingFilters } from "../../../components/DealerListingFilters";
import { DealerShell } from "../../../components/DealerShell";
import { currentOwnerId } from "../../../lib/dealer/owner";
import { loadAllRecords } from "../../../lib/dealer/store";
import type { DealerRecord } from "../../../lib/dealer/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer listings · Card Condition Vault",
  description: "Listing queue with grading ROI, comp confidence, and evidence-packet links.",
};

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerListingsPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId);
  const candidates: DealerRecord[] = records.filter((r) => r.lane === "ready" || r.listing);
  const drafted = candidates.filter((r) => r.listing);
  const ready = candidates.filter((r) => !r.listing);
  return (
    <DealerShell active="listings" expert={expert}>
      <section className="dealer-section">
        <span className="page-kicker">Vendor pilot · listings</span>
        <h1>Listing queue</h1>
        <p className="muted">
          Records that have completed human review become listing candidates. Each draft attaches the signed
          evidence packet so the buyer can verify cert, image hash, and reviewer notes from the listing itself.
        </p>
      </section>

      <DealerListingFilters drafted={drafted} ready={ready} />
    </DealerShell>
  );
}
