export type VerifiedMethodStatus =
  | "draft"
  | "submitted"
  | "reproducing"
  | "benchmarking"
  | "verified"
  | "canary"
  | "production"
  | "retired";

export type MethodSource = "agent_chat" | "manual_submit" | "correction_flow" | "benchmark_discovery";

export type RewardEventType =
  | "method_submitted"
  | "method_reproduced"
  | "method_verified"
  | "method_merged_open_source"
  | "method_used_1000_times";

export type RewardEvent = {
  type: RewardEventType;
  label: string;
  createdAt: string;
};

export type VerifiedMethod = {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  contributorHandle: string;
  contributorName: string;
  contributorRole: string;
  source: MethodSource;
  originalUserRemark: string;
  publicRemark: string;
  status: VerifiedMethodStatus;
  supportedCardType: string;
  problem: string;
  method: string[];
  benchmark: {
    falsePositiveReductionPct: number;
    precisionLiftPct: number;
    recallLiftPct: number;
    latencyAddedMs: number;
    fixturePack: string;
    passed: boolean;
  };
  limitation: string;
  reward: string;
  usedInScans: number;
  versionHash: string;
  mergedPr: string;
  remark: string;
  rewardEvents: RewardEvent[];
};

export type ContributorProfile = {
  handle: string;
  name: string;
  role: string;
  badges: string[];
  verifiedMethods: number;
  benchmarkFixtures: number;
  corrections: number;
  impact: string;
};

export const verifiedMethods: VerifiedMethod[] = [
  {
    id: "holo_glare_reinspection_v1",
    slug: "holo-glare-reinspection-v1",
    title: "Holo Glare Reinspection v1",
    shortTitle: "Holo glare check",
    contributorHandle: "collector-methods",
    contributorName: "Collector Methods Lab",
    contributorRole: "Open-source fixture contributor",
    source: "agent_chat",
    originalUserRemark:
      "If it only appears under one light angle, treat it like glare first. Make the app prove it is damage before scaring the collector.",
    publicRemark:
      "Contributor suggested multi-angle glare-first inspection before confirming holo surface scratches.",
    status: "verified",
    supportedCardType: "Holo / glossy trading cards",
    problem:
      "Reflective holo surfaces can look like scratches when a single upload has a direct light streak across the surface.",
    method: [
      "Crop the suspicious surface region.",
      "Zoom the crop so the detector and user review the same pixels.",
      "Run glare risk check before claiming scratch.",
      "Re-run the DING detector on the low-glare crop.",
      "Mark glare_uncertain or recommend a tilt retake when confidence stays low.",
    ],
    benchmark: {
      falsePositiveReductionPct: 18,
      precisionLiftPct: 9,
      recallLiftPct: 3,
      latencyAddedMs: 420,
      fixturePack: "ccv-alpha-fixtures-20260506",
      passed: true,
    },
    limitation:
      "Canary only for severe foil glare. It improves false positives but can still miss faint real scratches without an alternate tilt frame.",
    reward: "250 scan credits + Verified Method Author badge",
    usedInScans: 1284,
    versionHash: "sha256:f2e574f742cb625fd58bdf43e872bbf719ed3eea4f20ed2c6e0ee7d18f9eac41",
    mergedPr: "inspection-methods/holo-glare-reinspection-v1",
    remark:
      "If it only appears under one light angle, treat it like glare first. Make the app prove it is damage before scaring the collector.",
    rewardEvents: [
      {
        type: "method_submitted",
        label: "Submitted from report chat",
        createdAt: "2026-05-06T09:10:00.000Z",
      },
      {
        type: "method_verified",
        label: "Verified on ccv-alpha-fixtures-20260506",
        createdAt: "2026-05-06T13:40:00.000Z",
      },
      {
        type: "method_merged_open_source",
        label: "Merged into inspection-methods/",
        createdAt: "2026-05-06T15:20:00.000Z",
      },
      {
        type: "method_used_1000_times",
        label: "Used in 1,000+ scans",
        createdAt: "2026-05-06T18:00:00.000Z",
      },
    ],
  },
  {
    id: "dark_border_edge_filter_v1",
    slug: "dark-border-edge-filter-v1",
    title: "Dark Border Edge Whitening Filter",
    shortTitle: "Dark edge filter",
    contributorHandle: "edge-review",
    contributorName: "Edge Review Group",
    contributorRole: "Benchmark reviewer",
    source: "correction_flow",
    originalUserRemark:
      "Dark borders need local context. A bright pixel on black is not automatically whitening.",
    publicRemark:
      "Contributor suggested local border-context checks before calling edge whitening on dark cards.",
    status: "benchmarking",
    supportedCardType: "Dark-border Pokemon, sports, and One Piece backs",
    problem:
      "Dark borders produce contrast halos that the current detector can over-call as edge whitening.",
    method: [
      "Crop left/right edge ribbons.",
      "Measure local border contrast before detecting edge_wear.",
      "Compare against adjacent clean border patch.",
      "Downgrade low-texture halos to unknown_damage unless whitening persists.",
    ],
    benchmark: {
      falsePositiveReductionPct: 13,
      precisionLiftPct: 6,
      recallLiftPct: -2,
      latencyAddedMs: 310,
      fixturePack: "dark-border-edge-fixtures-v0",
      passed: false,
    },
    limitation: "Still misses a few true minor edge wear examples; not verified yet.",
    reward: "Benchmark bounty pending",
    usedInScans: 0,
    versionHash: "draft:dark-border-edge-filter-v1",
    mergedPr: "not-merged",
    remark: "Dark borders need local context. A bright pixel on black is not automatically whitening.",
    rewardEvents: [
      {
        type: "method_submitted",
        label: "Submitted from correction pattern",
        createdAt: "2026-05-06T11:15:00.000Z",
      },
      {
        type: "method_reproduced",
        label: "Reproduced on dark-border fixtures",
        createdAt: "2026-05-06T14:05:00.000Z",
      },
    ],
  },
  {
    id: "before_after_corner_alignment_v1",
    slug: "before-after-corner-alignment-v1",
    title: "Before/After Corner Alignment v1",
    shortTitle: "Corner alignment",
    contributorHandle: "diff-builder",
    contributorName: "Diff Builder",
    contributorRole: "Before/after workflow contributor",
    source: "manual_submit",
    originalUserRemark:
      "A dispute diff should not punish the user for taking the second photo at a slightly different angle.",
    publicRemark:
      "Contributor proposed border-anchor alignment before flagging new before/after corner defects.",
    status: "reproducing",
    supportedCardType: "Return-condition and dispute workflows",
    problem:
      "Small perspective differences between before and after scans can look like new corner damage.",
    method: [
      "Normalize both scans.",
      "Align corner crops by card border anchors.",
      "Compare only the overlapping crop region.",
      "Flag new damage only when the aligned diff persists after brightness normalization.",
    ],
    benchmark: {
      falsePositiveReductionPct: 0,
      precisionLiftPct: 0,
      recallLiftPct: 0,
      latencyAddedMs: 0,
      fixturePack: "pending",
      passed: false,
    },
    limitation: "Reproduced on sample cards, benchmark pack not complete.",
    reward: "Reproduced Method badge",
    usedInScans: 0,
    versionHash: "draft:before-after-corner-alignment-v1",
    mergedPr: "not-merged",
    remark: "A dispute diff should not punish the user for taking the second photo at a slightly different angle.",
    rewardEvents: [
      {
        type: "method_submitted",
        label: "Submitted from before/after review",
        createdAt: "2026-05-06T12:05:00.000Z",
      },
      {
        type: "method_reproduced",
        label: "Reproduction started on sample cards",
        createdAt: "2026-05-06T16:10:00.000Z",
      },
    ],
  },
];

