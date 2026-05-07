import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  exampleOutcomes,
  type ConditionBand,
  type ExampleDing,
  type ExampleOutcome,
  type ExampleProvenance,
} from "./registry";
import { loadAllCertifiedReferences, repoRoot, type CertifiedReference } from "../cert-references";
import { mapOfficialGradeToBand } from "../cert-references-eval";

/** Look for a slab front image at data/cert-references/slab-images/<certId>/<file>. */
function findLocalSlabImageUrl(certId: string): { url: string; filename: string } | null {
  const dir = join(repoRoot(), "data", "cert-references", "slab-images", certId);
  if (!existsSync(dir)) return null;
  const preferred = ["front.jpg", "front.jpeg", "front.png", "front.webp"];
  const entries = readdirSync(dir).filter((entry) => /\.(jpe?g|png|webp)$/i.test(entry));
  if (entries.length === 0) return null;
  const pick = preferred.find((p) => entries.includes(p)) ?? entries[0];
  return { url: `/api/cert-references/slab/${certId}/${pick}`, filename: pick };
}

/** Optional Pokémon TCG identity-image cache populated by `pnpm certs:resolve-identities`. */
function loadIdentityImageCache(): Record<string, { imageUrl: string; matchedName?: string; setName?: string }> {
  const path = join(repoRoot(), "data", "cert-references", "identity-cache.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Gold-tier user-consented example store.
 *
 * Layout:
 *   data/examples/gold/<id>.json
 *
 * Privacy contract:
 *   • Raw image bytes ARE allowed locally (the user opted in).
 *   • The user explicitly toggles `consentPublicAttribution` per record.
 *     When false, the record renders publicly with handle = "anon".
 *   • The card_id and original report id are stored so the user can revoke.
 *   • Sub-grades + DING annotations come from the user's review of their own
 *     scan; the harness treats them as ground truth ONLY when the record
 *     also has an attached official cert number.
 */

export type GoldRecordPayload = {
  /** Stable id, derived from cert# + sha256(report_json) when available, else random. */
  id: string;
  slug: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** The user's stable handle. May equal "anon" if consent flag is false. */
  contributorHandle: string;
  /** Display name for credit. */
  contributorDisplayName?: string;
  /** Has the user opted into public attribution? */
  consentPublicAttribution: boolean;
  /** Has the user explicitly opted into showing this record in /examples? */
  consentPublicExample: boolean;
  /** Has the user explicitly opted into training/model improvement use? */
  consentModelTraining: boolean;
  /** Reviewer explicitly accepted the DING/no-DING annotations on this image. */
  humanDingReviewApproved: boolean;
  /** Card identity. */
  title: string;
  game: ExampleOutcome["game"];
  setName?: string;
  cardNumber?: string;
  finish: ExampleOutcome["finish"];
  /** Image bytes the user attached (data URL). May be empty if user opted out. */
  imageDataUrl?: string;
  /** Official outcome attached by the user (PSA cert# + grade). */
  officialOutcome?: {
    grader: "PSA" | "BGS" | "CGC" | "TAG" | "human-reviewer";
    certNumber?: string;
    certUrl?: string;
    grade?: string;
    numericGrade?: number;
    band: ConditionBand;
    subGrades?: { centering?: number; corners?: number; edges?: number; surface?: number };
  };
  /** User's hand-authored DING annotations on top of their own scan. */
  dings: ExampleDing[];
  /** Our model's prediction for this card. */
  ourPrediction: ExampleOutcome["ourPrediction"];
  whyThisGradeNotHigher?: string[];
  failureMode?: ExampleOutcome["failureMode"];
};

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return join(repoRoot(), "data");
}

function goldDir() {
  return join(dataDir(), "examples", "gold");
}

function ensureDir() {
  const dir = goldDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function safeId(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return `gold_${hash}`;
}

function safeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type SubmitGoldInput = {
  contributorHandle: string;
  contributorDisplayName?: string;
  consentPublicAttribution: boolean;
  consentPublicExample?: boolean;
  consentModelTraining?: boolean;
  humanDingReviewApproved?: boolean;
  title: string;
  game?: ExampleOutcome["game"];
  setName?: string;
  cardNumber?: string;
  finish?: ExampleOutcome["finish"];
  imageDataUrl?: string;
  officialOutcome?: GoldRecordPayload["officialOutcome"];
  dings: ExampleDing[];
  ourPrediction: GoldRecordPayload["ourPrediction"];
  whyThisGradeNotHigher?: string[];
};

function certReferenceDir() {
  const dir = join(dataDir(), "cert-references");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function appendGoldReferenceIndex(record: GoldRecordPayload) {
  const path = join(certReferenceDir(), "gold-records.jsonl");
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
}

export function submitGoldExample(input: SubmitGoldInput): GoldRecordPayload {
  ensureDir();
  if (!input.imageDataUrl) {
    throw new Error("Gold record requires raw pre-submission imageDataUrl. Do not submit metadata-only records as Gold.");
  }
  if (!input.officialOutcome) {
    throw new Error("Gold record requires an attached official outcome.");
  }
  if (input.officialOutcome.grader !== "human-reviewer" && !input.officialOutcome.certNumber?.trim()) {
    throw new Error("Gold record requires a cert number for PSA/BGS/CGC/TAG outcomes.");
  }
  if (!input.officialOutcome.grade && !Number.isFinite(input.officialOutcome.numericGrade)) {
    throw new Error("Gold record requires a grade label or numeric grade.");
  }
  if (!input.humanDingReviewApproved) {
    throw new Error("Gold record requires explicit human DING review approval, even when the card is clean.");
  }
  const idSeed = `${input.title}-${input.officialOutcome?.certNumber ?? Date.now()}-${input.contributorHandle}`;
  const id = safeId(idSeed);
  const slug = safeSlug(`${input.contributorHandle}-${input.title}`);
  const createdAt = new Date().toISOString();
  const handle = input.consentPublicAttribution
    ? input.contributorHandle.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32) || "anon"
    : "anon";
  const payload: GoldRecordPayload = {
    id,
    slug,
    createdAt,
    contributorHandle: handle,
    contributorDisplayName: input.consentPublicAttribution ? input.contributorDisplayName : undefined,
    consentPublicAttribution: input.consentPublicAttribution,
    consentPublicExample: Boolean(input.consentPublicExample),
    consentModelTraining: Boolean(input.consentModelTraining),
    humanDingReviewApproved: Boolean(input.humanDingReviewApproved),
    title: input.title,
    game: input.game ?? "other",
    setName: input.setName,
    cardNumber: input.cardNumber,
    finish: input.finish ?? "unknown",
    imageDataUrl: input.imageDataUrl,
    officialOutcome: input.officialOutcome,
    dings: input.dings,
    ourPrediction: input.ourPrediction,
    whyThisGradeNotHigher: input.whyThisGradeNotHigher,
  };
  writeFileSync(join(goldDir(), `${id}.json`), JSON.stringify(payload, null, 2), "utf-8");
  appendGoldReferenceIndex(payload);
  return payload;
}

export function loadGoldExamples(): GoldRecordPayload[] {
  ensureDir();
  const dir = goldDir();
  if (!existsSync(dir)) return [];
  const out: GoldRecordPayload[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf-8")) as GoldRecordPayload);
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function goldToExampleOutcome(record: GoldRecordPayload): ExampleOutcome {
  const provenance: ExampleProvenance = {
    identityImageUrl: record.imageDataUrl ?? null,
    identityImageSource: "user-consented",
    identityImageAttribution: record.consentPublicAttribution
      ? `User-consented scan · @${record.contributorHandle}`
      : "User-consented scan · attribution withheld",
    externalReferenceUrl: record.officialOutcome?.certUrl,
    externalReferenceLabel: record.officialOutcome?.certNumber ? `Cert ${record.officialOutcome.certNumber}` : undefined,
  };
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    game: record.game,
    setName: record.setName,
    cardNumber: record.cardNumber,
    finish: record.finish,
    tier: "gold",
    trustBadgeReason: record.officialOutcome
      ? `Gold tier — user-consented scan + ${record.officialOutcome.grader} cert ${record.officialOutcome.certNumber ?? ""} + user-reviewed DINGs.`
      : "Gold tier — user-consented scan + user-reviewed DINGs (no official cert attached yet).",
    provenance,
    dings: record.dings,
    knownOutcome: record.officialOutcome
      ? {
          grader: record.officialOutcome.grader,
          certNumber: record.officialOutcome.certNumber,
          certUrl: record.officialOutcome.certUrl,
          grade: record.officialOutcome.grade,
          numericGrade: record.officialOutcome.numericGrade,
          band: record.officialOutcome.band,
          subGrades: record.officialOutcome.subGrades,
        }
      : undefined,
    ourPrediction: record.ourPrediction,
    failureMode: record.failureMode,
    whyThisGradeNotHigher: record.whyThisGradeNotHigher,
    tags: ["gold", "user-consented", record.game, record.finish, record.officialOutcome?.grader.toLowerCase() ?? "no-cert"].filter(Boolean) as string[],
    createdAt: record.createdAt,
  };
}

/**
 * Auto-generate a basic ExampleOutcome from a certified-reference seed when no
 * hand-authored entry exists in the registry. This way every cert in
 * `data/cert-references/seed.json` (or imports.jsonl) automatically appears in
 * the Verified Outcome Library — adding a cert to the seed file is enough to
 * surface it on /examples without editing TypeScript.
 *
 * Manual entries always take precedence (matched by example id `ex_<seed.id>`).
 */
function certSeedToExampleOutcome(seed: CertifiedReference, identityCache: Record<string, { imageUrl: string; matchedName?: string; setName?: string }>): ExampleOutcome {
  const band = mapOfficialGradeToBand(seed) ?? "800-849_near_mint";
  const slug = seed.id.replaceAll("_", "-");
  const id = `ex_${seed.id}`;
  const tags = [
    seed.trustTier,
    seed.provider.toLowerCase(),
    "certified-reference",
    "auto-generated",
    seed.numericGrade != null ? `psa-${seed.numericGrade}` : null,
  ].filter(Boolean) as string[];

  // Provenance precedence: local slab image (private, served by us) →
  // Pokémon TCG identity cache (public hotlink) → null placeholder.
  const localSlab = findLocalSlabImageUrl(seed.id);
  const identityHit = identityCache[seed.id];
  let identityImageUrl: string | null = null;
  let identityImageSource: ExampleOutcome["provenance"]["identityImageSource"] = "synthetic-placeholder";
  let identityImageAttribution = `${seed.provider} cert page — ${seed.externalUrl}`;
  if (localSlab) {
    identityImageUrl = localSlab.url;
    identityImageSource = "user-consented";
    identityImageAttribution = `User-supplied slab photo (${localSlab.filename}) — never cached or trained on without explicit consent.`;
  } else if (identityHit) {
    identityImageUrl = identityHit.imageUrl;
    identityImageSource = "pokemon-tcg-api";
    identityImageAttribution = `Pokémon TCG API (${identityHit.matchedName ?? "card identity"}${identityHit.setName ? ` · ${identityHit.setName}` : ""}). Hotlink permitted per their public docs. NOT a slab photo.`;
  }

  return {
    id,
    slug,
    title: `${seed.provider} ${seed.certNumber} — ${seed.cardIdentity ?? "identity pending"}${seed.officialGrade ? ` — ${seed.officialGrade}` : ""}`,
    game: /pokemon|pokémon|pokemon\s+jp/i.test(seed.cardIdentity ?? "") ? "pokemon" : "other",
    finish: "unknown",
    tier: seed.trustTier === "gold_candidate" ? "gold" : (seed.trustTier as ExampleOutcome["tier"]),
    trustBadgeReason: `Auto-generated from certified-reference seed. ${seed.provider} ${seed.officialGrade ?? "graded"} (cert ${seed.certNumber}).`,
    provenance: {
      identityImageUrl,
      identityImageSource,
      identityImageAttribution,
      externalReferenceUrl: seed.externalUrl,
      externalReferenceLabel: `${seed.provider} Cert ${seed.certNumber}`,
    },
    dings: [],
    knownOutcome: seed.officialGrade
      ? {
          grader: seed.provider as "PSA" | "BGS" | "CGC" | "TAG",
          certNumber: seed.certNumber,
          certUrl: seed.externalUrl,
          grade: seed.officialGrade,
          numericGrade: seed.numericGrade,
          band,
        }
      : undefined,
    ourPrediction: {
      benchmarkScore: 0,
      band,
      confidence: 0,
      matchedKnownOutcome: null,
      notes:
        "Awaiting cert-reference eval run. Drop slab images into data/cert-references/slab-images/<cert_id>/ and run `pnpm eval:certrefs:run` to score.",
      modelVersion: "ding-detector-v0",
    },
    whyThisGradeNotHigher: [
      "Auto-generated entry — no hand-authored DING annotations yet.",
      "Cert-reference eval has not run against this slab yet.",
    ],
    tags,
    createdAt: new Date().toISOString(),
  };
}

function loadCertSeedExamples(): ExampleOutcome[] {
  let refs: CertifiedReference[];
  try {
    refs = loadAllCertifiedReferences();
  } catch {
    return [];
  }
  const identityCache = loadIdentityImageCache();
  const manualIds = new Set(exampleOutcomes.map((entry) => entry.id));
  return refs
    .filter((ref) => !manualIds.has(`ex_${ref.id}`))
    .map((ref) => certSeedToExampleOutcome(ref, identityCache));
}

/**
 * Returns the merged list of (Gold records) + (manual seeded ExampleOutcomes) +
 * (auto-generated cert-seed entries that don't have a hand-authored override).
 * Callable from server components.
 */
export function loadAllExamples(): ExampleOutcome[] {
  const gold = loadGoldExamples()
    .filter((record) => record.consentPublicExample)
    .map(goldToExampleOutcome);
  const certSeedAuto = loadCertSeedExamples();
  return [...gold, ...exampleOutcomes, ...certSeedAuto];
}

export function findExampleBySlug(slug: string): ExampleOutcome | null {
  return loadAllExamples().find((entry) => entry.slug === slug) ?? null;
}
