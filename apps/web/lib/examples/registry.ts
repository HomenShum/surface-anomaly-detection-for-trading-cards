/**
 * Verified Outcome Library — the trust-onboarding dataset surfaced at /examples.
 *
 * The library has FIVE honesty tiers:
 *   • gold:        user-consented pre-submission scan + official outcome + human DINGs
 *   • silver_plus: certified reference (PSA/CGC/BGS/TAG cert page) WITH slab/label
 *                  images on file, our system pulled the cert via the public API or
 *                  via OCR on the slab photo, our model has run on the slab image
 *   • silver:      certified-reference outcome (PSA/CGC/TAG/BGS cert page) linked deeply
 *                  but no slab images on file yet (cert metadata only)
 *   • bronze:      open-licensed training image (Roboflow CC BY 4.0) with human/model
 *                  annotation, no official grade
 *   • demo:        synthetic or sample fixture — clearly labeled, not a real outcome
 *
 * Schema is intentionally explicit about what's known and what's not. Failure
 * cases (false positives, missed defects) are first-class — they're the trust
 * signal users actually weigh.
 */

export type ExampleGame = "pokemon" | "one-piece" | "riftbound" | "mtg" | "sports" | "other";

export type ExampleFinish = "matte" | "glossy" | "holo" | "textured_foil" | "etched_foil" | "unknown";

export type ExampleTier = "gold" | "silver_plus" | "silver" | "bronze" | "demo";

export type FailureMode =
  | "false_positive_glare"
  | "false_positive_pattern"
  | "false_positive_dark_border"
  | "false_negative_subtle_dent"
  | "false_negative_back_edge"
  | "low_confidence_capture"
  | "unsupported_finish";

export type ConditionBand =
  | "950-1000_gem_pristine"
  | "900-949_mint"
  | "850-899_strong_nm_mint"
  | "800-849_near_mint"
  | "700-799_visible_issues"
  | "below_700_heavy_wear";

export type ExampleDing = {
  /** Damage class — must match detector vocabulary. */
  type: "edge_wear" | "corner_wear" | "scratch" | "crease" | "surface_anomaly" | "whitening" | "print_line" | "glare_uncertain";
  /** Bbox in image-space percent: [x1, y1, x2, y2], 0..100. */
  bbox: [number, number, number, number];
  /** UI severity — only display, not authoritative. */
  severity: "minor" | "moderate" | "major";
  /**
   * Grade-impact verdict. TAG's principle: a "DING" is a defect that *materially*
   * affected the grade. Visible flaws that don't affect the grade are not DINGs.
   * We carry this distinction here so the UI can de-emphasize cosmetic noise.
   */
  materialToGrade: boolean;
  note: string;
  /** Source of the annotation: human review, model output, or both. */
  source: "human" | "model" | "human+model";
};

export type ExampleKnownOutcome = {
  /** Grading authority. */
  grader: "PSA" | "BGS" | "CGC" | "TAG" | "human-reviewer" | "none";
  /** Cert number when grader is a public service. */
  certNumber?: string;
  /** Deep-link to the cert verification page. NEVER a cached image URL. */
  certUrl?: string;
  /** Human-readable grade label, e.g. "GEM MT 10" or "MINT 9". */
  grade?: string;
  /** Numeric grade where applicable (1–10 industry scale or 0–1000 TAG-style). */
  numericGrade?: number;
  /** Maps grade into our internal condition band. */
  band: ConditionBand;
  /** Optional sub-grades, BGS-style. */
  subGrades?: { centering?: number; corners?: number; edges?: number; surface?: number };
};

export type ExampleModelPrediction = {
  /** Our internal benchmark score (0–1000) — analogous to TAG Score but our own. */
  benchmarkScore: number;
  /** Our internal band label for that score. */
  band: ConditionBand;
  /** 0..1, agent confidence. */
  confidence: number;
  /** Did we land in the same band as the official outcome? */
  matchedKnownOutcome: boolean | null;
  /** What the model called out. */
  notes: string;
  /** Model version that ran. */
  modelVersion: string;
};

export type ExampleProvenance = {
  identityImageUrl: string | null;
  identityImageSource:
    | "pokemon-tcg-api"
    | "roboflow-cc-by-4.0"
    | "synthetic-placeholder"
    | "user-consented";
  identityImageAttribution: string;
  /** External link for the official grader's record (deep-link only). */
  externalReferenceUrl?: string;
  externalReferenceLabel?: string;
};

export type ExampleOutcome = {
  id: string;
  slug: string;
  title: string;
  game: ExampleGame;
  setName?: string;
  cardNumber?: string;
  finish: ExampleFinish;
  tier: ExampleTier;
  trustBadgeReason: string;
  provenance: ExampleProvenance;
  dings: ExampleDing[];
  knownOutcome?: ExampleKnownOutcome;
  ourPrediction: ExampleModelPrediction;
  failureMode?: FailureMode;
  failureNote?: string;
  whyThisGradeNotHigher?: string[];
  /** Tags for filter UI. */
  tags: string[];
  createdAt: string;
};

export type ExampleRights = {
  hasOfficialGrade: boolean;
  hasDingLabels: boolean;
  useForTraining: boolean;
  useForPublicExample: boolean;
  storeImagesLocally: boolean;
  usageRights: string;
};