export const contributors: ContributorProfile[] = [
  {
    handle: "collector-methods",
    name: "Collector Methods Lab",
    role: "Open-source fixture contributor",
    badges: ["Verified Method Author", "Holo Specialist", "Benchmark Builder"],
    verifiedMethods: 1,
    benchmarkFixtures: 24,
    corrections: 67,
    impact: "-18% holo surface false positives on the verified fixture pack.",
  },
  {
    handle: "edge-review",
    name: "Edge Review Group",
    role: "Benchmark reviewer",
    badges: ["Trusted Reviewer", "Edge Wear Specialist"],
    verifiedMethods: 0,
    benchmarkFixtures: 31,
    corrections: 112,
    impact: "Building a dark-border fixture pack for edge whitening false positives.",
  },
  {
    handle: "diff-builder",
    name: "Diff Builder",
    role: "Before/after workflow contributor",
    badges: ["Before/After Investigator"],
    verifiedMethods: 0,
    benchmarkFixtures: 8,
    corrections: 19,
    impact: "Reproduced a corner alignment method for dispute workflows.",
  },
];

export const methodBounties = [
  "Reduce false scratches on holo cards",
  "Improve edge wear detection on dark borders",
  "Detect corner whitening on Japanese cards",
  "Improve before/after swap confidence",
  "Find clean foil benchmark examples",
] as const;

export function methodBySlug(slug: string) {
  return verifiedMethods.find((method) => method.slug === slug);
}

export function contributorByHandle(handle: string) {
  return contributors.find((contributor) => contributor.handle === handle);
}

export function methodsByContributor(handle: string) {
  return verifiedMethods.filter((method) => method.contributorHandle === handle);
}

export function statusLabel(status: VerifiedMethodStatus) {
  return status.replaceAll("_", " ");
}
