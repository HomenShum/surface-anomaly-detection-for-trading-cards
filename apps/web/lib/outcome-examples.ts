export type OutcomeProvenance =
  | "gold_user_consented"
  | "silver_certified_reference"
  | "silver_human_reviewed"
  | "bronze_open_ding_dataset"
  | "bronze_dataset_fixture";

export type OutcomeSourceType =
  | "user_consented_gold"
  | "certified_reference"
  | "open_training_dataset"
  | "human_reviewed_fixture";

export type OutcomeExample = {
  id: string;
  slug: string;
  title: string;
  game: string;
  finishType: "matte" | "glossy" | "holo" | "textured_foil" | "unknown";
  image?: string;
  backImage?: string;
  knownOutcome: string;
  outcomeSource: string;
  sourceType: OutcomeSourceType;
  provenance: OutcomeProvenance;
  externalUrl?: string;
  certNumber?: string;
  grader?: "PSA" | "CGC" | "BGS" | "TAG" | "Human" | "Dataset";
  officialGrade?: string;
  hasOfficialGrade: boolean;
  hasDingLabels: boolean;
  useForTraining: boolean;
  useForPublicExample: boolean;
  storeImagesLocally: boolean;
  usageRights: string;
  benchmarkBand: string;
  modelBand: string;
  modelConfidence: number;
  result: "matched_band" | "overcalled" | "missed_issue" | "low_confidence" | "demo_only" | "cert_reference";
  summary: string;
  attributes: {
    corners: number;
    edges: number;
    centering: number;
    surface: number;
    dimensions: number;
  };
  dings: Array<{
    id: string;
    type: string;
    attribute: "Corners" | "Edges" | "Centering" | "Surface" | "Dimensions";
    location: string;
    confidence: number;
    materiality: "dominant_ding" | "material_ding" | "not_material" | "uncertain";
    bbox: [number, number, number, number];
    note: string;
  }>;
  whatItGotRight: string[];
  whatItMissed: string[];
  limitations: string[];
  captureQuality: {
    blur: "pass" | "warning" | "fail";
    glare: "pass" | "warning" | "fail";
    edgeVisibility: "pass" | "warning" | "fail";
    recommendation: string;
  };
};

type SourceRights = Pick<
  OutcomeExample,
  | "sourceType"
  | "provenance"
  | "grader"
  | "officialGrade"
  | "hasOfficialGrade"
  | "hasDingLabels"
  | "useForTraining"
  | "useForPublicExample"
  | "storeImagesLocally"
  | "usageRights"
>;

const humanReviewedFixtureRights: SourceRights = {
  sourceType: "human_reviewed_fixture",
  provenance: "silver_human_reviewed",
  grader: "Human",
  hasOfficialGrade: false,
  hasDingLabels: true,
  useForTraining: true,
  useForPublicExample: true,
  storeImagesLocally: true,
  usageRights:
    "Local CCV verified seed fixture for trust onboarding and detector QA. Not an official grading outcome.",
};

const openDingDatasetRights: SourceRights = {
  sourceType: "open_training_dataset",
  provenance: "bronze_open_ding_dataset",
  grader: "Dataset",
  hasOfficialGrade: false,
  hasDingLabels: true,
  useForTraining: true,
  useForPublicExample: true,
  storeImagesLocally: true,
  usageRights:
    "Open DING dataset fixture with attribution required by source license. Not an official grading outcome.",
};

function psaReference(input: {
  id: string;
  slug: string;
  title: string;
  game: string;
  finishType: OutcomeExample["finishType"];
  certNumber: string;
  officialGrade: string;
  externalUrl: string;
  summary: string;
  limitations?: string[];
}): OutcomeExample {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    game: input.game,
    finishType: input.finishType,
    knownOutcome: `PSA ${input.officialGrade}`,
    outcomeSource: `PSA cert ${input.certNumber}`,
    sourceType: "certified_reference",
    provenance: "silver_certified_reference",
    externalUrl: input.externalUrl,
    certNumber: input.certNumber,
    grader: "PSA",
    officialGrade: input.officialGrade,
    hasOfficialGrade: true,
    hasDingLabels: false,
    useForTraining: false,
    useForPublicExample: true,
    storeImagesLocally: false,
    usageRights:
      "External certified reference only. Do not cache cert images or use for training without explicit permission.",
    benchmarkBand: "External certified outcome reference",
    modelBand: "Not analyzed by local model",
    modelConfidence: 0,
    result: "cert_reference",
    summary: input.summary,
    attributes: { corners: 0, edges: 0, centering: 0, surface: 0, dimensions: 0 },
    dings: [],
    whatItGotRight: [
      "Separates official outcome metadata from detector training data.",
      "Provides a real cert-linked reference point without inventing DING annotations.",
    ],
    whatItMissed: [
      "PSA public cert references do not expose DING-level grading notes.",
      "No local model overlay is shown until the image rights and analysis input are explicit.",
    ],
    limitations: [
      "External certified reference, not a gold CCV training record.",
      "Official grade is linked as outcome metadata only.",
      ...(input.limitations ?? []),
    ],
    captureQuality: {
      blur: "warning",
      glare: "warning",
      edgeVisibility: "warning",
      recommendation:
        "Use this as a linked outcome reference. For model evaluation, attach user-consented raw scans or open licensed images.",
    },
  };
}