const DISCLAIMER =
  "Not an official grade. Not legal proof. AI-assisted condition estimate against open or certified-reference inputs.";

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
    trainingUse: "No training or local cert-image cache without permission",
    trust: "High outcome trust, limited DING truth",
  },
  {
    tier: "Bronze",
    source: "Open DING datasets and human-reviewed fixtures",
    publicUse: "Annotated detector examples with attribution",
    trainingUse: "Allowed only when the source license permits it",
    trust: "Good detector bootstrap, not official grading truth",
  },
] as const;

export function exampleRights(example: ExampleOutcome): ExampleRights {
  const isCertifiedReference =
    (example.tier === "silver" || example.tier === "silver_plus") && Boolean(example.knownOutcome?.certUrl);
  const isOpenDataset = example.tier === "bronze" && example.provenance.identityImageSource === "roboflow-cc-by-4.0";
  const isGold = example.tier === "gold";

  if (isCertifiedReference) {
    return {
      hasOfficialGrade: true,
      hasDingLabels: example.dings.length > 0,
      useForTraining: false,
      useForPublicExample: true,
      storeImagesLocally: example.tier === "silver_plus" && Boolean(example.provenance.identityImageUrl?.startsWith("/")),
      usageRights:
        "External certified reference only. Deep-link the cert record; do not cache cert images or train on them without explicit permission.",
    };
  }

  if (isOpenDataset) {
    return {
      hasOfficialGrade: false,
      hasDingLabels: example.dings.length > 0,
      useForTraining: true,
      useForPublicExample: true,
      storeImagesLocally: Boolean(example.provenance.identityImageUrl?.startsWith("/")),
      usageRights:
        "Open DING dataset fixture. Use for detector training/evaluation only when attribution and source license requirements are satisfied.",
    };
  }

  if (isGold) {
    return {
      hasOfficialGrade: true,
      hasDingLabels: example.dings.length > 0,
      useForTraining: true,
      useForPublicExample: true,
      storeImagesLocally: true,
      usageRights: "User-consented gold record. Public display and training require explicit user opt-in.",
    };
  }

  return {
    hasOfficialGrade: false,
    hasDingLabels: example.dings.length > 0,
    useForTraining: false,
    useForPublicExample: true,
    storeImagesLocally: Boolean(example.provenance.identityImageUrl?.startsWith("/")),
    usageRights: "Demo or synthetic fixture. Use for product explanation and QA, not model-quality claims.",
  };
}

