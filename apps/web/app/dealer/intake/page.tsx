import { DealerShell } from "../../../components/DealerShell";
import { currentOwnerId } from "../../../lib/dealer/owner";
import { loadAllBatches, loadAllRecords } from "../../../lib/dealer/store";
import { DealerIntakeClient } from "./DealerIntakeClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer intake · Card Condition Vault",
  description:
    "Bulk PSA-label intake for the vendor pilot: drop a binder/slab/label batch photo, OCR extracts certs, the inspection pipeline annotates condition.",
};

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerIntakePage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const ownerId = await currentOwnerId();
  const records = loadAllRecords(ownerId);
  const batches = loadAllBatches(ownerId);
  return (
    <DealerShell active="vault" expert={expert}>
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
    </DealerShell>
  );
}
