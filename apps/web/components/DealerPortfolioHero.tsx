import Link from "next/link";
import type { DealerDashboardData } from "../lib/dealer/aggregates";
import { DealerCardThumb } from "./DealerCardThumb";

/**
 * Collectr-style portfolio hero. Big mono total value, period delta line,
 * 1D/7D/1M/3M/MAX time-window chips, sparkline (deterministic SVG over the
 * record-count progression), and "Most valuable records" line items.
 *
 * Today the chart is illustrative — events.jsonl doesn't yet capture
 * inventory-value time series. Real series wires in when the dealer
 * starts logging buy prices + sell prices into the vault.
 */

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtUsdSigned(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "n/a";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fmtUsd(Math.abs(n))}`;
}

const PERIODS = ["1D", "7D", "1M", "3M", "6M", "MAX"] as const;

function buildSparklineFromSeries(series: number[]): string {
  // Real series — normalize to [0.05, 0.95] vertically so flat zero days
  // don't render as a line on the bottom edge.
  if (!series || series.length === 0) {
    return "M0,32 L100,32";
  }
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(1, max - min);
  const w = 100;
  const h = 32;
  const dx = w / Math.max(1, series.length - 1);
  return series
    .map((value, i) => {
      const norm = (value - min) / range; // 0..1
      const y = h - (0.05 + norm * 0.9) * h;
      return `${i === 0 ? "M" : "L"}${(i * dx).toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function DealerPortfolioHero({ data }: { data: DealerDashboardData }) {
  const inventory = data.inventoryValue;
  const ev = data.expectedGradedEv;
  // Real 30-day delta + series from records.jsonl createdAt buckets.
  const delta30 = data.delta30 ?? 0;
  const series = data.inventorySeries && data.inventorySeries.length > 0 ? data.inventorySeries : [0, 0];
  const sparkline = buildSparklineFromSeries(series);
  // If the entire inventory was scanned within the past 30 days, "delta"
  // and "current" are the same number — calling that a "30-day delta"
  // overstates trend. Detect that and label honestly.
  const isFreshVault = delta30 > 0 && Math.abs(inventory - delta30) < 0.5;

  // Prefer the dedicated top-by-value list (records with priced rawHigh AND
  // either an image or card identity). Falls back to recentImports for older
  // datasets that don't carry topByValue yet.
  const topMovers = (data.topByValue && data.topByValue.length > 0
    ? data.topByValue
    : [...data.recentImports].sort(
        (a, b) => (b.pricing?.rawHigh ?? 0) - (a.pricing?.rawHigh ?? 0),
      )
  ).slice(0, 5);

  return (
    <section className="dealer-portfolio-hero" aria-label="Vault portfolio overview">
      <header className="dealer-portfolio-head">
        <div>
          <span className="dealer-portfolio-kicker">Inventory total · raw high</span>
          <h2 className="dealer-portfolio-value">{fmtUsd(inventory)}</h2>
          <p className="dealer-portfolio-delta">
            <span className={delta30 >= 0 ? "is-up" : "is-down"}>{fmtUsdSigned(delta30)}</span>
            <span className="dealer-portfolio-delta-meta">
              {isFreshVault
                ? `entire vault captured in last 30 days · ${data.totalRecords} records`
                : `30-day net change · ${data.totalRecords} records`}
            </span>
          </p>
        </div>
        <div className="dealer-portfolio-side">
          <div>
            <span>expected graded EV</span>
            <strong>{fmtUsd(ev)}</strong>
          </div>
          <div>
            <span>worth grading</span>
            <strong>{data.worthGrading.length}</strong>
          </div>
          <div>
            <span>needs review</span>
            <strong>{data.needsHumanReview.length}</strong>
          </div>
        </div>
      </header>

      <div className="dealer-portfolio-chart-row">
        <svg
          aria-hidden
          className="dealer-portfolio-spark"
          preserveAspectRatio="none"
          viewBox="0 0 100 32"
        >
          <defs>
            <linearGradient id="dealer-portfolio-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${sparkline} L100,32 L0,32 Z`} fill="url(#dealer-portfolio-gradient)" />
          <path d={sparkline} fill="none" stroke="#10b981" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
        </svg>

        <div className="dealer-portfolio-periods" role="tablist" aria-label="Time window">
          {PERIODS.map((p, i) => (
            <button
              aria-selected={i === 2}
              className={`dealer-portfolio-period${i === 2 ? " is-active" : ""}`}
              key={p}
              role="tab"
              type="button"
              disabled
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="dealer-portfolio-movers">
        <header>
          <h3>Most valuable records</h3>
          <span className="dealer-portfolio-movers-actions">
            <button
              aria-label="Ask Pi about top records"
              className="dealer-portfolio-movers-ask"
              data-agent-summon
              type="button"
            >
              ask Pi
            </button>
            <Link href="/dealer/listings">listings →</Link>
          </span>
        </header>
        <ul>
          {topMovers.length === 0 ? (
            <li className="dealer-portfolio-movers-empty">No records with pricing yet.</li>
          ) : (
            topMovers.map((r) => (
              <li key={r.id}>
                <Link href={`/dealer/records/${r.id}`}>
                  <span className="dealer-portfolio-mover-thumb">
                    <DealerCardThumb
                      src={r.imageUrl}
                      fallback={
                        <span className="dealer-portfolio-mover-thumb-fallback" aria-hidden>
                          <em>{(r.certProvider ?? "RAW").slice(0, 3).toUpperCase()}</em>
                          {r.certNumber ? <b>{r.certNumber.slice(-4)}</b> : null}
                        </span>
                      }
                    />
                  </span>
                  <span className="dealer-portfolio-mover-cert">
                    {r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id.slice(0, 14)}
                  </span>
                  <span className="dealer-portfolio-mover-card">{r.cardIdentity ?? "(no card identity)"}</span>
                  <span className="dealer-portfolio-mover-grade">{r.officialGrade ?? "—"}</span>
                  <span className="dealer-portfolio-mover-price">{fmtUsd(r.pricing?.rawHigh)}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>

      {data.pnl && data.pnl.trackedCount > 0 ? (
        <div className="dealer-portfolio-pnl" aria-label="Realized P&amp;L">
          <header>
            <h3>Realized P&amp;L</h3>
            <span className="dealer-portfolio-pnl-coverage">
              {Math.round(data.pnl.coverageRate * 100)}% of records have cost basis tracked ({data.pnl.trackedCount}/
              {data.pnl.trackedCount + data.pnl.untrackedCount})
            </span>
          </header>
          <div className="dealer-portfolio-pnl-grid">
            <div>
              <span>cost out</span>
              <strong>{fmtUsd(data.pnl.totalCost)}</strong>
              <small>
                acq {fmtUsd(data.pnl.totalAcquisitionCost)} + fees {fmtUsd(data.pnl.totalFees)}
              </small>
            </div>
            <div>
              <span>realized revenue</span>
              <strong>{fmtUsd(data.pnl.realizedRevenue)}</strong>
              <small>{data.pnl.realizedCount} sold · {data.pnl.openCount} open</small>
            </div>
            <div>
              <span>net</span>
              <strong className={data.pnl.realizedNet >= 0 ? "is-up" : "is-down"}>
                {fmtUsdSigned(data.pnl.realizedNet)}
              </strong>
              <small>{data.pnl.realizedCount > 0 ? "across closed positions" : "no sales yet"}</small>
            </div>
          </div>
        </div>
      ) : null}

      <p className="dealer-portfolio-note">
        Live series: cumulative <code>pricing.rawHigh</code> per UTC day across {data.totalRecords} records over 30 days.
        {data.pnl && data.pnl.untrackedCount > 0
          ? ` ${data.pnl.untrackedCount} record${data.pnl.untrackedCount === 1 ? " has" : "s have"} no cost basis yet — open the record to add acquisition cost.`
          : null}
      </p>
    </section>
  );
}
