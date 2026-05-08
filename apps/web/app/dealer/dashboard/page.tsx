import Link from "next/link";
import { DealerShell } from "../../../components/DealerShell";
import { DealerPortfolioHero } from "../../../components/DealerPortfolioHero";
import { DealerSortableTable } from "../../../components/DealerSortableTable";
import { buildDashboard } from "../../../lib/dealer/aggregates";
import { currentOwnerId } from "../../../lib/dealer/owner";
import type { DealerRecord } from "../../../lib/dealer/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer dashboard · Card Condition Vault",
  description:
    "Daily dealer operating system: ready-to-list, worth-grading, needs-human-review, recent imports, price movers, submission pipeline.",
};

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function recordRow(r: DealerRecord) {
  const cert = r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id;
  const id = r.id;
  return (
    <tr key={id}>
      <td>
        <Link href={`/dealer/records/${id}`}>{cert}</Link>
      </td>
      <td className="muted">{r.cardIdentity ?? "—"}</td>
      <td>{r.officialGrade ?? "—"}</td>
      <td className="muted">{r.lane}</td>
      <td className="numeric">{fmtUsd(r.pricing?.rawHigh)}</td>
      <td className="numeric">{fmtUsd(r.roi?.expectedGradedEv)}</td>
      <td>
        {r.roi?.recommendation ? (
          <span className={`dealer-pill dealer-pill--${r.roi.recommendation === "submit" ? "good" : r.roi.recommendation === "sell_raw" ? "warn" : ""}`}>
            {r.roi.recommendation}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerDashboardPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  const ownerId = await currentOwnerId();
  const data = buildDashboard(ownerId);
  return (
    <DealerShell active="vault" expert={expert}>
      <section>
        <span className="page-kicker">Vendor pilot · daily operating system</span>
        <h1>Vault</h1>
        <p className="muted">
          Aggregates the dealer pipeline: imported certs, accepted DING reviews, ready-to-list inventory, suggested
          gradings, and submission returns. Backed by <code>data/dealer/records.jsonl</code> — vendor-pilot scale only.
        </p>
        <div className="dealer-export-row">
          <a className="dealer-export-link" download href="/api/dealer/export?format=inventory">
            ↓ inventory CSV
          </a>
          <a className="dealer-export-link" download href="/api/dealer/export?format=sold">
            ↓ realized sales CSV
          </a>
          <a className="dealer-export-link" download href="/api/dealer/export?format=submissions">
            ↓ submissions CSV
          </a>
        </div>
      </section>

      <DealerPortfolioHero data={data} />

      <section className="dealer-summary">
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Inventory (rawHigh)</span>
          <span className="dealer-summary-val">{fmtUsd(data.inventoryValue)}</span>
          <span className="dealer-summary-trend">{data.totalRecords} records</span>
        </div>
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Expected graded EV</span>
          <span className="dealer-summary-val">{fmtUsd(data.expectedGradedEv)}</span>
          <span className="dealer-summary-trend">across worth-grading + held</span>
        </div>
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Reviewed</span>
          <span className="dealer-summary-val">{data.reviewedCount}</span>
          <span className="dealer-summary-trend">/ {data.totalRecords} records</span>
        </div>
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Listed</span>
          <span className="dealer-summary-val">{data.listedCount}</span>
          <span className="dealer-summary-trend">drafts in queue</span>
        </div>
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Submission pipeline</span>
          <span className="dealer-summary-val">{data.submissionPipeline.length}</span>
          <span className="dealer-summary-trend">in flight</span>
        </div>
        <div className="dealer-summary-card">
          <span className="dealer-summary-key">Stale (&gt;30d)</span>
          <span className="dealer-summary-val">{data.staleCount}</span>
          <span className="dealer-summary-trend">consider price drop</span>
        </div>
      </section>

      <section className="dealer-section">
        <h2>Ready to list ({data.readyToList.length})</h2>
        <DealerSortableTable
          rows={data.readyToList}
          kind="dealerRecord"
          rowHrefPrefix="/dealer/records/"
          defaultSortId="rawHigh"
          defaultSortDir="desc"
          emptyMessage="No reviewed records waiting on a listing draft. Open the review workbench on any record marked Ready."
        />
      </section>

      <section className="dealer-section">
        <h2>Worth grading ({data.worthGrading.length})</h2>
        <DealerSortableTable
          rows={data.worthGrading}
          kind="dealerRecord"
          rowHrefPrefix="/dealer/records/"
          defaultSortId="ev"
          defaultSortDir="desc"
          emptyMessage="No records currently recommend submitting for grading."
        />
      </section>

      <section className="dealer-section">
        <h2>Needs human review ({data.needsHumanReview.length})</h2>
        <table>
          <thead>
            <tr>
              <th>cert</th>
              <th>card</th>
              <th>grade</th>
              <th>lane</th>
              <th className="numeric">findings</th>
              <th>oldest</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.needsHumanReview.length === 0 ? (
              <tr>
                <td className="dealer-section-empty" colSpan={7}>
                  No records awaiting review.
                </td>
              </tr>
            ) : (
              data.needsHumanReview.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>{r.certProvider ?? "PSA"} {r.certNumber ?? r.id}</Link>
                  </td>
                  <td className="muted">{r.cardIdentity ?? "—"}</td>
                  <td>{r.officialGrade ?? "—"}</td>
                  <td className="muted">{r.lane}</td>
                  <td className="numeric">{r.modelFindings.length}</td>
                  <td className="muted">{r.createdAt.replace("T", " ").replace(/\..*$/, "Z")}</td>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>review →</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="dealer-section">
        <h2>Recent imports</h2>
        <table>
          <thead>
            <tr>
              <th>cert</th>
              <th>card</th>
              <th>grade</th>
              <th>lane</th>
              <th>created</th>
              <th>trust</th>
            </tr>
          </thead>
          <tbody>
            {data.recentImports.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/dealer/records/${r.id}`}>{r.certProvider ?? "PSA"} {r.certNumber ?? r.id}</Link>
                </td>
                <td className="muted">{r.cardIdentity ?? "—"}</td>
                <td>{r.officialGrade ?? "—"}</td>
                <td className="muted">{r.lane}</td>
                <td className="muted">{r.createdAt.replace("T", " ").replace(/\..*$/, "Z")}</td>
                <td>
                  <span className="dealer-pill">{r.trustTier ?? "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {data.priceMovers.length > 0 ? (
        <section className="dealer-section">
          <h2>Price movers (high variance)</h2>
          <table>
            <thead>
              <tr>
                <th>cert</th>
                <th>card</th>
                <th className="numeric">raw low</th>
                <th className="numeric">raw high</th>
                <th className="numeric">PSA 9</th>
                <th>variance</th>
              </tr>
            </thead>
            <tbody>
              {data.priceMovers.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/dealer/records/${r.id}`}>{r.certProvider ?? "PSA"} {r.certNumber ?? r.id}</Link>
                  </td>
                  <td className="muted">{r.cardIdentity ?? "—"}</td>
                  <td className="numeric">{fmtUsd(r.pricing?.rawLow)}</td>
                  <td className="numeric">{fmtUsd(r.pricing?.rawHigh)}</td>
                  <td className="numeric">{fmtUsd(r.pricing?.graded9)}</td>
                  <td>
                    <span className="dealer-pill dealer-pill--warn">{r.pricing?.variance}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </DealerShell>
  );
}
