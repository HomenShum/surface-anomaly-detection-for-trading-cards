import Link from "next/link";
import { AlphaBadge } from "../../../components/AlphaBadge";
import { CertEvalScoreboard } from "../../../components/CertEvalScoreboard";
import { CertImportClient } from "../../../components/CertImportClient";
import { FriendAskPanel } from "../../../components/FriendAskPanel";
import { InferenceHealthPill } from "../../../components/InferenceHealthPill";
import { loadAllCertifiedReferences } from "../../../lib/cert-references";

export const dynamic = "force-dynamic";

export default function CertImportPage() {
  const references = loadAllCertifiedReferences();

  return (
    <main className="cert-import-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Certified reference nav">
          <Link href="/examples">Examples</Link>
          <Link href="/certs/import">Cert import</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/scan?mode=sample">Try sample</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="cert-import-hero">
        <div>
          <span className="page-kicker">Certified Reference Ingestion</span>
          <h1>Import PSA and TAG references without asking the user to type everything by hand.</h1>
          <p className="muted">
            Paste cert links, batch cert numbers, or upload label screenshots. The importer extracts candidate certs,
            stores them as Silver/Silver+ references, and keeps the training/eval pipeline separate from the live
            scanner. PSA is API-first when credentials exist; TAG remains link-only unless the user provides artifacts
            or permission exists.
          </p>
        </div>
        <aside className="cert-import-policy-card">
          <strong>Safety contract</strong>
          <span>No TAG bulk scraping.</span>
          <span>No cert-image training without permission.</span>
          <span>Raw pre-submission scans are required to upgrade to Gold.</span>
        </aside>
      </section>

      <CertEvalScoreboard />

      <FriendAskPanel />

      <CertImportClient initialReferences={references} />
    </main>
  );
}
