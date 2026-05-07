import Link from "next/link";
import { notFound } from "next/navigation";
import { AlphaBadge } from "../../../../components/AlphaBadge";
import { InferenceHealthPill } from "../../../../components/InferenceHealthPill";
import { DealerReviewClient } from "../../../../components/DealerReviewClient";
import { loadRecord } from "../../../../lib/dealer/store";

export const dynamic = "force-dynamic";

export default async function DealerRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = loadRecord(id);
  if (!record) notFound();
  return (
    <main className="dealer-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Dealer nav">
          <Link href="/dealer/intake">Intake</Link>
          <Link href="/dealer/dashboard">Dashboard</Link>
          <Link href="/dealer/listings">Listings</Link>
          <Link href="/dealer/submissions">Submissions</Link>
          <Link href="/examples">Examples</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>
      <section>
        <span className="page-kicker">Vendor pilot · Day 3</span>
        <h1>Human review · {record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : record.id}</h1>
      </section>
      <DealerReviewClient record={record} />
    </main>
  );
}
