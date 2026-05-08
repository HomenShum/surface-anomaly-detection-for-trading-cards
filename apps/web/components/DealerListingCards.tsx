import Link from "next/link";
import type { DealerRecord } from "../lib/dealer/types";
import { DealerCardThumb } from "./DealerCardThumb";

/**
 * TCGplayer-style listing card grid.
 *
 * Replaces the prior table view with a marketplace-style grid: each draft
 * gets a tile with the slab thumbnail (or fallback initials), title +
 * grade band, recommended price, deal-score pill, evidence-packet CTA.
 * Below the drafts grid: a smaller "Ready, no draft yet" rail of
 * candidates the dealer can promote.
 */

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function thumbBadge(r: DealerRecord): { provider: string; cert: string; grade: string } {
  return {
    provider: r.certProvider ?? "RAW",
    cert: r.certNumber ? `#${r.certNumber}` : r.id.slice(-6),
    grade: r.officialGrade ?? "—",
  };
}

function dealClass(score: string | undefined): string {
  if (score === "high") return "dealer-pill dealer-pill--good";
  if (score === "low") return "dealer-pill dealer-pill--bad";
  return "dealer-pill dealer-pill--warn";
}

export function DealerListingCards({
  drafted,
  ready,
}: {
  drafted: DealerRecord[];
  ready: DealerRecord[];
}) {
  return (
    <>
      <section className="dealer-listing-section">
        <header>
          <h2>Drafts</h2>
          <span className="dealer-listing-count">{drafted.length}</span>
        </header>
        {drafted.length === 0 ? (
          <p className="dealer-listing-empty">
            No listing drafts yet. Approve a record on the review workbench → "submit for grading" or "sell raw"
            to generate a draft.
          </p>
        ) : (
          <div className="dealer-listing-grid">
            {drafted.map((r) => (
              <article className="dealer-listing-card" key={r.id}>
                <div className="dealer-listing-card-thumb">
                  <DealerCardThumb
                    src={r.imageUrl}
                    fallback={
                      <div className="dealer-listing-card-thumb-fallback" aria-hidden>
                        <span className="dealer-listing-card-thumb-provider">{thumbBadge(r).provider}</span>
                        <span className="dealer-listing-card-thumb-cert">{thumbBadge(r).cert}</span>
                        <span className="dealer-listing-card-thumb-grade">{thumbBadge(r).grade}</span>
                      </div>
                    }
                  />
                  <span className={`dealer-listing-card-marketplace ${r.listing?.marketplace ?? ""}`}>
                    {r.listing?.marketplace ?? "private"}
                  </span>
                </div>
                <div className="dealer-listing-card-body">
                  <p className="dealer-listing-card-cert">
                    {r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id.slice(0, 14)}
                  </p>
                  <p className="dealer-listing-card-title">
                    {r.listing?.title ?? r.cardIdentity ?? "Untitled record"}
                  </p>
                  <p className="dealer-listing-card-meta">
                    <span>{r.officialGrade ?? "—"}</span>
                    <span>·</span>
                    <span>{r.listing?.draftStatus ?? "drafted"}</span>
                  </p>
                  <div className="dealer-listing-card-prices">
                    <span>
                      <em>price</em>
                      <strong>
                        {fmtUsd(r.listing?.recommendedPrice ?? r.pricing?.graded9 ?? r.pricing?.rawHigh)}
                      </strong>
                    </span>
                    <span>
                      <em>EV</em>
                      <strong>{fmtUsd(r.roi?.expectedGradedEv)}</strong>
                    </span>
                    {r.roi?.dealScore ? (
                      <span className={dealClass(r.roi.dealScore)}>deal · {r.roi.dealScore}</span>
                    ) : null}
                  </div>
                  <div className="dealer-listing-card-actions">
                    <Link className="dealer-listing-card-primary" href={`/dealer/records/${r.id}/evidence`}>
                      open report ↗
                    </Link>
                    <Link className="dealer-listing-card-secondary" href={`/dealer/records/${r.id}`}>
                      adjust →
                    </Link>
                    <button
                      aria-label="Ask Pi about this record"
                      className="dealer-listing-card-ask"
                      data-agent-record-id={r.id}
                      data-agent-summon
                      type="button"
                    >
                      ask Pi
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dealer-listing-section">
        <header>
          <h2>Ready, no draft yet</h2>
          <span className="dealer-listing-count">{ready.length}</span>
        </header>
        {ready.length === 0 ? (
          <p className="dealer-listing-empty">No records awaiting a listing draft.</p>
        ) : (
          <ul className="dealer-listing-ready-list">
            {ready.map((r) => (
              <li key={r.id}>
                <Link href={`/dealer/records/${r.id}`}>
                  <span className="dealer-listing-ready-thumb">
                    <DealerCardThumb
                      src={r.imageUrl}
                      fallback={
                        <span className="dealer-listing-ready-thumb-fallback">
                          {(r.certProvider ?? "RAW").slice(0, 3).toUpperCase()}
                        </span>
                      }
                    />
                  </span>
                  <span className="dealer-listing-ready-cert">
                    {r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id.slice(0, 14)}
                  </span>
                  <span className="dealer-listing-ready-card">{r.cardIdentity ?? "—"}</span>
                  <span className="dealer-listing-ready-grade">{r.officialGrade ?? "—"}</span>
                  <span className="dealer-listing-ready-price">
                    {fmtUsd(r.pricing?.graded9 ?? r.pricing?.rawHigh)}
                  </span>
                  <span className="dealer-listing-ready-arrow">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
