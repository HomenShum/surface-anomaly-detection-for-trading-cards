import { notFound } from "next/navigation";
import { evidencePacketHtml } from "../../../../../lib/dealer/evidence";
import { currentOwnerId } from "../../../../../lib/dealer/owner";
import { loadRecord } from "../../../../../lib/dealer/store";

export const dynamic = "force-dynamic";

export default async function DealerEvidenceShareRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ownerId = await currentOwnerId();
  const record = loadRecord(ownerId, id);
  if (!record) notFound();
  // Render the printable evidence HTML inline. The customer-facing route
  // exposes the same body the JSON endpoint signs — anyone receiving the
  // packet can verify the signature against the JSON form.
  const html = evidencePacketHtml(record);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
