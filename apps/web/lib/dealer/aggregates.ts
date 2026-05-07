import { loadAllRecords } from "./store";
import type { DealerRecord, DealerLane } from "./types";

export type DealerDashboardData = {
  inventoryValue: number;
  expectedGradedEv: number;
  readyToList: DealerRecord[];
  worthGrading: DealerRecord[];
  needsHumanReview: DealerRecord[];
  recentImports: DealerRecord[];
  priceMovers: DealerRecord[];
  submissionPipeline: DealerRecord[];
  potentialDisputes: DealerRecord[];
  laneCounts: Record<DealerLane, number>;
  totalRecords: number;
  reviewedCount: number;
  listedCount: number;
  staleCount: number;
};

export function buildDashboard(): DealerDashboardData {
  const records = loadAllRecords();
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
  return {
    inventoryValue,
    expectedGradedEv,
    readyToList,
    worthGrading,
    needsHumanReview,
    recentImports,
    priceMovers,
    submissionPipeline,
    potentialDisputes,
    laneCounts,
    totalRecords: records.length,
    reviewedCount,
    listedCount,
    staleCount,
  };
}