const rawExampleOutcomes: ExampleOutcome[] = [
  // ─── SILVER: PSA cert reference + Pokémon TCG API identity art ──────────
  {
    id: "ex_pokemon_mew_ex_paldean_fates",
    slug: "pokemon-mew-ex-paldean-fates-gem-10",
    title: "Mew ex — Special Illustration Rare (Paldean Fates)",
    game: "pokemon",
    setName: "Paldean Fates",
    cardNumber: "232/091",
    finish: "holo",
    tier: "silver",
    trustBadgeReason:
      "Official PSA Gem Mint 10 outcome (cert 101964593). Card identity art via Pokémon TCG API. DINGs annotated by us against the public cert — not from PSA's private grading data.",
    provenance: {
      identityImageUrl: "https://images.pokemontcg.io/sv4pt5/232_hires.png",
      identityImageSource: "pokemon-tcg-api",
      identityImageAttribution: "Pokémon TCG API · ©2024 Pokémon / Creatures / Game Freak",
      externalReferenceUrl: "https://www.psacard.com/cert/101964593",
      externalReferenceLabel: "PSA Cert 101964593",
    },
    dings: [
      // No material DINGs on a clean Gem 10. We still document a glare-uncertain spot
      // for transparency: it visibly exists but doesn't move the grade.
      {
        type: "glare_uncertain",
        bbox: [42, 36, 50, 44],
        severity: "minor",
        materialToGrade: false,
        note: "Single-frame glare on the holographic surface. Not a defect — an imaging artifact.",
        source: "model",
      },
    ],
    knownOutcome: {
      grader: "PSA",
      certNumber: "101964593",
      certUrl: "https://www.psacard.com/cert/101964593",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 970,
      band: "950-1000_gem_pristine",
      confidence: 0.81,
      matchedKnownOutcome: true,
      notes:
        "No material DINGs. Visible glare on holo surface flagged as glare_uncertain — does not move the band. Holo finish + low surface_score requires retake to confirm absence of subtle scratches.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "We don't have a separate Pristine 10 (TAG 990–1000) tier yet; Gem 10 is our top band.",
      "Tilt-frame retake would lift confidence from 0.81 toward 0.92.",
    ],
    tags: ["pokemon", "holo", "sar", "gem-10", "matched"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_pokemon_giratina_crown_zenith",
    slug: "pokemon-giratina-vstar-crown-zenith-gem-10",
    title: "Giratina VSTAR — Crown Zenith Galarian Gallery",
    game: "pokemon",
    setName: "Crown Zenith Galarian Gallery",
    cardNumber: "GG70",
    finish: "holo",
    tier: "silver",
    trustBadgeReason: "Official PSA Gem Mint 10 outcome (cert 101283999).",
    provenance: {
      identityImageUrl: "https://images.pokemontcg.io/swsh12pt5gg/GG70_hires.png",
      identityImageSource: "pokemon-tcg-api",
      identityImageAttribution: "Pokémon TCG API · ©2023 Pokémon / Creatures / Game Freak",
      externalReferenceUrl: "https://www.psacard.com/cert/101283999",
      externalReferenceLabel: "PSA Cert 101283999",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "101283999",
      certUrl: "https://www.psacard.com/cert/101283999",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 968,
      band: "950-1000_gem_pristine",
      confidence: 0.84,
      matchedKnownOutcome: true,
      notes: "Clean full-art with no detected DINGs at default thresholds.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["pokemon", "holo", "secret-rare", "gem-10", "matched"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_pokemon_carmine_sar",
    slug: "pokemon-carmine-sar-gem-10",
    title: "Carmine - Special Art Rare",
    game: "pokemon",
    setName: "Japanese Special Art Rare",
    finish: "textured_foil",
    tier: "silver",
    trustBadgeReason: "Official PSA Gem Mint 10 outcome (cert 141562296). External certified reference only.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "No local cert image cached. View the PSA cert page.",
      externalReferenceUrl: "https://www.psacard.com/cert/141562296",
      externalReferenceLabel: "PSA Cert 141562296",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "141562296",
      certUrl: "https://www.psacard.com/cert/141562296",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "950-1000_gem_pristine",
      confidence: 0,
      matchedKnownOutcome: null,
      notes: "External certified reference only. No local detector run is shown.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "PSA does not expose DING-level notes in this app view.",
      "A CCV gold record would require a user-consented raw scan plus later official result.",
    ],
    tags: ["pokemon", "textured-foil", "sar", "gem-10", "cert-reference"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_one_piece_ace_alt_art_mint_9",
    slug: "one-piece-portgas-ace-alt-art-mint-9",
    title: "Portgas D. Ace — Special Alternate Art",
    game: "one-piece",
    setName: "OP Promos / Special Alt Art",
    finish: "holo",
    tier: "silver",
    trustBadgeReason:
      "Official PSA Mint 9 outcome (cert 130349493). Critical non-10 example — trust requires we show cards that aren't perfect.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "No public CDN image available — view on PSA cert page.",
      externalReferenceUrl: "https://www.psacard.com/cert/130349493/psa",
      externalReferenceLabel: "PSA Cert 130349493",
    },
    dings: [
      {
        type: "corner_wear",
        bbox: [82, 4, 96, 14],
        severity: "minor",
        materialToGrade: true,
        note: "Top-right corner shows mild whitening visible on a Mint 9 but not a Gem 10.",
        source: "human",
      },
      {
        type: "edge_wear",
        bbox: [94, 18, 100, 72],
        severity: "minor",
        materialToGrade: true,
        note: "Faint right-edge nick — material to band, not severe.",
        source: "human",
      },
    ],
    knownOutcome: {
      grader: "PSA",
      certNumber: "130349493",
      certUrl: "https://www.psacard.com/cert/130349493/psa",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 915,
      band: "900-949_mint",
      confidence: 0.74,
      matchedKnownOutcome: true,
      notes: "Detected mild corner + edge wear matches a Mint 9 band. Did NOT call surface scratches.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Top-right corner whitening visible at zoom — material to grade.",
      "Right-edge nick reduces edge_score below the Gem threshold.",
    ],
    tags: ["one-piece", "holo", "alt-art", "mint-9", "matched", "non-gem"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_one_piece_luffy_manga_alt",
    slug: "one-piece-luffy-manga-alt-art-gem-10",
    title: "Monkey D. Luffy — Manga Alternate Art",
    game: "one-piece",
    setName: "OP Promos / Manga Alt Art",
    finish: "textured_foil",
    tier: "silver",
    trustBadgeReason:
      "Official PSA Gem Mint 10 outcome (cert 146379905). Premium manga/textured reference — useful for showing an honest 'unsupported finish' warning.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "No public CDN image available — view on PSA cert page.",
      externalReferenceUrl: "https://www.psacard.com/cert/146379905/psa",
      externalReferenceLabel: "PSA Cert 146379905",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "146379905",
      certUrl: "https://www.psacard.com/cert/146379905/psa",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 940,
      band: "900-949_mint",
      confidence: 0.55,
      matchedKnownOutcome: false,
      notes:
        "Textured foil triggers our 'unsupported finish — low confidence' rail. We under-graded by one band. Honest signal: our detector wasn't trained on textured manga foil at scale.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Detector calls textured foil pattern as possible surface anomaly with low confidence.",
      "We need user-consented gold examples on textured manga foil to lift this band.",
    ],
    failureMode: "unsupported_finish",
    failureNote: "Textured manga foil — current model misclassifies pattern as surface noise.",
    tags: ["one-piece", "textured-foil", "alt-art", "gem-10", "mismatched", "unsupported-finish"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_riftbound_ahri_alt",
    slug: "riftbound-ahri-alt-art-gem-10",
    title: "Ahri — Riftbound Alternate Art",
    game: "riftbound",
    setName: "Riftbound (League of Legends)",
    finish: "holo",
    tier: "silver",
    trustBadgeReason: "Official PSA Gem Mint 10 outcome (cert 141265943). Riftbound support proof.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "Riftbound launched 2024; no public CDN. View on PSA.",
      externalReferenceUrl: "https://www.psacard.com/cert/141265943/psa",
      externalReferenceLabel: "PSA Cert 141265943",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "141265943",
      certUrl: "https://www.psacard.com/cert/141265943/psa",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 955,
      band: "950-1000_gem_pristine",
      confidence: 0.62,
      matchedKnownOutcome: true,
      notes: "Confidence is honestly capped — Riftbound is brand-new, we have minimal training fixtures for the finish.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["riftbound", "holo", "alt-art", "gem-10", "matched", "low-coverage"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_riftbound_jinx_signature",
    slug: "riftbound-jinx-signature-overnumber-gem-10",
    title: "Jinx — Signature Overnumber",
    game: "riftbound",
    setName: "Riftbound Signature",
    finish: "etched_foil",
    tier: "silver",
    trustBadgeReason: "Official PSA Gem Mint 10 outcome (cert 137279140).",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "No public CDN — view on PSA cert page.",
      externalReferenceUrl: "https://www.psacard.com/cert/137279140/psa",
      externalReferenceLabel: "PSA Cert 137279140",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "137279140",
      certUrl: "https://www.psacard.com/cert/137279140/psa",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 942,
      band: "900-949_mint",
      confidence: 0.51,
      matchedKnownOutcome: false,
      notes:
        "Etched foil → we treat as 'unsupported finish'. Honest under-grade. Need a signature/etched-foil benchmark pack.",
      modelVersion: "ding-detector-v0",
    },
    failureMode: "unsupported_finish",
    failureNote: "Etched foil — current model lacks training data for this finish.",
    tags: ["riftbound", "etched-foil", "signature", "gem-10", "mismatched", "unsupported-finish"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_pokemon_pikachu_shiny",
    slug: "pokemon-pikachu-shiny-rare-gem-10",
    title: "Pikachu — Shiny Rare",
    game: "pokemon",
    setName: "Various sets",
    finish: "holo",
    tier: "silver",
    trustBadgeReason: "Official PSA Gem Mint 10 outcome (cert 131515603).",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "Multiple printings — view PSA cert for canonical art.",
      externalReferenceUrl: "https://www.psacard.com/cert/131515603",
      externalReferenceLabel: "PSA Cert 131515603",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "131515603",
      certUrl: "https://www.psacard.com/cert/131515603",
      grade: "GEM MT 10",
      numericGrade: 10,
      band: "950-1000_gem_pristine",
    },
    ourPrediction: {
      benchmarkScore: 962,
      band: "950-1000_gem_pristine",
      confidence: 0.78,
      matchedKnownOutcome: true,
      notes: "Clean. No material DINGs.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["pokemon", "holo", "shiny-rare", "gem-10", "matched"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },

  // ─── BRONZE: open Roboflow images with attribution ─────────────────────
  {
    id: "ex_bronze_tauros_real_ding",
    slug: "roboflow-tauros-real-ding-annotations",
    title: "Tauros real-card DING annotations",
    game: "pokemon",
    setName: "Demo sample card",
    cardNumber: "47/130",
    finish: "holo",
    tier: "bronze",
    trustBadgeReason:
      "Real card image used for vendor-pilot trust demos. DING annotations are CCV/open-dataset QA labels, not official PSA/TAG/CGC/BGS rationale.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "roboflow-cc-by-4.0",
      identityImageAttribution: "Roboflow-style real card fixture bundled with CCV demo assets.",
      externalReferenceUrl: undefined,
      externalReferenceLabel: "Local real-card fixture",
    },
    dings: [
      {
        type: "edge_wear",
        bbox: [0, 0, 98, 9],
        severity: "moderate",
        materialToGrade: true,
        note: "Visible whitening and border wear along the top edge of the real card image.",
        source: "human+model",
      },
      {
        type: "corner_wear",
        bbox: [0, 86, 10, 100],
        severity: "moderate",
        materialToGrade: true,
        note: "Corner and lower-edge wear are visible near the lower-left card boundary.",
        source: "human+model",
      },
      {
        type: "edge_wear",
        bbox: [91, 10, 100, 88],
        severity: "minor",
        materialToGrade: true,
        note: "Right edge shows visible whitening consistent with edge-wear review.",
        source: "human+model",
      },
    ],
    ourPrediction: {
      benchmarkScore: 760,
      band: "700-799_visible_issues",
      confidence: 0.81,
      matchedKnownOutcome: null,
      notes:
        "Real-card fixture with visible edge and corner wear. Useful for demonstrating labeled DING overlays; not an official graded outcome.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Multiple visible edge/corner DINGs cap the condition band in our benchmark.",
      "No official cert outcome is attached, so this remains a Bronze detector/example fixture.",
      "Raw front/back plus later official result and human DING review would be required for Gold.",
    ],
    tags: ["open-data", "real-card", "edge-wear", "corner-wear", "pokemon", "vendor-pilot"],
    createdAt: "2026-05-07T00:00:00.000Z",
  },
  {
    id: "ex_bronze_corner_wear_real",
    slug: "open-corner-wear-real-card",
    title: "Corner wear (Roboflow Card Condition v0)",
    game: "other",
    finish: "matte",
    tier: "bronze",
    trustBadgeReason: "Open CC BY 4.0 image with bbox annotations from Roboflow Card Condition dataset (Fes Acatlan).",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "roboflow-cc-by-4.0",
      identityImageAttribution: "Roboflow Universe · Fes Acatlan · CC BY 4.0",
      externalReferenceUrl: "https://universe.roboflow.com/fes-acatlan/card-condition-29wwd",
      externalReferenceLabel: "Roboflow source",
    },
    dings: [
      {
        type: "corner_wear",
        bbox: [3, 2, 18, 14],
        severity: "moderate",
        materialToGrade: true,
        note: "Top-left corner whitening clearly visible. Annotation provenance: dataset author.",
        source: "human",
      },
    ],
    ourPrediction: {
      benchmarkScore: 880,
      band: "850-899_strong_nm_mint",
      confidence: 0.71,
      matchedKnownOutcome: null,
      notes: "Detected corner wear matches dataset annotation.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["open-data", "corner-wear", "matte", "training-fixture"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_bronze_edge_whitening_real",
    slug: "open-edge-whitening-real-card",
    title: "Edge whitening (Roboflow Card Condition v0)",
    game: "other",
    finish: "matte",
    tier: "bronze",
    trustBadgeReason: "Open CC BY 4.0 image with bbox annotations from Roboflow.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "roboflow-cc-by-4.0",
      identityImageAttribution: "Roboflow Universe · Fes Acatlan · CC BY 4.0",
      externalReferenceUrl: "https://universe.roboflow.com/fes-acatlan/card-condition-29wwd",
      externalReferenceLabel: "Roboflow source",
    },
    dings: [
      {
        type: "edge_wear",
        bbox: [94, 22, 100, 78],
        severity: "moderate",
        materialToGrade: true,
        note: "Persistent right-edge whitening — material defect.",
        source: "human",
      },
    ],
    ourPrediction: {
      benchmarkScore: 870,
      band: "850-899_strong_nm_mint",
      confidence: 0.69,
      matchedKnownOutcome: null,
      notes: "Detector lands the edge bbox within tolerance of the human annotation.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["open-data", "edge-wear", "matte", "training-fixture"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_bronze_scratch_real",
    slug: "open-scratch-pokemon-surface",
    title: "Surface scratch (Roboflow Pokemon Surface Damage)",
    game: "pokemon",
    finish: "holo",
    tier: "bronze",
    trustBadgeReason: "Open CC BY 4.0 image with annotation from Roboflow Pokémon Surface Damage Detection.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "roboflow-cc-by-4.0",
      identityImageAttribution: "Roboflow Universe · PokemonFrontDamagedetection · CC BY 4.0",
      externalReferenceUrl: "https://universe.roboflow.com/pokemonfrontdamagedetection/pokemon-surface-damage-detection",
      externalReferenceLabel: "Roboflow source",
    },
    dings: [
      {
        type: "scratch",
        bbox: [38, 30, 56, 42],
        severity: "moderate",
        materialToGrade: true,
        note: "Surface scratch under low-angle light. Visible on tilt-frame, not on direct-light frame.",
        source: "human",
      },
    ],
    ourPrediction: {
      benchmarkScore: 820,
      band: "800-849_near_mint",
      confidence: 0.66,
      matchedKnownOutcome: null,
      notes: "Detector flags scratch with moderate confidence. Under-confident on holo without tilt frame.",
      modelVersion: "ding-detector-v0",
    },
    tags: ["open-data", "scratch", "holo", "training-fixture"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },

  // ─── DEMO / SYNTHETIC FAILURE CASES ────────────────────────────────────
  {
    id: "ex_demo_holo_glare_false_positive",
    slug: "demo-holo-glare-false-positive",
    title: "Holo glare false positive (synthetic)",
    game: "pokemon",
    finish: "holo",
    tier: "demo",
    trustBadgeReason:
      "Synthetic example — illustrates a known failure mode where holo glare is misread as a surface scratch.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "Synthetic — Card Condition Vault demo fixture.",
    },
    dings: [
      {
        type: "glare_uncertain",
        bbox: [42, 32, 58, 48],
        severity: "minor",
        materialToGrade: false,
        note:
          "Single-frame holo glare. Our naive baseline calls this scratch with 0.62 confidence; tilt-frame retake confirms it is glare and not damage. Promoted skill `holo_glare_reinspect_v1` activates here.",
        source: "model",
      },
    ],
    ourPrediction: {
      benchmarkScore: 750,
      band: "700-799_visible_issues",
      confidence: 0.45,
      matchedKnownOutcome: null,
      notes:
        "Without the holo_glare_reinspect_v1 skill, model would call surface scratch at 0.62. With the skill it correctly defers to glare_uncertain.",
      modelVersion: "ding-detector-v0",
    },
    failureMode: "false_positive_glare",
    failureNote: "Glare on holo surface mistaken for scratch. Skill registry intercepts this case.",
    tags: ["demo", "holo", "false-positive", "glare", "skill-active"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_demo_dark_border_false_positive",
    slug: "demo-dark-border-edge-whitening-false-positive",
    title: "Dark border edge-whitening false positive (synthetic)",
    game: "other",
    finish: "matte",
    tier: "demo",
    trustBadgeReason: "Synthetic example — illustrates the dark-border halo failure mode.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "Synthetic — Card Condition Vault demo fixture.",
    },
    dings: [
      {
        type: "whitening",
        bbox: [0, 28, 6, 72],
        severity: "minor",
        materialToGrade: false,
        note:
          "Bright pixel halo on a dark-border card. Naive detector flags as edge whitening. Local-context check (proposed `dark_border_edge_filter_v1`) downgrades to glare_uncertain.",
        source: "model",
      },
    ],
    ourPrediction: {
      benchmarkScore: 880,
      band: "850-899_strong_nm_mint",
      confidence: 0.42,
      matchedKnownOutcome: null,
      notes: "Without the dark-border filter, baseline reports edge_wear with 0.55 confidence. Filter resolves to non-material.",
      modelVersion: "ding-detector-v0",
    },
    failureMode: "false_positive_dark_border",
    failureNote: "Dark borders create contrast halos that look like whitening.",
    tags: ["demo", "matte", "false-positive", "dark-border"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },

  // ─── SILVER: External certified references (deep-link only, no scan attached yet) ──
  // These two records anchor the trust layer with real official records that
  // arrived via friend-shared links. They show the skeleton of an example
  // (cert link + grader + slug) BEFORE we have the raw pre-submission scan +
  // human DING review. The detail page surfaces a CTA: "Add raw pre-submission
  // scan to upgrade this example to Gold."
  {
    id: "ex_tag_j6994233",
    slug: "tag-j6994233",
    title: "TAG card J6994233 (DIG report reference)",
    game: "other",
    finish: "unknown",
    tier: "silver",
    trustBadgeReason:
      "External TAG DIG-style certified reference. The official TAG report (linked) anchors the outcome. We did NOT scrape TAG data — this entry exists to deep-link the public report and document our DING-mapping convention.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution:
        "TAG DIG report — view on taggrading.com. We do not cache or scrape TAG images. Report convention only.",
      externalReferenceUrl: "https://my.taggrading.com/card/J6994233",
      externalReferenceLabel: "TAG DIG J6994233",
    },
    dings: [],
    knownOutcome: {
      grader: "TAG",
      certNumber: "J6994233",
      certUrl: "https://my.taggrading.com/card/J6994233",
      grade: "see TAG DIG report",
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "No raw pre-submission scan attached yet. We treat this as a Silver reference for report convention (TAG DING vocabulary, Corner/Edge/Surface attribute breakdown) only. To upgrade to Gold: attach a user-consented raw scan plus the TAG DIG outcome plus a human DING review.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "We don't have raw pre-submission scan bytes yet — only the TAG cert link.",
      "TAG DIG provides DING-level transparency at their detail page; mapping their DING vocabulary to our ontology happens at view time.",
      "Add front + back scans + tilt frame to upgrade this record to Gold-tier with a real model run.",
    ],
    tags: ["silver", "tag", "certified-reference", "needs-raw-scan", "dig-report"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_154378339",
    slug: "psa-154378339",
    title: "PSA 154378339 — 2025 Pokémon JP SV11B Black Bolt Zekrom ex #174 — NM-MT 8",
    game: "pokemon",
    setName: "SV11B Black Bolt (Japanese)",
    cardNumber: "174",
    finish: "holo",
    tier: "silver_plus",
    trustBadgeReason:
      "Friend-provided PSA NM-MT 8 cert with slab photos on file. Cert resolves to PSA verification page; metadata user-confirmed via screenshot. We have not yet run our model against the slab image — the cert-reference eval is the next pipeline step.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution:
        "PSA cert verification page — psacard.com. Slab photos on file with us under friend consent; not cached publicly.",
      externalReferenceUrl: "https://www.psacard.com/cert/154378339",
      externalReferenceLabel: "PSA Cert 154378339",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "154378339",
      certUrl: "https://www.psacard.com/cert/154378339",
      grade: "NM-MT 8",
      numericGrade: 8,
      band: "800-849_near_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "800-849_near_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Slab image awaiting cert-reference eval pass. Once eval runs, this entry shows our predicted band + DING annotations alongside the PSA NM-MT 8 outcome.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not been run against this slab image yet.",
      "Slab geometry (case glare + label) requires guided sub-frame extraction before DING detection — see the Methods board.",
      "Raw pre-submission scan from the original submitter is required to promote this record to Gold tier.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon-jp", "near-mint-8", "needs-cert-eval"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_148901886",
    slug: "psa-148901886",
    title: "PSA 148901886 — Tyranitar V Battle Styles #155 — MINT 9",
    game: "pokemon",
    setName: "Battle Styles",
    cardNumber: "155",
    finish: "holo",
    tier: "silver_plus",
    trustBadgeReason:
      "Friend-submitted PSA MINT 9 with slab photos on file. Card identity transcribed from angled friend photo; will be re-verified through PSA's API once credentials are configured.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com. Slab photos on file under friend consent.",
      externalReferenceUrl: "https://www.psacard.com/cert/148901886",
      externalReferenceLabel: "PSA Cert 148901886",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "148901886",
      certUrl: "https://www.psacard.com/cert/148901886",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Awaiting cert-reference eval run. PSA API verification pending; identity is friend-photo unverified for now.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run against the slab image yet.",
      "Identity provenance is friend-photo unverified — needs PSA API check before publishing canonical metadata.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "mint-9", "needs-cert-eval"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_142558459",
    slug: "psa-142558459",
    title: "PSA 142558459 — Tyranitar V Battle Styles #155 — MINT 9",
    game: "pokemon",
    setName: "Battle Styles",
    cardNumber: "155",
    finish: "holo",
    tier: "silver_plus",
    trustBadgeReason:
      "Second PSA MINT 9 of the same Tyranitar V — useful for measuring our scan-to-scan consistency across two graded cards with the same outcome.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/142558459",
      externalReferenceLabel: "PSA Cert 142558459",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "142558459",
      certUrl: "https://www.psacard.com/cert/142558459",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Pair-cert with PSA 148901886 — same identity, same outcome. Cert-reference eval should land in same band with high agreement.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet.",
      "Friend-photo provenance — re-verify through PSA API.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "mint-9", "consistency-pair"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_142558463",
    slug: "psa-142558463",
    title: "PSA 142558463 — M Ltrs/Zpds/Artcn.GX HF Elite Trainer Box Full Art — MINT 9",
    game: "pokemon",
    setName: "Hidden Fates Elite Trainer Box (Full Art)",
    finish: "holo",
    tier: "silver_plus",
    trustBadgeReason:
      "Hidden Fates Elite Trainer Box Full Art — premium reflective finish that's a known stress test for our DING detector under glare.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/142558463",
      externalReferenceLabel: "PSA Cert 142558463",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "142558463",
      certUrl: "https://www.psacard.com/cert/142558463",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Holo full-art under PSA slab — expect false-positive glare on first eval pass. Self-correction loop should propose tilt-frame skill.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet — premium reflective stress case.",
      "Identity needs PSA API confirmation.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "mint-9", "holo-stress-case"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_148901879",
    slug: "psa-148901879",
    title: "PSA 148901879 — Iris's Fighting Spirit Special Art Rare #247 — MINT 9",
    game: "pokemon",
    setName: "Iris's Fighting Spirit",
    cardNumber: "247",
    finish: "etched_foil",
    tier: "silver_plus",
    trustBadgeReason:
      "Special Art Rare with etched foil — useful for measuring detector behaviour on textured premium finishes.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/148901879",
      externalReferenceLabel: "PSA Cert 148901879",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "148901879",
      certUrl: "https://www.psacard.com/cert/148901879",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Etched-foil Special Art Rare — first eval will surface whether our pattern-detector can separate intentional etching from surface anomalies.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet.",
      "Etched-foil pattern likely needs a finish-specific skill before we trust the prediction.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "mint-9", "etched-foil"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_152528467",
    slug: "psa-152528467",
    title: "PSA 152528467 — Reshiram ex Special Illustration Rare #166 — MINT 9",
    game: "pokemon",
    cardNumber: "166",
    finish: "textured_foil",
    tier: "silver_plus",
    trustBadgeReason:
      "Reshiram ex Special Illustration Rare — textured-foil premium finish that is a known false-positive trap.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/152528467",
      externalReferenceLabel: "PSA Cert 152528467",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "152528467",
      certUrl: "https://www.psacard.com/cert/152528467",
      grade: "MINT 9",
      numericGrade: 9,
      band: "900-949_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "900-949_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Textured-foil SIR — eval will confirm whether tilt-frame normalization is needed before DING detection on this finish.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet.",
      "Textured-foil finish historically false-positive on scratch detector.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "mint-9", "textured-foil"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_142558471",
    slug: "psa-142558471",
    title: "PSA 142558471 — Meowth #07 — NM-MT 8",
    game: "pokemon",
    cardNumber: "07",
    finish: "glossy",
    tier: "silver_plus",
    trustBadgeReason:
      "PSA NM-MT 8 — useful as the lower-band anchor: we expect visible material DINGs that the detector should flag.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/142558471",
      externalReferenceLabel: "PSA Cert 142558471",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "142558471",
      certUrl: "https://www.psacard.com/cert/142558471",
      grade: "NM-MT 8",
      numericGrade: 8,
      band: "800-849_near_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "800-849_near_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "NM-MT 8 anchor — eval should land in 800-849 band and surface specific DINGs that justify the band ceiling.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet.",
      "Lower-band anchor — used to test that the detector actually produces material DINGs at the NM-MT 8 level.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "nm-mt-8", "lower-band-anchor"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
  {
    id: "ex_psa_139091062",
    slug: "psa-139091062",
    title: "PSA 139091062 — Bulbasaur Enhanced BSTR Box Topper #133 — NM-MT 8",
    game: "pokemon",
    setName: "Brilliant Stars Box Topper",
    cardNumber: "133",
    finish: "matte",
    tier: "silver_plus",
    trustBadgeReason:
      "Box-topper card stock with non-standard finish — useful for testing detector robustness across promo/oversized stock.",
    provenance: {
      identityImageUrl: null,
      identityImageSource: "synthetic-placeholder",
      identityImageAttribution: "PSA cert page — psacard.com.",
      externalReferenceUrl: "https://www.psacard.com/cert/139091062",
      externalReferenceLabel: "PSA Cert 139091062",
    },
    dings: [],
    knownOutcome: {
      grader: "PSA",
      certNumber: "139091062",
      certUrl: "https://www.psacard.com/cert/139091062",
      grade: "NM-MT 8",
      numericGrade: 8,
      band: "800-849_near_mint",
    },
    ourPrediction: {
      benchmarkScore: 0,
      band: "800-849_near_mint",
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Box-topper finish + dimensions are off-distribution; expect lower confidence and the agent to flag uncertainty.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Cert-reference eval has not run yet.",
      "Off-distribution stock dimension may require segmentation tweak before band call.",
    ],
    tags: ["silver_plus", "psa", "certified-reference", "pokemon", "nm-mt-8", "box-topper"],
    createdAt: "2026-05-06T00:00:00.000Z",
  },
];

const localImageBySlug: Record<string, string> = {
  "roboflow-tauros-real-ding-annotations": "/demo/sample-cards/roboflow-tauros-real-card.jpg",
  "open-corner-wear-real-card": "/examples/corner-wear.png",
  "open-edge-whitening-real-card": "/examples/edge-wear.png",
  "open-scratch-pokemon-surface": "/examples/scratch.png",
  "demo-holo-glare-false-positive": "/examples/holo-glare.png",
  "demo-dark-border-edge-whitening-false-positive": "/examples/edge-wear.png",
  "one-piece-luffy-manga-alt-art-gem-10": "/examples/surface-contamination.png",
  "riftbound-jinx-signature-overnumber-gem-10": "/examples/verified-scratch.png",
};

function applyExampleTrustRules(example: ExampleOutcome): ExampleOutcome {
  const isPlainSilverCertRef = example.tier === "silver" && Boolean(example.knownOutcome?.certUrl);
  const isSilverPlusCertRef = example.tier === "silver_plus" && Boolean(example.knownOutcome?.certUrl);
  const localImage = localImageBySlug[example.slug];

  if (isPlainSilverCertRef) {
    return {
      ...example,
      trustBadgeReason:
        `${example.knownOutcome?.grader ?? "Certified"} ${example.knownOutcome?.grade ?? "certified"} outcome` +
        `${example.knownOutcome?.certNumber ? ` (cert ${example.knownOutcome.certNumber})` : ""}. ` +
        "External certified reference only; no cert images are cached and no DING-level grader notes are implied.",
      dings: [],
      ourPrediction: {
        ...example.ourPrediction,
        benchmarkScore: 0,
        confidence: 0,
        matchedKnownOutcome: null,
        notes:
          "External certified reference only. This record anchors a known outcome, but it is not a local detector run or training image.",
      },
      whyThisGradeNotHigher: [
        "The grading company does not expose DING-level notes in this app view.",
        "A Gold CCV record needs a user-consented raw scan, later official result, and human DING review.",
      ],
    };
  }

  if (isSilverPlusCertRef) {
    const hasLocalPrediction =
      example.ourPrediction.confidence > 0 ||
      example.ourPrediction.benchmarkScore > 0 ||
      example.ourPrediction.matchedKnownOutcome !== null;
    return {
      ...example,
      trustBadgeReason:
        `${example.knownOutcome?.grader ?? "Certified"} ${example.knownOutcome?.grade ?? "certified"} outcome` +
        `${example.knownOutcome?.certNumber ? ` (cert ${example.knownOutcome.certNumber})` : ""}. ` +
        (hasLocalPrediction
          ? "Silver+ certified reference with a local model/eval output attached. "
          : "Silver+ certified reference queued for local slab/raw image inference; no model proof is shown yet. ") +
        "Used for evaluation and trust onboarding, not training unless explicit permission exists.",
    };
  }

  if (isSilverPlusCertRef) {
    // Silver+ keeps prediction + DING data (we DID run on the slab image).
    // We just rewrite the trust copy to make the Silver+ provenance explicit.
    return {
      ...example,
      trustBadgeReason:
        `${example.knownOutcome?.grader ?? "Certified"} ${example.knownOutcome?.grade ?? "certified"} outcome` +
        `${example.knownOutcome?.certNumber ? ` (cert ${example.knownOutcome.certNumber})` : ""}. ` +
        "Silver+ certified reference: cert + slab image on file, our model has run on the slab image. " +
        "Slab images are NOT cached — only metadata + model output. Used for evaluation, not training.",
    };
  }

  if (localImage) {
    return {
      ...example,
      provenance: {
        ...example.provenance,
        identityImageUrl: localImage,
      },
    };
  }

  return example;
}

export const exampleOutcomes: ExampleOutcome[] = rawExampleOutcomes.map(applyExampleTrustRules);

export const conditionLadder: Array<{ band: ConditionBand; label: string; range: string; gist: string }> = [
  { band: "950-1000_gem_pristine", label: "Gem / Pristine candidate", range: "950–1000", gist: "Equivalent to PSA 10 / TAG Gem-Pristine bands. Effectively no material DINGs." },
  { band: "900-949_mint", label: "Mint candidate", range: "900–949", gist: "Minor cosmetic flaws allowed. Equivalent to PSA 9 / TAG Mint." },
  { band: "850-899_strong_nm_mint", label: "Strong Near-Mint / Mint", range: "850–899", gist: "Light wear visible at zoom. Comparable to PSA 8.5 / NM-MT+." },
  { band: "800-849_near_mint", label: "Near-Mint", range: "800–849", gist: "PSA 8 / NM-MT range." },
  { band: "700-799_visible_issues", label: "Visible condition risk", range: "700–799", gist: "PSA 7 / EX-MT and below — multiple visible issues." },
  { band: "below_700_heavy_wear", label: "Heavy visible wear", range: "<700", gist: "Significant condition issues across multiple attributes." },
];

export const exampleDisclaimer = DISCLAIMER;

export function exampleBySlug(slug: string): ExampleOutcome | null {
  return exampleOutcomes.find((entry) => entry.slug === slug) ?? null;
}

export function exampleById(id: string): ExampleOutcome | null {
  return exampleOutcomes.find((entry) => entry.id === id) ?? null;
}

export function bandLabel(band: ConditionBand): string {
  return conditionLadder.find((entry) => entry.band === band)?.label ?? band;
}

export function bandRange(band: ConditionBand): string {
  return conditionLadder.find((entry) => entry.band === band)?.range ?? "—";
}
