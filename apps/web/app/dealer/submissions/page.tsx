import { DealerShell } from "../../../components/DealerShell";
import { DealerSortableTable } from "../../../components/DealerSortableTable";
import { currentOwnerId } from "../../../lib/dealer/owner";
import { loadAllRecords } from "../../../lib/dealer/store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer submissions · Card Condition Vault",
  description: "Submission tracker: raw acquired → submitted → returned → listed.",
};

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const STAGE_ORDER = [
  "raw_acquired",
  "pre_scan_complete",
  "submitted",
  "received",
  "grading",
  "shipped_back",
  "returned",
  "listed",
  "sold",
] as const;

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerSubmissionsPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId);
  const subs = records.filter((r) => Boolean(r.submission));
  const byStage: Record<string, typeof records> = {};
  for (const r of subs) {
    const stage = r.submission?.status ?? "raw_acquired";
    byStage[stage] = [...(byStage[stage] ?? []), r];
  }
  return (
    <DealerShell active="submissions" expert={params.expert === "1"}>

      <section>
        <span className="page-kicker">Vendor pilot · grading pipeline</span>
        <h1>Submission tracker</h1>
        <p className="muted">
          Each row is a card moving through the grading pipeline. Pre-submission evidence packet IDs are
          attached so the dealer can prove the card's pre-shipping condition if a return looks different.
        </p>
      </section>

      <section className="dealer-summary">
        {STAGE_ORDER.map((stage) => (
          <div className="dealer-summary-card" key={stage}>
            <span className="dealer-summary-key">{stage.replace(/_/g, " ")}</span>
            <span className="dealer-summary-val">{(byStage[stage] ?? []).length}</span>
          </div>
        ))}
      </section>

      <section className="dealer-section">
        <h2>Pipeline</h2>
        <DealerSortableTable
          rows={subs}
          kind="submission"
          rowHrefPrefix="/dealer/records/"
          defaultSortId="submitted"
          defaultSortDir="desc"
          emptyMessage='No submissions in flight. Open the review workbench → "submit for grading" to start one.'
        />
      </section>

      <section className="dealer-section">
        <h2>How a card moves through</h2>
        <ul style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 1.55, marginLeft: 18 }}>
          <li>raw_acquired → seen on /dealer/intake, not yet scanned.</li>
          <li>pre_scan_complete → scanned and reviewed; signed evidence packet generated.</li>
          <li>submitted → physically sent to PSA / TAG / CGC / BGS.</li>
          <li>received → grader confirmed receipt.</li>
          <li>grading → in queue at the grader.</li>
          <li>shipped_back → grader returns the slab.</li>
          <li>returned → received back by the dealer; new scan + before/after compare.</li>
          <li>listed → drafted as a listing in /dealer/listings.</li>
          <li>sold → closed. P&L closes against cost basis + grading fee + shipping.</li>
        </ul>
      </section>
    </DealerShell>
  );
}
