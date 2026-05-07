import Link from "next/link";
import { AlphaBadge } from "../../../components/AlphaBadge";
import { InferenceHealthPill } from "../../../components/InferenceHealthPill";
import { loadAllRecords } from "../../../lib/dealer/store";
import type { DealerRecord } from "../../../lib/dealer/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer listings · Card Condition Vault",
  description: "Listing queue with grading ROI, comp confidence, and evidence-packet links.",
};

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function DealerListingsPage() {
  const records = loadAllRecords();
  const candidates: DealerRecord[] = records.filter((r) => r.lane === "ready" || r.listing);
  const drafted = candidates.filter((r) => r.listing);
  const ready = candidates.filter((r) => !r.listing);
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
        <span className="page-kicker">Vendor pilot · listings</span>
        <h1>Listing queue</h1>
        <p className="muted">
          Records that have completed human review become listing candidates. Each draft attaches the signed
          evidence packet so the buyer can verify cert, image hash, and reviewer notes from the listing itself.
        </p>
      </section>

      <section className="dealer-section">
        <h2>Drafts ({drafted.length})</h2>
        <table>
          <thead>
            <tr>
              <th>cert</th>
              <th>title</th>
              <th>marketplace</th>
              <th className="numeric">price</th>
              <th className="numeric">EV</th>
              <th>deal</th>
              <th>status</th>
              <th>evidence</th>
            </tr>
          </thead>
          <tbody>
            {drafted.length === 0 ? (
              <tr>
                <td colSpan={8} className="dealer-section-empty">
                  No listing drafts yet. Approve a record on the review workbench → "submit for grading" or
                  "sell raw" to generate a draft.
                </td>
              </tr>
            ) : (
              drafted.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>
                      {r.certProvider ?? "PSA"} {r.certNumber ?? r.id}
                    </Link>
                  </td>
                  <td className="muted">{r.listing?.title ?? "—"}</td>
                  <td>{r.listing?.marketplace ?? "—"}</td>
                  <td className="numeric">{fmtUsd(r.listing?.recommendedPrice ?? r.pricing?.graded9 ?? r.pricing?.rawHigh)}</td>
                  <td className="numeric">{fmtUsd(r.roi?.expectedGradedEv)}</td>
                  <td>
                    {r.roi?.dealScore ? (
                      <span className={`dealer-pill dealer-pill--${r.roi.dealScore === "high" ? "good" : r.roi.dealScore === "low" ? "bad" : "warn"}`}>
                        {r.roi.dealScore}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`dealer-pill ${r.listing?.draftStatus === "ready" ? "dealer-pill--good" : ""}`}>
                      {r.listing?.draftStatus ?? "drafted"}
                    </span>
                  </td>
                  <td>
                    {r.listing?.publicReportUrl ? (
                      <Link href={r.listing.publicReportUrl}>open ↗</Link>
                    ) : (
                      <Link href={`/dealer/records/${r.id}/evidence`}>generate ↗</Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="dealer-section">
        <h2>Ready, no draft yet ({ready.length})</h2>
        <table>
          <thead>
            <tr>
              <th>cert</th>
              <th>card</th>
              <th>grade</th>
              <th className="numeric">raw $</th>
              <th className="numeric">PSA 9 $</th>
              <th>recommendation</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ready.length === 0 ? (
              <tr>
                <td colSpan={7} className="dealer-section-empty">
                  No records awaiting a listing draft.
                </td>
              </tr>
            ) : (
              ready.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>
                      {r.certProvider ?? "PSA"} {r.certNumber ?? r.id}
                    </Link>
                  </td>
                  <td className="muted">{r.cardIdentity ?? "—"}</td>
                  <td>{r.officialGrade ?? "—"}</td>
                  <td className="numeric">{fmtUsd(r.pricing?.rawHigh)}</td>
                  <td className="numeric">{fmtUsd(r.pricing?.graded9)}</td>
                  <td>
                    {r.roi?.recommendation ? (
                      <span className={`dealer-pill ${r.roi.recommendation === "submit" ? "dealer-pill--good" : ""}`}>
                        {r.roi.recommendation}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>open →</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
