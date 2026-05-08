import Link from "next/link";
import { loadAllRecords } from "../lib/dealer/store";
import type { DealerRecord } from "../lib/dealer/types";

function fmtUsd(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtRelative(iso: string | undefined): string {
  if (!iso) return "n/a";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "n/a";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function recordRecommendation(r: DealerRecord): { label: string; tone: "good" | "warn" | "bad" | "muted" | "info" } {
  const rec = r.roi?.recommendation;
  if (rec === "submit") return { label: "submit", tone: "good" };
  if (rec === "sell_raw") return { label: "sell raw", tone: "warn" };
  if (rec === "rescan") return { label: "rescan", tone: "info" };
  if (rec === "human_review") return { label: "review", tone: "bad" };
  if (rec === "hold") return { label: "hold", tone: "muted" };
  if (r.lane === "human_review") return { label: "needs review", tone: "bad" };
  return { label: r.lane.replace(/_/g, " "), tone: "muted" };
}

export function DealerHeroContext({ expert }: { expert: boolean }) {
  const records = loadAllRecords();
  const total = records.length;
  const reviewed = records.filter((r) => Boolean(r.humanReview)).length;
  const listed = records.filter((r) => Boolean(r.listing)).length;
  const submitted = records.filter((r) => Boolean(r.submission)).length;
  const needsReview = records.filter((r) => r.lane === "human_review").length;
  const inventoryValue = records.reduce((acc, r) => acc + (r.pricing?.rawHigh ?? 0), 0);
  const lastUpdated = records.reduce<string | undefined>(
    (acc, r) => (acc && acc > r.updatedAt ? acc : r.updatedAt),
    undefined,
  );
  const recent = [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  return (
    <section className="dealer-hero-context">
      <header className="dealer-hero-context-head">
        <div>
          <h2>Vendor pilot vault</h2>
          <p>
            {total} card{total === 1 ? "" : "s"} captured | {reviewed} reviewed | {listed} listed | {submitted} in
            grading pipeline | last activity {fmtRelative(lastUpdated)}
          </p>
        </div>
        <Link className="dealer-hero-context-cta" href="/dealer/dashboard">
          Open admin dashboard
        </Link>
      </header>

      <div className="dealer-hero-stats">
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">cards captured</span>
          <span className="dealer-hero-stat-val">{total}</span>
        </div>
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">reviewed</span>
          <span className="dealer-hero-stat-val">{reviewed}</span>
        </div>
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">needs review</span>
          <span className="dealer-hero-stat-val dealer-hero-stat-val--warn">{needsReview}</span>
        </div>
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">listed</span>
          <span className="dealer-hero-stat-val">{listed}</span>
        </div>
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">submitted</span>
          <span className="dealer-hero-stat-val">{submitted}</span>
        </div>
        <div className="dealer-hero-stat">
          <span className="dealer-hero-stat-key">inventory $</span>
          <span className="dealer-hero-stat-val">{fmtUsd(inventoryValue)}</span>
        </div>
      </div>

      <div className="dealer-hero-recent">
        <header>
          <h3>Recent records</h3>
          <Link href="/dealer/dashboard">see all</Link>
        </header>
        <ul>
          {recent.length === 0 ? (
            <li className="dealer-hero-recent-empty">
              No records yet. Drop a card photo above to create your first record.
            </li>
          ) : (
            recent.map((r) => {
              const rec = recordRecommendation(r);
              return (
                <li key={r.id}>
                  <Link href={`/dealer/records/${r.id}`}>
                    <span className="dealer-hero-recent-cert">
                      {r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id.slice(0, 14)}
                    </span>
                    <span className="dealer-hero-recent-card">
                      {r.cardIdentity ?? "(no card identity)"}
                    </span>
                    <span className="dealer-hero-recent-meta">
                      {r.officialGrade ?? "n/a"} | {fmtRelative(r.updatedAt)}
                    </span>
                    <span className={`dealer-hero-recent-pill dealer-hero-recent-pill--${rec.tone}`}>{rec.label}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="dealer-hero-shortcuts">
        <Link className="dealer-hero-shortcut" href={expert ? "/dealer/dashboard?expert=1" : "/dealer/dashboard"}>
          <span className="dealer-hero-shortcut-key">DASHBOARD</span>
          <span className="dealer-hero-shortcut-val">{total} records | {fmtUsd(inventoryValue)}</span>
          <span className="dealer-hero-shortcut-hint">inventory + worth-grading + needs-review</span>
        </Link>
        <Link className="dealer-hero-shortcut" href={expert ? "/dealer/listings?expert=1" : "/dealer/listings"}>
          <span className="dealer-hero-shortcut-key">LISTINGS</span>
          <span className="dealer-hero-shortcut-val">{listed} draft{listed === 1 ? "" : "s"}</span>
          <span className="dealer-hero-shortcut-hint">deal score | evidence-packet-attached drafts</span>
        </Link>
        <Link
          className="dealer-hero-shortcut"
          href={expert ? "/dealer/submissions?expert=1" : "/dealer/submissions"}
        >
          <span className="dealer-hero-shortcut-key">SUBMISSIONS</span>
          <span className="dealer-hero-shortcut-val">{submitted} in pipeline</span>
          <span className="dealer-hero-shortcut-hint">raw to submitted to returned to listed</span>
        </Link>
        <Link className="dealer-hero-shortcut" href={expert ? "/dealer/alerts?expert=1" : "/dealer/alerts"}>
          <span className="dealer-hero-shortcut-key">ALERTS</span>
          <span className="dealer-hero-shortcut-val">live signals</span>
          <span className="dealer-hero-shortcut-hint">price moves | returned-low | deal-score high</span>
        </Link>
      </div>

      <p className="dealer-hero-trust">
        Vendor pilot | local-first storage in <code>data/dealer/</code> | cert images never trained on without consent |
        every saved proof is HMAC-signed and includes the cert URL, image hash, model version, reviewer, and
        timestamp.
      </p>
    </section>
  );
}
