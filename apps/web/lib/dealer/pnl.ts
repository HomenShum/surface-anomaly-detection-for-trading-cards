import type { DealerCostBasis, DealerRecord } from "./types";

/**
 * Compute P&L for one record.
 *
 * - cost = acquisitionCost + sum(fees)
 * - revenue = salePrice (or 0 if not yet sold)
 * - net = revenue - cost
 * - margin = net / revenue (only meaningful when sold)
 * - status = "open" | "realized" | "missing-cost"
 *
 * Returns null when the record has no costBasis at all so the UI can
 * cleanly distinguish "untracked" from "$0 cost".
 */
export type PnL = {
  acquisitionCost: number;
  feesTotal: number;
  cost: number;
  revenue: number;
  net: number;
  marginPct: number | null;
  status: "open" | "realized" | "missing-cost";
};

export function computePnL(cb: DealerCostBasis | null | undefined): PnL | null {
  if (!cb) return null;
  const acq = cb.acquisitionCost ?? 0;
  const feesTotal = (cb.fees ?? []).reduce((s, f) => s + (Number.isFinite(f.amount) ? f.amount : 0), 0);
  const cost = acq + feesTotal;
  const revenue = cb.salePrice ?? 0;
  const net = revenue - cost;
  const marginPct = revenue > 0 ? net / revenue : null;
  const status: PnL["status"] = revenue > 0 ? "realized" : cb.acquisitionCost == null ? "missing-cost" : "open";
  return { acquisitionCost: acq, feesTotal, cost, revenue, net, marginPct, status };
}

/**
 * Aggregate P&L across many records. Used by /dealer/dashboard to show
 * realized vs unrealized, and the cost-coverage rate (what % of inventory
 * has cost-basis tracked).
 */
export function aggregatePnL(records: DealerRecord[]): {
  totalAcquisitionCost: number;
  totalFees: number;
  totalCost: number;
  realizedRevenue: number;
  realizedNet: number;
  realizedCount: number;
  openCount: number;
  trackedCount: number;
  untrackedCount: number;
  coverageRate: number;
} {
  let acq = 0;
  let fees = 0;
  let revenue = 0;
  let realizedNet = 0;
  let realizedCount = 0;
  let openCount = 0;
  let trackedCount = 0;
  let untrackedCount = 0;

  for (const r of records) {
    const pnl = computePnL(r.costBasis);
    if (!pnl) {
      untrackedCount++;
      continue;
    }
    trackedCount++;
    acq += pnl.acquisitionCost;
    fees += pnl.feesTotal;
    if (pnl.status === "realized") {
      realizedCount++;
      revenue += pnl.revenue;
      realizedNet += pnl.net;
    } else {
      openCount++;
    }
  }

  const total = records.length;
  return {
    totalAcquisitionCost: acq,
    totalFees: fees,
    totalCost: acq + fees,
    realizedRevenue: revenue,
    realizedNet,
    realizedCount,
    openCount,
    trackedCount,
    untrackedCount,
    coverageRate: total > 0 ? trackedCount / total : 0,
  };
}
