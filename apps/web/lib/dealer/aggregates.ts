import { loadAllRecords } from "./store";
import { aggregatePnL } from "./pnl";
import type { DealerRecord, DealerLane } from "./types";

export type DealerDashboardData = {
  inventoryValue: number;
  expectedGradedEv: number;
  readyToList: DealerRecord[];
  worthGrading: DealerRecord[];
  needsHumanReview: DealerRecord[];
  recentImports: DealerRecord[];
  topByValue: DealerRecord[];
  priceMovers: DealerRecord[];
  submissionPipeline: DealerRecord[];
  potentialDisputes: DealerRecord[];
  laneCounts: Record<DealerLane, number>;
  totalRecords: number;
  reviewedCount: number;
  listedCount: number;
  staleCount: number;
  /**
   * Real time-series: cumulative inventory value (sum of rawHigh) by day for
   * the past `inventorySeries.length` days. Index 0 is the oldest, last index
   * is "today". Computed from each record's createdAt — bucketed by UTC day.
   */
  inventorySeries: number[];
  /** Real delta = today's inventory minus 30 days ago. */
  delta30: number;
  /** Aggregated P&L across the vault. */
  pnl: ReturnType<typeof aggregatePnL>;
};

export function buildDashboard(ownerId: string): DealerDashboardData {
  const records = loadAllRecords(ownerId);
  const inventoryValue = records.reduce((acc, r) => acc + (r.pricing?.rawHigh ?? 0), 0);
  const expectedGradedEv = records.reduce(
    (acc, r) => acc + (r.roi?.expectedGradedEv ?? 0),
    0,
  );
  const readyToList = records.filter((r) => r.lane === "ready" && !r.listing);
  const worthGrading = records.filter(
    (r) => r.roi?.recommendation === "submit" && r.lane !== "submitted",
  );
  const needsHumanReview = records.filter((r) => r.lane === "human_review");
  const recentImports = [...records]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  const topByValue = [...records]
    .filter((r) => Boolean(r.pricing?.rawHigh) && Boolean(r.imageUrl ?? r.cardIdentity))
    .sort((a, b) => (b.pricing?.rawHigh ?? 0) - (a.pricing?.rawHigh ?? 0))
    .slice(0, 8);
  const priceMovers = records.filter((r) => r.pricing?.variance === "high").slice(0, 8);
  const submissionPipeline = records.filter((r) => Boolean(r.submission));
  const potentialDisputes = records.filter(
    (r) => r.humanReview?.decision === "before_after_evidence",
  );
  const laneCounts: Record<DealerLane, number> = {
    uploaded: 0,
    certs_detected: 0,
    verified: 0,
    image_attached: 0,
    ready: 0,
    human_review: 0,
    listed: 0,
    submitted: 0,
    sold: 0,
  };
  for (const r of records) laneCounts[r.lane] = (laneCounts[r.lane] ?? 0) + 1;
  const reviewedCount = records.filter((r) => Boolean(r.humanReview)).length;
  const listedCount = records.filter((r) => Boolean(r.listing)).length;
  const STALE_DAYS = 30;
  const cutoff = Date.now() - STALE_DAYS * 86400 * 1000;
  const staleCount = records.filter((r) => Date.parse(r.createdAt) < cutoff && r.lane !== "sold").length;

  // Real time-series: cumulative inventory value bucketed by UTC day for the
  // past 30 days. Each bucket sums rawHigh for records.createdAt ≤ that day.
  const SERIES_DAYS = 30;
  const dayMs = 86400 * 1000;
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const startMs = todayUTC.getTime() - (SERIES_DAYS - 1) * dayMs;
  const inventorySeries: number[] = new Array(SERIES_DAYS).fill(0);
  for (let i = 0; i < SERIES_DAYS; i++) {
    const dayCutoff = startMs + (i + 1) * dayMs;
    let sum = 0;
    for (const r of records) {
      const created = Date.parse(r.createdAt);
      if (Number.isFinite(created) && created < dayCutoff) {
        sum += r.pricing?.rawHigh ?? 0;
      }
    }
    inventorySeries[i] = sum;
  }
  const todayValue = inventorySeries[SERIES_DAYS - 1] ?? 0;
  const monthAgoValue = inventorySeries[0] ?? 0;
  const delta30 = todayValue - monthAgoValue;

  return {
    inventoryValue,
    expectedGradedEv,
    readyToList,
    worthGrading,
    needsHumanReview,
    recentImports,
    topByValue,
    priceMovers,
    submissionPipeline,
    potentialDisputes,
    laneCounts,
    totalRecords: records.length,
    reviewedCount,
    listedCount,
    staleCount,
    inventorySeries,
    delta30,
    pnl: aggregatePnL(records),
  };
}
