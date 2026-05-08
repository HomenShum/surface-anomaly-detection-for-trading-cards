import { notFound } from "next/navigation";
import { DealerReviewClient } from "../../../../components/DealerReviewClient";
import { DealerShell } from "../../../../components/DealerShell";
import { DealerVaultCues } from "../../../../components/DealerVaultCues";
import { currentOwnerId } from "../../../../lib/dealer/owner";
import { loadRecord } from "../../../../lib/dealer/store";

export const dynamic = "force-dynamic";

export default async function DealerRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ expert?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const ownerId = await currentOwnerId();
  const record = loadRecord(ownerId, id);
  if (!record) notFound();
  return (
    <DealerShell active="vault" expert={query.expert === "1"}>
      <section>
        <span className="page-kicker">Vendor pilot · Day 3</span>
        <h1>Human review · {record.certNumber ? `${record.certProvider ?? "PSA"} ${record.certNumber}` : record.id}</h1>
      </section>
      <DealerVaultCues record={record} />
      <DealerReviewClient record={record} />
    </DealerShell>
  );
}
