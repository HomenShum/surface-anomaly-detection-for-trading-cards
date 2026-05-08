import { DealerShell } from "../../../components/DealerShell";
import { DealerWorkbenchQueue } from "../../../components/DealerWorkbenchQueue";
import { currentOwnerId } from "../../../lib/dealer/owner";
import { loadAllRecords } from "../../../lib/dealer/store";
import type { DealerRecord } from "../../../lib/dealer/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workbench · Card Condition Vault",
  description:
    "Triage queue: review AI-flagged DINGs, accept/reject grading recommendations, and approve listings in batch.",
};

type Props = {
  searchParams?: Promise<{ expert?: string; bucket?: string }>;
};

export default async function DealerWorkbenchPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId);

  // Triage candidates: anything that needs a decision before it can ship.
  // Ordered by priority: human_review > worth-grading > pricing-uncertain.
  const queue: DealerRecord[] = records.filter(
    (r) =>
      r.lane === "human_review" ||
      (r.lane === "ready" && !r.humanReview) ||
      r.roi?.recommendation === "submit" ||
      r.roi?.recommendation === "rescan",
  );

  const buckets = {
    all: queue.length,
    review: queue.filter((r) => r.lane === "human_review").length,
    submit: queue.filter((r) => r.roi?.recommendation === "submit").length,
    sell: queue.filter((r) => r.roi?.recommendation === "sell_raw").length,
    rescan: queue.filter((r) => r.roi?.recommendation === "rescan").length,
  };

  return (
    <DealerShell active="workbench" expert={expert}>
      <section>
        <span className="page-kicker">Vendor pilot · workbench</span>
        <h1>Workbench</h1>
        <p className="muted">
          Stack of records waiting on a dealer decision. Approve the AI recommendation in 1-click, dispute a DING,
          or open the full record for a granular review. Vault decisions land back in <code>data/dealer/records.jsonl</code>.
        </p>
      </section>

      <DealerWorkbenchQueue queue={queue} buckets={buckets} />
    </DealerShell>
  );
}
