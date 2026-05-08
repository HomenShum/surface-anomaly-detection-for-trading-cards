/**
 * Public dataset registry — the source-of-truth list of every external dataset
 * we either link to or train against, with usage rights captured per row.
 *
 * Trust contract:
 *   - PSA / CGC / TAG / BGS records are CERTIFIED REFERENCES, not training data.
 *   - Roboflow CC BY 4.0 datasets are usable for detector training with attribution.
 *   - Pokémon TCG API images are usable for card-identity rendering per their public docs.
 *   - We never claim official grade prediction. We never scrape TAG DIG data.
 *
 * Render this on /benchmarks so users can see exactly where each input came from.
 */

export type DatasetTier = "training_open" | "certified_reference" | "metadata_api" | "user_consented_gold";

export type DatasetUsageRights = {
  canUseForTraining: boolean;
  canCacheImagesLocally: boolean;
  canDeepLink: boolean;
  attributionRequired: boolean;
};

export type DatasetSource = {
  id: string;
  title: string;
  organization: string;
  tier: DatasetTier;
  url: string;
  license: string;
  imageCount?: number;
  labels?: string[];
  notes: string;
  rights: DatasetUsageRights;
};

export const datasetSources: DatasetSource[] = [
  // ── Open training datasets (model bootstrap) ─────────────────────────
  {
    id: "roboflow_pokemon_surface_damage",
    title: "Pokemon Surface Damage Detection",
    organization: "PokemonFrontDamagedetection (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/pokemonfrontdamagedetection/pokemon-surface-damage-detection",
    license: "CC BY 4.0",
    imageCount: 1000,
    labels: ["Scratch", "Hole", "Crease", "Damaged_corner", "Edge Wear", "heavy wear", "perfect corner", "Tear"],
    notes: "Best Pokémon-specific DING starter dataset.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_card_grader",
    title: "Card Grader",
    organization: "Group 6 Major Project (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/group-6-major-project/card-grader",
    license: "CC BY 4.0",
    imageCount: 632,
    labels: ["Scratch", "Card", "Corner Wear", "Edge Wear"],
    notes: "Generic card-condition detector. Good for cross-domain validation.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_card_condition",
    title: "Card Condition",
    organization: "Fes Acatlan (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/fes-acatlan/card-condition-29wwd",
    license: "CC BY 4.0",
    imageCount: 6700,
    labels: ["Card", "Corner Wear", "Edge Wear", "Scratch"],
    notes: "Largest open card-condition dataset available.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_scratch_poke",
    title: "scratch-Poke",
    organization: "PokemonFYP (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/pokemonfyp/scratch-poke",
    license: "CC BY 4.0",
    imageCount: 800,
    labels: ["Scratch", "Hole", "Crease", "Damaged_corner", "Edge Wear", "heavy wear", "perfect corner", "Tear"],
    notes: "Pokémon damage variety pack.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_pokefrontbackdamage",
    title: "PokeFrontBackDamage",
    organization: "PokemonFYP (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/pokemonfyp/pokefrontbackdamage",
    license: "CC BY 4.0",
    imageCount: 2633,
    labels: ["Scratch", "Damage", "Hole", "Corner", "Crease", "Damaged Corner", "Edge Wear", "Heavy Wear", "Tear"],
    notes: "Front/back Pokemon damage dataset used to expand hole, tear, crease, edge, and corner coverage.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_sadeedbackcarddmgdetection",
    title: "SadeedBackCardDmgDetection",
    organization: "PokemonFrontDamagedetection (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/pokemonfrontdamagedetection/sadeedbackcarddmgdetection",
    license: "CC BY 4.0",
    imageCount: 331,
    labels: ["Corner", "Crease", "Creased Corner", "Damage", "Damaged Corner", "Scratch"],
    notes: "Researched candidate for the next detector-training download; useful for back-card damage coverage.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "roboflow_pokemon_card_segmentation",
    title: "Pokemon Card Segmentation",
    organization: "maestromaxo (Roboflow Universe)",
    tier: "training_open",
    url: "https://universe.roboflow.com/maestromaxo/pokemon-cards-segmentation",
    license: "CC BY 4.0",
    imageCount: 745,
    labels: ["card-mask"],
    notes: "Card boundary segmentation for normalize/crop pipeline.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  // ── Certified references (link only — never scraped/cached) ──────────
  {
    id: "psa_cert_lookup",
    title: "PSA Cert Verification API + public cert pages",
    organization: "Professional Sports Authenticator (PSA)",
    tier: "certified_reference",
    url: "https://www.psacard.com/publicapi/documentation",
    license: "PSA Terms of Use — public cert lookup; commercial scraping prohibited",
    notes:
      "Used as deep-link references for known outcomes. We display cert#, grade, card name only. We do not cache PSA images or claim official grade prediction.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "github_psa_baseball_grades",
    title: "PSA Baseball Grades",
    organization: "samsilverman (GitHub)",
    tier: "certified_reference",
    url: "https://github.com/samsilverman/PSA-Baseball-Grades",
    license: "Public GitHub repository; provenance/legal suitability requires review",
    labels: ["PSA grade 1-10"],
    notes:
      "Weak grade-band reference only. It is not raw pre-submission data and has no human DING boxes, so it is not detector-training truth.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "hf_gotthatdata_sports_cards",
    title: "GotThatData sports-cards",
    organization: "GotThatData (Hugging Face)",
    tier: "certified_reference",
    url: "https://huggingface.co/datasets/GotThatData/sports-cards",
    license: "Images CC BY-NC-SA 4.0; metadata MIT",
    imageCount: 127,
    labels: ["front/back images", "OCR text", "card metadata", "manual verification flags"],
    notes:
      "Good catalog/OCR/reference candidate. Not commercial detector-training data without separate license because image license is non-commercial share-alike.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "cgc_cert_lookup",
    title: "CGC Cert Lookup",
    organization: "CGC Cards",
    tier: "certified_reference",
    url: "https://www.cgccards.com/CERTLOOKUP/card-grading/grading-scale/",
    license: "CGC Terms of Use",
    notes: "Optional second official-reference source. Deep-link only.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "bgs_cert_lookup",
    title: "Beckett Graded Card Lookup",
    organization: "Beckett Grading Services",
    tier: "certified_reference",
    url: "https://www.beckett.com/grading/card-lookup",
    license: "Beckett Terms of Use",
    notes: "Useful for sub-grade UX (centering / corners / edges / surface). Deep-link only.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "tag_dig_rubric",
    title: "TAG DIG report + grading rubric",
    organization: "TAG Grading",
    tier: "certified_reference",
    url: "https://taggrading.com/pages/dig",
    license: "TAG Terms of Use — scraping/data extraction explicitly prohibited",
    notes:
      "TAG Score 990–1000=Pristine, 950–989=Gem Mint 10, 900–949=Mint 9. We do NOT scrape TAG DIG data. We mirror their rubric concepts (DINGS, attribute breakdown) under our own ladder.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  // ── Metadata APIs (card identity, not condition) ─────────────────────
  {
    id: "pokemon_tcg_api",
    title: "Pokémon TCG API",
    organization: "Pokémon TCG Developers",
    tier: "metadata_api",
    url: "https://docs.pokemontcg.io/api-reference/cards/card-object/",
    license: "Public API; image hotlinking permitted per docs",
    notes:
      "Source of canonical card identity images (`images.large`). Used for example cards where we display known outcomes alongside official art.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "pokemon_tcg_data_github",
    title: "PokemonTCG/pokemon-tcg-data",
    organization: "Pokémon TCG community (GitHub)",
    tier: "metadata_api",
    url: "https://github.com/PokemonTCG/pokemon-tcg-data",
    license: "MIT-style data dump; CC license on per-file basis",
    notes: "Offline JSON mirror of the Pokémon TCG API.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: true, attributionRequired: true },
  },
  {
    id: "ocdb_card_reference",
    title: "Open Card Database",
    organization: "OCDB",
    tier: "metadata_api",
    url: "https://www.ocdb.dev/docs",
    license: "Open/readable database; attribution and contributor licensing apply",
    labels: ["card identity", "listing condition", "image URLs"],
    notes: "Reusable card identity and listing-context reference. Not DING ground truth and not official outcome proof.",
    rights: { canUseForTraining: false, canCacheImagesLocally: false, canDeepLink: true, attributionRequired: true },
  },
  // ── Gold tier — built by us through user consent ────────────────────
  {
    id: "ccv_user_consented_gold",
    title: "User-Consented Pre-Submission Scans + Official Outcomes",
    organization: "Card Condition Vault",
    tier: "user_consented_gold",
    url: "/scan?mode=sample",
    license: "Per-user consent; opt-in for shared training. Stored hashed; raw images never published without explicit opt-in.",
    notes:
      "The real moat. User scans card pre-submission, attaches official cert when it returns, opts into model improvement. Human reviewer labels DINGS. Becomes the gold-standard ground truth.",
    rights: { canUseForTraining: true, canCacheImagesLocally: true, canDeepLink: false, attributionRequired: false },
  },
];

export function datasetById(id: string) {
  return datasetSources.find((entry) => entry.id === id) ?? null;
}

export function datasetsByTier(tier: DatasetTier) {
  return datasetSources.filter((entry) => entry.tier === tier);
}
