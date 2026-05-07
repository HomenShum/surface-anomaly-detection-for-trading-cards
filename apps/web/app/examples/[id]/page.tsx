import { notFound } from "next/navigation";
import { ExampleDetailClient } from "../../../components/ExampleDetailClient";
import { findExampleBySlug, loadAllExamples } from "../../../lib/examples/gold-store";
import { loadLatestCertEvalReport } from "../../../lib/cert-references-eval";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  // Pre-render seeded entries; Gold records render on-demand.
  return loadAllExamples().map((entry) => ({ id: entry.slug }));
}

/**
 * Maps an example to its cert-reference id when one is derivable.
 * Convention: Silver+/Silver entries created from PSA/TAG cert references
 * have ids prefixed with `ex_<provider>_<cert_number>`. The cert-reference
 * store keys are `<provider>_<cert_number>`. So we derive by stripping the
 * `ex_` prefix.
 */
function deriveCertId(example: { id: string; tier: string }): string | null {
  if (example.tier !== "silver_plus" && example.tier !== "silver") return null;
  if (!example.id.startsWith("ex_")) return null;
  return example.id.slice(3);
}

export default async function ExampleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const example = findExampleBySlug(id);
  if (!example) notFound();
  const certId = deriveCertId(example);
  const certEvalReport = certId ? loadLatestCertEvalReport("latest") : null;
  const certEvalRow = certEvalReport?.rows.find((row) => row.certId === certId) ?? null;
  return <ExampleDetailClient example={example} certEvalRow={certEvalRow} certEvalModelVersion={certEvalReport?.modelVersion ?? null} />;
}
