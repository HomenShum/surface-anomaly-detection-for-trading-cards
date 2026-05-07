import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

export function certDataDir() {
  const dir = join(repoRoot(), "data", "cert-references");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function coerceRef(ref) {
  return {
    status: "metadata_resolved",
    psaApiAttempted: false,
    psaApiConfigured: false,
    ingestionPolicy:
      ref.provider === "TAG"
        ? "TAG link-only. Do not bulk scrape TAG DIG data. Ingest only user-provided screenshots or partner/API-permitted fields."
        : "PSA API-first when PSA_PUBLIC_API_KEY or PSA_API_KEY is configured. Do not cache cert images or train on them without permission.",
    warnings: [],
    ...ref,
  };
}

export function loadSeedRefs() {
  return readJson(join(certDataDir(), "seed.json"), []).map(coerceRef);
}

export function loadImportRefs() {
  const path = join(certDataDir(), "imports.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [coerceRef(JSON.parse(line))];
      } catch {
        return [];
      }
    });
}

export function loadResolvedRefs() {
  return readJson(join(certDataDir(), "resolved.json"), []).map(coerceRef);
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function certUrl(provider, certNumber) {
  if (provider === "TAG") return `https://my.taggrading.com/card/${certNumber}`;
  if (provider === "CGC") return `https://www.cgccards.com/certlookup/${certNumber}/`;
  if (provider === "BGS") return `https://www.beckett.com/grading/card-lookup?cert=${certNumber}`;
  return `https://www.psacard.com/cert/${certNumber}`;
}

function goldRefId(provider, certNumber) {
  return `${String(provider).toLowerCase()}_${String(certNumber).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export function loadGoldRefs() {
  return readJsonl(join(certDataDir(), "gold-records.jsonl")).flatMap((record) => {
    const official = record.officialOutcome ?? {};
    const provider = String(official.grader ?? "").toUpperCase();
    const certNumber = String(official.certNumber ?? "").trim();
    if (!["PSA", "TAG", "CGC", "BGS"].includes(provider) || !certNumber) return [];
    const dings = Array.isArray(record.dings) ? record.dings : [];
    return [
      coerceRef({
        id: goldRefId(provider, certNumber),
        provider,
        certNumber,
        externalUrl: official.certUrl ?? certUrl(provider, certNumber),
        trustTier: "gold",
        source: "gold_user_consent",
        officialGrade: official.grade ?? "",
        numericGrade: official.numericGrade,
        cardIdentity: record.title ?? "User-consented Gold record",
        metadataConfidence: "friend_screenshot_verified_by_user",
        hasFrontBackSlabImages: false,
        rawPreSubmissionScanAvailable: Boolean(record.imageDataUrl),
        trainingAllowed: Boolean(record.consentModelTraining),
        publicExampleAllowed: Boolean(record.consentPublicExample),
        needsRawScanForGold: false,
        status: "example_published",
        resolvedAt: record.createdAt ?? new Date().toISOString(),
        psaApiAttempted: false,
        psaApiConfigured: false,
        ingestionPolicy:
          "Gold user-consented record. Raw image and DING review are user-provided; training is allowed only when consentModelTraining=true.",
        limitations: [
          "Gold status depends on user consent, attached raw pre-submission scan, official outcome, and human DING review.",
          "Do not publish raw image bytes beyond the user's public-example consent.",
        ],
        warnings: [],
        goldRecordId: record.id,
        humanDingReview: {
          reviewerHandle: record.contributorHandle ?? "anon",
          reviewedImageSource: "raw_pre_submission",
          cleanCardAttestation: dings.length === 0,
          dingCount: dings.length,
          dings,
          reviewedAt: record.createdAt ?? new Date().toISOString(),
        },
      }),
    ];
  });
}

function applyHumanDingReviews(refs) {
  const latest = new Map();
  for (const review of readJsonl(join(certDataDir(), "human-ding-reviews.jsonl"))) {
    if (!review.certId) continue;
    latest.set(review.certId, review);
  }
  return refs.map((ref) => {
    const review = latest.get(ref.id);
    if (!review) return ref;
    const dings = Array.isArray(review.dings) ? review.dings : [];
    return {
      ...ref,
      humanDingReview: {
        reviewId: review.reviewId,
        reviewerHandle: review.reviewerHandle,
        reviewedImageSource: review.reviewedImageSource,
        cleanCardAttestation: Boolean(review.cleanCardAttestation),
        dingCount: typeof review.dingCount === "number" ? review.dingCount : dings.length,
        dings,
        reviewedAt: review.createdAt,
      },
    };
  });
}

export function loadAllRefs() {
  const byId = new Map();
  for (const ref of [...loadSeedRefs(), ...loadImportRefs(), ...loadResolvedRefs(), ...loadGoldRefs()]) byId.set(ref.id, ref);
  return applyHumanDingReviews([...byId.values()]).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function gradeToBand(gradeLabel = "") {
  const label = String(gradeLabel).toUpperCase();
  if (label.includes("10") || label.includes("GEM")) return "950-1000_gem_pristine";
  if (label.includes("9") || label.includes("MINT")) return "900-949_mint";
  if (label.includes("8.5")) return "850-899_strong_nm_mint";
  if (label.includes("8") || label.includes("NM-MT")) return "800-849_near_mint";
  if (label.includes("7") || label.includes("6") || label.includes("EX-MT")) return "700-799_visible_issues";
  if (label.includes("5") || /\bEX\b/.test(label)) return "below_700_heavy_wear";
  return "unknown";
}

export function summarizeRefs(refs) {
  const analyzed = refs.filter((ref) => ["model_analyzed", "comparison_ready", "example_published"].includes(ref.status));
  const gold = refs.filter((ref) => ref.trustTier === "gold_candidate" || ref.trustTier === "gold");
  return {
    total: refs.length,
    psa: refs.filter((ref) => ref.provider === "PSA").length,
    tag: refs.filter((ref) => ref.provider === "TAG").length,
    silverPlus: refs.filter((ref) => ref.trustTier === "silver_plus").length,
    gold: gold.length,
    analyzed: analyzed.length,
    trainingViolations: refs.filter((ref) => ref.trainingAllowed && !["gold", "gold_candidate"].includes(ref.trustTier)).length,
    tagBulkScrapeViolations: refs.filter((ref) => ref.provider === "TAG" && !String(ref.ingestionPolicy).toLowerCase().includes("do not bulk scrape")).length,
    needsRawScanForGold: refs.filter((ref) => ref.needsRawScanForGold).length,
  };
}

export async function resolvePsaViaApi(ref) {
  const apiKey = process.env.PSA_PUBLIC_API_KEY ?? process.env.PSA_API_KEY;
  const warnings = [...(ref.warnings ?? [])];
  if (!apiKey) {
    warnings.push("PSA API key not configured; kept seed/manual metadata.");
    return { ...ref, psaApiAttempted: true, psaApiConfigured: false, warnings };
  }

  const base = process.env.PSA_API_BASE_URL ?? "https://api.psacard.com/publicapi/cert/GetByCertNumber";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/${encodeURIComponent(ref.certNumber)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Ocp-Apim-Subscription-Key": apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      warnings.push(`PSA API returned ${response.status}; kept seed/manual metadata.`);
      return { ...ref, psaApiAttempted: true, psaApiConfigured: true, warnings };
    }
    const data = await response.json();
    const officialGrade = data.Grade ?? data.grade ?? data.ItemGrade ?? data.itemGrade ?? ref.officialGrade;
    const cardIdentity =
      [data.Year, data.Brand, data.Subject, data.CardNumber ? `#${data.CardNumber}` : ""].filter(Boolean).join(" ") ||
      ref.cardIdentity;
    return {
      ...ref,
      officialGrade,
      cardIdentity,
      metadataConfidence: "api_verified",
      status: "metadata_resolved",
      psaApiAttempted: true,
      psaApiConfigured: true,
      resolvedAt: new Date().toISOString(),
      warnings,
    };
  } catch (error) {
    warnings.push(`PSA API lookup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return { ...ref, psaApiAttempted: true, psaApiConfigured: true, warnings };
  }
}
