import Link from "next/link";
import { AlphaBadge } from "../../../components/AlphaBadge";
import { InferenceHealthPill } from "../../../components/InferenceHealthPill";
import { loadAllBatches, loadAllRecords } from "../../../lib/dealer/store";
import { DealerIntakeClient } from "./DealerIntakeClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer intake · Card Condition Vault",
  description:
    "Bulk PSA-label intake for the vendor pilot: drop a binder/slab/label batch photo, OCR extracts certs, the inspection pipeline annotates condition.",
};

export default function DealerIntakePage() {
  const records = loadAllRecords();
  const batches = loadAllBatches();
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
          <Link href="/benchmarks">Benchmarks</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="dealer-hero">
        <div>
          <span className="page-kicker">Vendor pilot · Day 1</span>
          <h1>Bulk PSA-label intake — turn messy real-world photos into structured inventory.</h1>
          <p className="muted">
            Drop a single photo of many slabs, a PSA label grid, a binder page, or a table spread. The pipeline runs
            label detection + Tesseract OCR, extracts cert numbers and grade hints, persists each detected slab as
            a Dealer record, and queues each record into the next workflow lane. No cert images cached without
            explicit consent. Photo limit: 12&nbsp;MB inline. Bulk OCR runs on the local FastAPI service.
          </p>
        </div>
        <aside className="dealer-policy-card">
          <strong>Vendor pilot contract</strong>
          <span>No customer-facing claims yet.</span>
          <span>Friend reviews every report before listing.</span>
          <span>Visible condition only — never an official grade.</span>
        </aside>
      </section>

      <DealerIntakeClient initialRecords={records} initialBatches={batches} />
    </main>
  );
}