export const dataSourceTiers = [
  {
    tier: "Gold",
    source: "User-consented raw scan + official grade + human DING review",
    publicUse: "Public example only when the user opts in",
    trainingUse: "Allowed only with explicit consent",
    trust: "Highest",
  },
  {
    tier: "Silver",
    source: "PSA / CGC / BGS / TAG public certified references",
    publicUse: "Linked examples and outcome metadata",
    trainingUse: "No training or local image cache without permission",
    trust: "High outcome trust, limited DING truth",
  },
  {
    tier: "Bronze",
    source: "Open DING datasets and human-reviewed fixtures",
    publicUse: "Annotated detector examples with attribution",
    trainingUse: "Allowed when license permits",
    trust: "Good detector bootstrap, not official grading truth",
  },
] as const;

export const outcomeExamples: OutcomeExample[] = [
  psaReference({
    id: "psa-mew-ex-101964593",
    slug: "psa-mew-ex-101964593",
    title: "Pokemon Mew ex Certified Reference",
    game: "Pokemon",
    finishType: "textured_foil",
    certNumber: "101964593",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/101964593",
    summary:
      "A real PSA certified reference that helps users see how the library handles known outcomes without pretending to own PSA's private DING annotations.",
  }),
  psaReference({
    id: "psa-giratina-vstar-101283999",
    slug: "psa-giratina-vstar-101283999",
    title: "Pokemon Giratina VSTAR Certified Reference",
    game: "Pokemon",
    finishType: "textured_foil",
    certNumber: "101283999",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/101283999",
    summary:
      "Premium Pokemon full-art reference for outcome calibration UI. The cert is linked externally and not used as training data.",
  }),
  psaReference({
    id: "psa-carmine-sar-141562296",
    slug: "psa-carmine-sar-141562296",
    title: "Pokemon Carmine SAR Certified Reference",
    game: "Pokemon",
    finishType: "textured_foil",
    certNumber: "141562296",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/141562296",
    summary:
      "Japanese SAR reference used to show that outcome records can include grader, cert number, and rights limits before any model overlay.",
  }),
  psaReference({
    id: "psa-portgas-ace-130349493",
    slug: "psa-portgas-ace-130349493",
    title: "One Piece Portgas D. Ace Certified Reference",
    game: "One Piece",
    finishType: "textured_foil",
    certNumber: "130349493",
    officialGrade: "MINT 9",
    externalUrl: "https://www.psacard.com/cert/130349493/psa",
    summary:
      "A non-10 certified reference. This is important for trust because the library must show lower outcomes and uncertainty, not only gem examples.",
  }),
  psaReference({
    id: "psa-luffy-manga-146379905",
    slug: "psa-luffy-manga-146379905",
    title: "One Piece Luffy Manga Certified Reference",
    game: "One Piece",
    finishType: "textured_foil",
    certNumber: "146379905",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/146379905/psa",
    summary:
      "Premium manga-art certified reference. The app treats it as outcome metadata, not as permission to cache or train on cert imagery.",
  }),
  psaReference({
    id: "psa-riftbound-ahri-141265943",
    slug: "psa-riftbound-ahri-141265943",
    title: "Riftbound Ahri Certified Reference",
    game: "Riftbound",
    finishType: "textured_foil",
    certNumber: "141265943",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/141265943/psa",
    summary:
      "Riftbound reference showing the outcome library can support newer TCG categories without making authenticity or market claims.",
  }),
  psaReference({
    id: "psa-riftbound-jinx-137279140",
    slug: "psa-riftbound-jinx-137279140",
    title: "Riftbound Jinx Certified Reference",
    game: "Riftbound",
    finishType: "textured_foil",
    certNumber: "137279140",
    officialGrade: "GEM MT 10",
    externalUrl: "https://www.psacard.com/cert/137279140/psa",
    summary:
      "Signature/overnumber-style certified reference used to demonstrate source-tier metadata and usage-rights clarity.",
  }),
  {
    id: "roboflow-tauros-real-ding-001",
    slug: "roboflow-tauros-real-ding-annotations",
    title: "Real Tauros Card DING Annotation Fixture",
    game: "Pokemon",
    finishType: "holo",
    image: "/demo/sample-cards/roboflow-tauros-real-card.jpg",
    knownOutcome: "Open DING fixture: visible edge and corner wear",
    outcomeSource: "Roboflow-style real card fixture bundled for CCV demo QA",
    ...openDingDatasetRights,
    benchmarkBand: "Visible edge/corner condition risk",
    modelBand: "700-799 visible condition risk",
    modelConfidence: 81,
    result: "matched_band",
    summary:
      "A real card image with visible edge and corner wear, used so demos show actual DING labels on card pixels instead of synthetic placeholders.",
    attributes: { corners: 68, edges: 61, centering: 84, surface: 72, dimensions: 97 },
    dings: [
      {
        id: "tauros-top-edge-wear-001",
        type: "edge_wear",
        attribute: "Edges",
        location: "top edge whitening",
        confidence: 0.82,
        materiality: "material_ding",
        bbox: [0, 0, 98, 9],
        note: "Visible whitening and border wear along the top edge of the real card image.",
      },
      {
        id: "tauros-bottom-left-corner-001",
        type: "corner_wear",
        attribute: "Corners",
        location: "bottom-left corner touch",
        confidence: 0.76,
        materiality: "material_ding",
        bbox: [0, 86, 10, 100],
        note: "Corner and lower-edge wear are visible near the lower-left card boundary.",
      },
      {
        id: "tauros-right-edge-wear-001",
        type: "edge_wear",
        attribute: "Edges",
        location: "right edge whitening",
        confidence: 0.69,
        materiality: "material_ding",
        bbox: [91, 10, 100, 88],
        note: "Right edge shows visible whitening consistent with edge-wear review.",
      },
    ],
    whatItGotRight: [
      "Uses real card pixels in the trust demo.",
      "Labels DING type, confidence, location, and materiality directly on the image.",
      "Keeps the source tier separate from official-grade claims.",
    ],
    whatItMissed: [
      "No PSA/TAG/CGC/BGS official outcome is attached.",
      "No raw before-submission plus returned-grade linkage exists yet.",
    ],
    limitations: [
      "Open DING fixture, not a Gold record.",
      "The annotations are visible-condition evidence, not official grader rationale.",
    ],
    captureQuality: {
      blur: "pass",
      glare: "warning",
      edgeVisibility: "pass",
      recommendation: "Good enough for showing real DING labels; add back image and official outcome for stronger reference value.",
    },
  },
  {
    id: "fixture-edge-wear-001",
    slug: "edge-wear-human-reviewed",
    title: "Back Edge Whitening Fixture",
    game: "Pokemon-style TCG",
    finishType: "matte",
    image: "/examples/edge-wear.png",
    knownOutcome: "Human-reviewed: visible edge wear",
    outcomeSource: "CCV verified seed fixture v1",
    ...humanReviewedFixtureRights,
    benchmarkBand: "Near-mint with visible edge risk",
    modelBand: "800-849 condition benchmark",
    modelConfidence: 82,
    result: "matched_band",
    summary: "The detector correctly focuses on edge whitening as the material condition driver.",
    attributes: { corners: 88, edges: 74, centering: 93, surface: 86, dimensions: 98 },
    dings: [
      {
        id: "edge-left-001",
        type: "edge_wear",
        attribute: "Edges",
        location: "left edge",
        confidence: 0.81,
        materiality: "material_ding",
        bbox: [3, 34, 14, 78],
        note: "Material because the edge signal is visible and consistent along the border.",
      },
    ],
    whatItGotRight: ["Localized wear to an edge zone.", "Kept surface confidence separate from edge confidence."],
    whatItMissed: ["No official slab/cert outcome attached yet."],
    limitations: ["Dataset fixture image, not a real user-owned graded card."],
    captureQuality: {
      blur: "pass",
      glare: "pass",
      edgeVisibility: "pass",
      recommendation: "Good enough for edge evidence; add back-side photo for catalog record.",
    },
  },
  {
    id: "fixture-corner-wear-001",
    slug: "corner-wear-human-reviewed",
    title: "Corner Touch Fixture",
    game: "Pokemon-style TCG",
    finishType: "matte",
    image: "/examples/corner-wear.png",
    knownOutcome: "Human-reviewed: corner wear",
    outcomeSource: "CCV verified seed fixture v1",
    ...humanReviewedFixtureRights,
    benchmarkBand: "Strong near-mint candidate",
    modelBand: "850-899 condition benchmark",
    modelConfidence: 79,
    result: "matched_band",
    summary: "The report highlights a corner-region DING instead of over-weighting minor border texture.",
    attributes: { corners: 76, edges: 88, centering: 92, surface: 89, dimensions: 98 },
    dings: [
      {
        id: "corner-bottom-right-001",
        type: "corner_wear",
        attribute: "Corners",
        location: "bottom-right corner",
        confidence: 0.78,
        materiality: "material_ding",
        bbox: [80, 82, 98, 99],
        note: "Corner DING has visible shape interruption in the crop.",
      },
    ],
    whatItGotRight: ["Region crop made the small corner issue easier to inspect."],
    whatItMissed: ["No grade-company comparison yet."],
    limitations: ["Corner crop benchmark is synthetic/fixture-backed, not official grading calibration."],
    captureQuality: {
      blur: "pass",
      glare: "pass",
      edgeVisibility: "pass",
      recommendation: "Useful example for showing why region foveation matters.",
    },
  },
  {
    id: "fixture-scratch-001",
    slug: "scratch-human-reviewed",
    title: "Surface Scratch Fixture",
    game: "Pokemon-style TCG",
    finishType: "glossy",
    image: "/examples/scratch.png",
    knownOutcome: "Human-reviewed: visible scratch",
    outcomeSource: "CCV verified seed fixture v1",
    ...humanReviewedFixtureRights,
    benchmarkBand: "Visible surface issue",
    modelBand: "775-825 condition benchmark",
    modelConfidence: 73,
    result: "matched_band",
    summary: "The model calls a surface issue but keeps confidence below high because glossy cards need glare checks.",
    attributes: { corners: 90, edges: 86, centering: 91, surface: 68, dimensions: 98 },
    dings: [
      {
        id: "surface-scratch-001",
        type: "scratch",
        attribute: "Surface",
        location: "front upper surface",
        confidence: 0.72,
        materiality: "material_ding",
        bbox: [22, 16, 54, 28],
        note: "Visible linear surface candidate. Retake under lower glare would raise confidence.",
      },
    ],
    whatItGotRight: ["Kept scratch evidence tied to a visible crop.", "Recommended low-glare retake."],
    whatItMissed: ["Cannot separate all print lines from scratches without angled capture."],
    limitations: ["Glossy surface calls need multiple lighting angles before high confidence."],
    captureQuality: {
      blur: "pass",
      glare: "warning",
      edgeVisibility: "pass",
      recommendation: "Retake with a 15-25 degree tilt before treating as high-confidence damage.",
    },
  },
  {
    id: "fixture-holo-glare-001",
    slug: "holo-glare-false-positive",
    title: "Holo Glare False Positive",
    game: "Pokemon-style TCG",
    finishType: "holo",
    image: "/examples/holo-glare.png",
    knownOutcome: "Human-reviewed: glare_uncertain, not verified scratch",
    outcomeSource: "CCV verified seed fixture v1",
    ...humanReviewedFixtureRights,
    benchmarkBand: "Low-confidence surface estimate",
    modelBand: "Needs retake",
    modelConfidence: 46,
    result: "overcalled",
    summary: "This example is intentionally included because a single-frame model can over-call holo glare as damage.",
    attributes: { corners: 87, edges: 84, centering: 90, surface: 52, dimensions: 98 },
    dings: [
      {
        id: "glare-surface-001",
        type: "glare_uncertain",
        attribute: "Surface",
        location: "front surface glare streak",
        confidence: 0.44,
        materiality: "uncertain",
        bbox: [16, 12, 68, 30],
        note: "Not a verified DING. The correct action is a tilt retake or glare-aware reinspection.",
      },
    ],
    whatItGotRight: ["Shows low surface confidence and retake guidance."],
    whatItMissed: ["Single-frame detector may still draw a scratch-like candidate."],
    limitations: ["Holo and textured foil need multi-angle capture to be credible."],
    captureQuality: {
      blur: "pass",
      glare: "fail",
      edgeVisibility: "pass",
      recommendation: "Use premium foil scan: slow tilt left/right and compare low-glare frames.",
    },
  },
  {
    id: "fixture-crease-001",
    slug: "crease-grade-impact",
    title: "Crease Dominant DING",
    game: "Sports-style card",
    finishType: "matte",
    image: "/examples/crease.png",
    knownOutcome: "Human-reviewed: crease materially limits condition",
    outcomeSource: "CCV verified seed fixture v1",
    ...humanReviewedFixtureRights,
    benchmarkBand: "Visible condition risk",
    modelBand: "650-725 condition benchmark",
    modelConfidence: 84,
    result: "matched_band",
    summary: "A crease is treated as a dominant DING; smaller issues should not distract from the main condition driver.",
    attributes: { corners: 78, edges: 80, centering: 89, surface: 48, dimensions: 96 },
    dings: [
      {
        id: "crease-front-001",
        type: "crease",
        attribute: "Surface",
        location: "front center",
        confidence: 0.84,
        materiality: "dominant_ding",
        bbox: [24, 38, 76, 55],
        note: "Dominant because it would materially cap the condition band even if other marks were absent.",
      },
    ],
    whatItGotRight: ["Separates dominant DING from lower-impact noise."],
    whatItMissed: ["No physical bend-depth measurement from a single photo."],
    limitations: ["Crease severity needs angled light and possibly side-view evidence."],
    captureQuality: {
      blur: "pass",
      glare: "pass",
      edgeVisibility: "warning",
      recommendation: "Add angled light frame to document crease relief.",
    },
  },
  {
    id: "fixture-heavy-wear-001",
    slug: "heavy-wear-low-band",
    title: "Heavy Wear Fixture",
    game: "Vintage-style card",
    finishType: "matte",
    image: "/examples/heavy-wear.png",
    knownOutcome: "Human-reviewed: heavy wear",
    outcomeSource: "CCV verified seed fixture v1",
    ...openDingDatasetRights,
    benchmarkBand: "Visible wear / low condition band",
    modelBand: "500-650 condition benchmark",
    modelConfidence: 88,
    result: "matched_band",
    summary: "The system should not over-explain small DINGs when heavy wear dominates the evidence.",
    attributes: { corners: 52, edges: 48, centering: 86, surface: 50, dimensions: 93 },
    dings: [
      {
        id: "heavy-wear-001",
        type: "heavy_wear",
        attribute: "Edges",
        location: "multi-edge wear",
        confidence: 0.88,
        materiality: "dominant_ding",
        bbox: [2, 4, 96, 98],
        note: "Dominant DING: widespread wear limits the condition band.",
      },
    ],
    whatItGotRight: ["Prioritizes widespread material wear over tiny local marks."],
    whatItMissed: ["Does not estimate restoration or authenticity."],
    limitations: ["Condition only. No authenticity or market-value inference."],
    captureQuality: {
      blur: "pass",
      glare: "pass",
      edgeVisibility: "pass",
      recommendation: "Suitable evidence image for catalog history.",
    },
  },
];

