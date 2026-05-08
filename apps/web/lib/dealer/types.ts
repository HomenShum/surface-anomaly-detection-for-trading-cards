/**
 * Dealer-OS type system. One record represents one inventory item — raw card,
 * graded slab, sealed product, binder page, lot, or submission.
 *
 * Lanes are workflow buckets (uploaded → certs detected → verified → image
 * attached → ready → human review → listed → submitted → sold). Records
 * advance through lanes as the dealer pipeline runs (OCR, cert verify,
 * detector, review, listing).
 *
 * Persistence is one JSONL file per surface under `data/dealer/`. The store
 * is append/replace by id — no DB needed for the vendor pilot.
 */

export type DealerInventoryType =
  | "raw"
  | "graded"
  | "sealed"
  | "binder"
  | "lot"
  | "consignment"
  | "submitted"
  | "returned";

export type DealerLane =
  | "uploaded"
  | "certs_detected"
  | "verified"
  | "image_attached"
  | "ready"
  | "human_review"
  | "listed"
  | "submitted"
  | "sold";

export type DealerCertProvider = "PSA" | "TAG" | "CGC" | "BGS";

export type DealerVariant = {
  language?: string;
  setName?: string;
  cardNumber?: string;
  parallel?: string;
  finish?: string;
  promoStamp?: string;
  firstEdition?: boolean;
};

export type DealerModelFinding = {
  type: string;
  bbox: [number, number, number, number];
  severity: "minor" | "moderate" | "major" | "uncertain";
  confidence: number;
  modelVersion: string;
  region?: string;
  imageHash?: string;
  acceptedByReview?: "accepted" | "rejected" | "pending";
  reviewerNote?: string;
};

export type DealerHumanReview = {
  reviewedAt: string;
  reviewer: string;
  acceptedFindings: number;
  rejectedFindings: number;
  addedFindings: DealerModelFinding[];
  notes?: string;
  decision?: "submit_for_grading" | "sell_raw" | "rescan" | "human_review" | "before_after_evidence";
};

export type DealerPricing = {
  rawLow?: number;
  rawMid?: number;
  rawHigh?: number;
  graded8?: number;
  graded9?: number;
  graded10?: number;
  source?: string;
  confidence?: "low" | "medium" | "high";
  freshness?: string; // e.g. "9 days ago"
  saleCount?: number;
  variance?: "low" | "medium" | "high";
  comps?: DealerComp[];
};

export type DealerComp = {
  date: string;
  marketplace: string;
  grade?: string;
  condition?: string;
  salePrice: number;
  shipping?: number;
  link?: string;
  outlierFlag?: boolean;
};

export type DealerGradingRoi = {
  rawValue?: number;
  expectedGradeDistribution?: Record<string, number>; // band -> probability
  expectedGradedEv?: number;
  gradingFee?: number;
  shippingFee?: number;
  netEv?: number;
  recommendation: "submit" | "sell_raw" | "hold" | "rescan" | "human_review";
  rationale?: string;
  dealScore?: "low" | "medium" | "high";
};

export type DealerListingDraft = {
  marketplace: "ebay" | "tcgplayer" | "cardmarket" | "private";
  title?: string;
  description?: string;
  conditionNotes?: string;
  recommendedPrice?: number;
  photosReady?: boolean;
  draftStatus: "drafted" | "pending_review" | "ready" | "published";
  publicReportUrl?: string;
};

export type DealerSubmissionTracking = {
  submissionId?: string;
  declaredValue?: number;
  submittedAt?: string;
  expectedReturnAt?: string;
  status:
    | "raw_acquired"
    | "pre_scan_complete"
    | "submitted"
    | "received"
    | "grading"
    | "shipped_back"
    | "returned"
    | "listed"
    | "sold";
  preSubmissionEvidenceId?: string;
  returnedGrade?: string;
  deltaVsExpected?: string;
};

export type DealerEvidencePacket = {
  packetId: string;
  generatedAt: string;
  certUrl?: string;
  imageHash?: string;
  modelVersion?: string;
  reviewer?: string;
  detectionsCount: number;
  acceptedDetectionsCount: number;
  signed?: boolean;
  signature?: string;
  exportedAs?: ("json" | "html" | "pdf")[];
};

export type DealerAlert = {
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
};

/**
 * Cost-basis ledger entry — captures what the dealer paid for the card,
 * any one-time costs (grading, shipping, slabbing supplies), and the sale
 * price when realized. P&L = salePrice - acquisitionCost - sum(fees).
 *
 * Vendors enter this on the record-detail page after they win a bid /
 * complete a buy. The ledger is append-only — corrections create a new
 * adjustment entry instead of overwriting history.
 */
export type DealerCostBasis = {
  acquisitionCost?: number;
  acquisitionDate?: string; // ISO
  acquisitionChannel?: "ebay" | "tcgplayer" | "cardmarket" | "auction" | "private" | "other";
  acquisitionNote?: string;
  fees?: Array<{
    label: string;
    amount: number;
    /** ISO date this fee was paid */
    paidAt?: string;
  }>;
  salePrice?: number;
  saleDate?: string; // ISO
  saleChannel?: "ebay" | "tcgplayer" | "cardmarket" | "private" | "other";
  saleBuyer?: string;
  /** Computed: salePrice - acquisitionCost - sum(fees). Not stored — recomputed on read. */
};

export type DealerRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  inventoryType: DealerInventoryType;
  lane: DealerLane;
  /** Source batch id when ingested via /dealer/intake. */
  sourceBatchId?: string;
  certNumber?: string;
  certProvider?: DealerCertProvider;
  certUrl?: string;
  cardIdentity?: string;
  variant?: DealerVariant;
  /** Auto-incremented when scanning duplicates of a raw card. Slabs/certs always 1. */
  quantity: number;
  imageHash?: string;
  imageUrl?: string;
  /** Raw OCR text from the cert label (for audit). */
  ocrText?: string;
  officialGrade?: string;
  officialBand?: string;
  modelFindings: DealerModelFinding[];
  humanReview?: DealerHumanReview;
  evidencePacket?: DealerEvidencePacket;
  pricing?: DealerPricing;
  roi?: DealerGradingRoi;
  costBasis?: DealerCostBasis;
  listing?: DealerListingDraft;
  submission?: DealerSubmissionTracking;
  notes?: string;
  consentFlag?: "pending" | "granted" | "revoked";
  trustTier?: "bronze" | "silver" | "silver_plus" | "gold";
};

export type DealerIntakeBatch = {
  batchId: string;
  uploadedAt: string;
  uploaderHint?: string;
  inputFilename?: string;
  imageHash?: string;
  uniqueCertNumbers: string[];
  recordIds: string[];
  status: "pending_ocr" | "ocr_complete" | "verified" | "image_attached" | "ready" | "failed";
};

export const LANE_ORDER: DealerLane[] = [
  "uploaded",
  "certs_detected",
  "verified",
  "image_attached",
  "ready",
  "human_review",
  "listed",
  "submitted",
  "sold",
];

export const LANE_LABEL: Record<DealerLane, string> = {
  uploaded: "Uploaded",
  certs_detected: "Certs detected",
  verified: "Verified",
  image_attached: "Image attached",
  ready: "Ready",
  human_review: "Needs human review",
  listed: "Listed",
  submitted: "Submitted",
  sold: "Sold",
};
