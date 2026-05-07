import Link from "next/link";
import { AlphaBadge } from "../../../components/AlphaBadge";
import { InferenceHealthPill } from "../../../components/InferenceHealthPill";
import { loadAllRecords } from "../../../lib/dealer/store";
import type { DealerRecord } from "../../../lib/dealer/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer alerts · Card Condition Vault",
  description: "Watchlist alerts: PSA 10 value moves, raw-to-graded spread, submission returns, comp confidence.",
};

type Alert = {
  id: string;
  type:
    | "psa10_value_up"
    | "raw_to_graded_spread"
    | "buy_target"
    | "submission_returned_low"
    | "comp_changed_confidence";
  message: string;
  triggeredAt: string;
  cardId?: string;
  severity: "info" | "warn" | "critical";
};

function deriveAlerts(records: DealerRecord[]): Alert[] {
  const out: Alert[] = [];
  const now = new Date().toISOString();
  for (const r of records) {
    if (r.pricing?.confidence === "low" && r.pricing.saleCount && r.pricing.saleCount < 5) {
      out.push({
        id: `alert_conf_${r.id}`,
        type: "comp_changed_confidence",
        message: `${r.certProvider ?? "PSA"} ${r.certNumber ?? r.id} has ${r.pricing.saleCount} comps · low confidence pricing.`,
        triggeredAt: now,
        cardId: r.id,
        severity: "warn",
      });
    }
    if (r.roi?.recommendation === "submit" && r.lane !== "submitted") {
      out.push({
        id: `alert_roi_${r.id}`,
        type: "raw_to_graded_spread",
        message: `${r.certProvider ?? "PSA"} ${r.certNumber ?? r.id} expected graded EV $${r.roi.expectedGradedEv} > raw $${r.roi.rawValue} · submit?`,
        triggeredAt: now,
        cardId: r.id,
        severity: "info",
      });
    }
    if (r.submission?.status === "returned" && r.submission.deltaVsExpected) {
      out.push({
        id: `alert_sub_${r.id}`,
        type: "submission_returned_low",
        message: `${r.certProvider ?? "PSA"} ${r.certNumber ?? r.id} returned ${r.submission.returnedGrade ?? "?"} · ${r.submission.deltaVsExpected}`,
        triggeredAt: now,
        cardId: r.id,
        severity: "critical",
      });
    }
    if (r.roi?.dealScore === "high") {
      out.push({
        id: `alert_deal_${r.id}`,
        type: "buy_target",
        message: `${r.certProvider ?? "PSA"} ${r.certNumber ?? r.id} deal score: high · net EV $${r.roi.netEv}`,
        triggeredAt: now,
        cardId: r.id,
        severity: "info",
      });
    }
  }
  return out.slice(0, 50);
}

export default function DealerAlertsPage() {
  const records = loadAllRecords();
  const alerts = deriveAlerts(records);
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
          <Link href="/dealer/alerts">Alerts</Link>
          <Link href="/examples">Examples</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section>
        <span className="page-kicker">Vendor pilot · alerts</span>
        <h1>Watchlist alerts</h1>
        <p className="muted">
          Derived from inventory state — not push notifications. Each alert links to the underlying record so the
          dealer can act in one click. Real-time alerts (push / email) ship in a later milestone.
        </p>
      </section>

      <section className="dealer-section">
        <h2>Active ({alerts.length})</h2>
        <table>
          <thead>
            <tr>
              <th>type</th>
              <th>severity</th>
              <th>message</th>
              <th>card</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={4} className="dealer-section-empty">
                  No active alerts. Add records to /dealer/intake to start populating signals.
                </td>
              </tr>
            ) : (
              alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="dealer-pill">{a.type.replace(/_/g, " ")}</span>
                  </td>
                  <td>
                    <span className={`dealer-pill ${a.severity === "critical" ? "dealer-pill--bad" : a.severity === "warn" ? "dealer-pill--warn" : ""}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="muted">{a.message}</td>
                  <td>
                    {a.cardId ? <Link href={`/dealer/records/${a.cardId}`}>open →</Link> : null}
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