export function outcomeBySlug(slug: string) {
  return outcomeExamples.find((example) => example.slug === slug);
}

export function provenanceLabel(provenance: OutcomeProvenance) {
  if (provenance === "gold_user_consented") return "Gold: user-consented official outcome";
  if (provenance === "silver_certified_reference") return "Silver: external certified reference";
  if (provenance === "silver_human_reviewed") return "Silver: human-reviewed fixture";
  if (provenance === "bronze_open_ding_dataset") return "Bronze: open DING dataset";
  return "Bronze: dataset fixture";
}

export const benchmarkSummary = {
  modelVersion: "ding-detector-v0",
  manifestHash: "24e62f76baf046c7d3ec83d147bbe4fb0a252b4cd06c77cd7ac13e61add28fa2",
  trainingRunId: "yolo-20260506T124111Z",
  overall: {
    precision: 0.62639,
    recall: 0.44897,
    map50: 0.46374,
    map5095: 0.27864,
  },
  cohorts: [
    { cohort: "Card box", precision: 0.93, recall: 0.91, note: "Best-supported class." },
    { cohort: "Edge wear", precision: 0.64, recall: 0.52, note: "Usable for obvious whitening; weak on dark borders." },
    { cohort: "Corner wear", precision: 0.61, recall: 0.49, note: "Needs foveated corner crops." },
    { cohort: "Scratch", precision: 0.48, recall: 0.31, note: "Glare and print texture cause false positives." },
    { cohort: "Crease / tear / hole", precision: 0.58, recall: 0.43, note: "Limited examples; high materiality when visible." },
    { cohort: "Holo / textured foil", precision: 0.39, recall: 0.28, note: "Low-confidence; premium tilt capture required." },
  ],
};
