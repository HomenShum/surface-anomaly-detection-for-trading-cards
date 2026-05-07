import Link from "next/link";
import { HumanDingReviewWorkbench } from "../../../components/HumanDingReviewWorkbench";
import { loadAllCertifiedReferences } from "../../../lib/cert-references";

export const dynamic = "force-dynamic";

export default function DingReviewPage() {
  const refs = loadAllCertifiedReferences().map((ref) => ({
    id: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    cardIdentity: ref.cardIdentity,
    officialGrade: ref.officialGrade,
    trustTier: ref.trustTier,
  }));

  return (
    <main className="benchmarks-shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="page-kicker">Human DING review</span>
          <h1>Review visible defects before they count as benchmark truth.</h1>
          <p className="muted" style={{ maxWidth: 760, margin: "8px 0 0" }}>
            This workbench stores reviewer-confirmed DING boxes, severity, and materiality. It does not create
            official grades and it does not turn slab-only references into Gold records.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="button secondary" href="/certs/import">Import certs</Link>
          <Link className="button secondary" href="/benchmarks/certified-references">Benchmarks</Link>
        </div>
      </header>
      <HumanDingReviewWorkbench refs={refs} />
    </main>
  );
}
