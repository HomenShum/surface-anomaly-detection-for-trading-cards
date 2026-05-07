import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type CertProvider = "PSA" | "TAG" | "CGC" | "BGS";

export type CertTrustTier = "silver" | "silver_plus" | "gold_candidate" | "gold";

export type CertReferenceStatus =
  | "received"
  | "cert_detected"
  | "metadata_resolved"
  | "image_available"
  | "model_analyzed"
  | "comparison_ready"
  | "human_review_needed"
  | "example_published";

export type CertReferenceCandidate = {
  provider: CertProvider;
  certNumber: string;
  externalUrl: string;
  sourceText: string;
};

export type CertifiedReference = {
  id: string;
  provider: CertProvider;
  certNumber: string;
  externalUrl: string;
  trustTier: CertTrustTier;
  source:
    | "seed"
    | "friend_cert_photo"
    | "friend_cert_link"
    | "import_text"
    | "upload_filename"
    | "api_lookup"
    | "gold_user_consent";
  officialGrade?: string;
  numericGrade?: number;
  cardIdentity?: string;
  metadataConfidence: "api_verified" | "friend_screenshot_verified_by_user" | "friend_photo_unverified" | "link_only" | "extracted_candidate";
  hasFrontBackSlabImages: boolean;
  trainingAllowed: boolean;
  publicExampleAllowed: boolean;
  needsRawScanForGold: boolean;
  status: CertReferenceStatus;
  resolvedAt?: string;
  psaApiAttempted: boolean;
  psaApiConfigured: boolean;
  ingestionPolicy: string;
  limitations: string[];
  rawInputHash?: string;
  warnings: string[];
  rawPreSubmissionScanAvailable?: boolean;
  goldRecordId?: string;
  humanDingReview?: {
    reviewId?: string;
    reviewerHandle?: string;
    reviewedImageSource?: string;
    cleanCardAttestation?: boolean;
    dingCount: number;
    dings?: unknown[];
    reviewedAt?: string;
  };
};

type SeedRecord = Omit<CertifiedReference, "status" | "psaApiAttempted" | "psaApiConfigured" | "ingestionPolicy" | "warnings"> & {
  status?: CertReferenceStatus;
  psaApiAttempted?: boolean;
  psaApiConfigured?: boolean;
  ingestionPolicy?: string;
  warnings?: string[];
};

export type CertImportPayload = {
  text?: string;
  urls?: string[];
  certNumbers?: string[];
  files?: Array<{
    name: string;
    text?: string;
    base64?: string;
    mimeType?: string;
    dataUrl?: string;
    providerHint?: CertProvider;
  }>;
  publishToExamples?: boolean;
};

const PSA_URL_RE = /psacard\.com\/(?:en-[a-z]{2}\/)?cert\/(\d{7,12})/gi;
const TAG_URL_RE = /my\.taggrading\.com\/card\/([A-Z0-9-]{5,20})/gi;
const TAG_BARE_ID_RE = /\b([A-Z]\d{5,}|[A-Z]{1,4}\d{4,})\b/g;
const DIGIT_CERT_RE = /(?<![A-Za-z0-9])\d{7,12}(?![A-Za-z0-9])/g;

export function repoRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybeRoot = resolve(cwd, "..", "..");
  if (existsSync(join(maybeRoot, "pnpm-workspace.yaml"))) return maybeRoot;
  return cwd;
}

export function certReferenceDir() {
  const dir = join(repoRoot(), "data", "cert-references");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function certUrl(provider: CertProvider, certNumber: string) {
  if (provider === "TAG") return `https://my.taggrading.com/card/${certNumber}`;
  if (provider === "CGC") return `https://www.cgccards.com/certlookup/${certNumber}/`;
  if (provider === "BGS") return `https://www.beckett.com/grading/card-lookup?cert=${certNumber}`;
  return `https://www.psacard.com/cert/${certNumber}`;
}

function normalizeCert(raw: string) {
  return raw.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function makeId(provider: CertProvider, certNumber: string) {
  return `${provider.toLowerCase()}_${normalizeCert(certNumber).toLowerCase()}`;
}

function defaultPolicy(provider: CertProvider) {
  if (provider === "TAG") {
    return "TAG link-only. Do not bulk scrape TAG DIG data. Ingest only user-provided screenshots or partner/API-permitted fields.";
  }
  if (provider === "PSA") {
    return "PSA API-first when PSA_PUBLIC_API_KEY or PSA_API_KEY is configured. Do not cache cert images or train on them without permission.";
  }
  return "Certified reference only. API/user-provided artifacts preferred; no uncontrolled scraping or training without permission.";
}

function coerceSeed(record: SeedRecord): CertifiedReference {
  return {
    ...record,
    status: record.status ?? "metadata_resolved",
    psaApiAttempted: record.psaApiAttempted ?? false,
    psaApiConfigured: record.psaApiConfigured ?? false,
    ingestionPolicy: record.ingestionPolicy ?? defaultPolicy(record.provider),
    warnings: record.warnings ?? [],
  };
}

export function loadSeedCertifiedReferences(): CertifiedReference[] {
  const records = readJsonFile<SeedRecord[]>(join(certReferenceDir(), "seed.json"), []);
  return records.map(coerceSeed);
}

export function loadImportedCertifiedReferences(): CertifiedReference[] {
  const path = join(certReferenceDir(), "imports.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CertifiedReference];
      } catch {
        return [];
      }
    });
}

function loadJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function makeGoldReferenceId(provider: string, certNumber: string) {
  return `${provider.toLowerCase()}_${certNumber.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export function loadGoldCertifiedReferences(): CertifiedReference[] {
  return loadJsonl(join(certReferenceDir(), "gold-records.jsonl")).flatMap((record) => {
    const official = record["officialOutcome"] as Record<string, unknown> | undefined;
    const provider = String(official?.["grader"] ?? "").toUpperCase();
    const certNumber = String(official?.["certNumber"] ?? "").trim();
    if (!["PSA", "TAG", "CGC", "BGS"].includes(provider) || !certNumber) return [];
    const dings = Array.isArray(record["dings"]) ? record["dings"] : [];
    return [
      {
        id: makeGoldReferenceId(provider, certNumber),
        provider: provider as CertProvider,
        certNumber,
        externalUrl: String(official?.["certUrl"] ?? certUrl(provider as CertProvider, certNumber)),
        trustTier: "gold" as const,
        source: "gold_user_consent" as const,
        officialGrade: String(official?.["grade"] ?? ""),
        numericGrade: typeof official?.["numericGrade"] === "number" ? official["numericGrade"] : undefined,
        cardIdentity: String(record["title"] ?? "User-consented Gold record"),
        metadataConfidence: "friend_screenshot_verified_by_user" as const,
        hasFrontBackSlabImages: false,
        rawPreSubmissionScanAvailable: Boolean(record["imageDataUrl"]),
        trainingAllowed: Boolean(record["consentModelTraining"]),
        publicExampleAllowed: Boolean(record["consentPublicExample"]),
        needsRawScanForGold: false,
        status: "example_published" as const,
        resolvedAt: String(record["createdAt"] ?? new Date().toISOString()),
        psaApiAttempted: false,
        psaApiConfigured: false,
        ingestionPolicy:
          "Gold user-consented record. Raw image and DING review are user-provided; training is allowed only when consentModelTraining=true.",
        limitations: [
          "Gold status depends on user consent, attached raw pre-submission scan, official outcome, and human DING review.",
          "Do not publish raw image bytes beyond the user's public-example consent.",
        ],
        warnings: [],
        goldRecordId: String(record["id"] ?? ""),
        humanDingReview: {
          reviewerHandle: String(record["contributorHandle"] ?? "anon"),
          reviewedImageSource: "raw_pre_submission",
          cleanCardAttestation: dings.length === 0,
          dingCount: dings.length,
          dings,
          reviewedAt: String(record["createdAt"] ?? new Date().toISOString()),
        },
      } satisfies CertifiedReference,
    ];
  });
}

function applyHumanDingReviews(refs: CertifiedReference[]) {
  const latestByCert = new Map<string, Record<string, unknown>>();
  for (const review of loadJsonl(join(certReferenceDir(), "human-ding-reviews.jsonl"))) {
    const certId = String(review["certId"] ?? "");
    if (!certId) continue;
    latestByCert.set(certId, review);
  }
  return refs.map((ref) => {
    const review = latestByCert.get(ref.id);
    if (!review) return ref;
    const dings = Array.isArray(review["dings"]) ? review["dings"] : [];
    return {
      ...ref,
      humanDingReview: {
        reviewId: String(review["reviewId"] ?? ""),
        reviewerHandle: String(review["reviewerHandle"] ?? ""),
        reviewedImageSource: String(review["reviewedImageSource"] ?? "other"),
        cleanCardAttestation: Boolean(review["cleanCardAttestation"]),
        dingCount: typeof review["dingCount"] === "number" ? review["dingCount"] : dings.length,
        dings,
        reviewedAt: String(review["createdAt"] ?? ""),
      },
    };
  });
}

export function loadAllCertifiedReferences() {
  const byId = new Map<string, CertifiedReference>();
  for (const ref of loadSeedCertifiedReferences()) byId.set(ref.id, ref);
  for (const ref of loadImportedCertifiedReferences()) byId.set(ref.id, ref);
  for (const ref of loadGoldCertifiedReferences()) byId.set(ref.id, ref);
  return applyHumanDingReviews([...byId.values()]).sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.certNumber.localeCompare(b.certNumber),
  );
}

export function extractCertCandidates(rawInputs: string[]): CertReferenceCandidate[] {
  const byKey = new Map<string, CertReferenceCandidate>();

  for (const raw of rawInputs) {
    const text = raw.trim();
    if (!text) continue;

    for (const match of text.matchAll(PSA_URL_RE)) {
      const certNumber = normalizeCert(match[1]);
      byKey.set(`PSA:${certNumber}`, {
        provider: "PSA",
        certNumber,
        externalUrl: certUrl("PSA", certNumber),
        sourceText: text.slice(0, 240),
      });
    }

    if (/my\.taggrading\.com\/card\//i.test(text) || /\bTAG\b/i.test(text)) {
      for (const match of text.matchAll(TAG_URL_RE)) {
        const certNumber = normalizeCert(match[1]);
        byKey.set(`TAG:${certNumber}`, {
          provider: "TAG",
          certNumber,
          externalUrl: certUrl("TAG", certNumber),
          sourceText: text.slice(0, 240),
        });
      }
      const upper = text.toUpperCase();
      for (const match of upper.matchAll(TAG_BARE_ID_RE)) {
        const certNumber = normalizeCert(match[1]);
        byKey.set(`TAG:${certNumber}`, {
          provider: "TAG",
          certNumber,
          externalUrl: certUrl("TAG", certNumber),
          sourceText: text.slice(0, 240),
        });
      }
    }

    for (const match of text.matchAll(DIGIT_CERT_RE)) {
      const certNumber = normalizeCert(match[0]);
      byKey.set(`PSA:${certNumber}`, {
        provider: "PSA",
        certNumber,
        externalUrl: certUrl("PSA", certNumber),
        sourceText: text.slice(0, 240),
      });
    }
  }

  return [...byKey.values()];
}

function rawInputHash(candidate: CertReferenceCandidate) {
  return createHash("sha256").update(`${candidate.provider}:${candidate.certNumber}:${candidate.sourceText}`).digest("hex");
}

function seededByKey() {
  const out = new Map<string, CertifiedReference>();
  for (const ref of loadSeedCertifiedReferences()) out.set(`${ref.provider}:${ref.certNumber}`, ref);
  return out;
}

async function fetchPsaReference(certNumber: string): Promise<Partial<CertifiedReference> | null> {
  const apiKey = process.env.PSA_PUBLIC_API_KEY ?? process.env.PSA_API_KEY;
  if (!apiKey) return null;
  const base = process.env.PSA_API_BASE_URL ?? "https://api.psacard.com/publicapi/cert/GetByCertNumber";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/${encodeURIComponent(certNumber)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Ocp-Apim-Subscription-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const grade = String(data["Grade"] ?? data["grade"] ?? data["ItemGrade"] ?? data["itemGrade"] ?? "");
    const identity = [
      data["Year"],
      data["Brand"],
      data["Subject"],
      data["CardNumber"] ? `#${data["CardNumber"]}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      officialGrade: grade || undefined,
      cardIdentity: identity || undefined,
      metadataConfidence: "api_verified",
      source: "api_lookup",
      status: "metadata_resolved",
      resolvedAt: new Date().toISOString(),
      psaApiAttempted: true,
      psaApiConfigured: true,
    };
  } catch {
    return null;
  }
}

export async function resolveCertifiedReference(candidate: CertReferenceCandidate): Promise<CertifiedReference> {
  const seeds = seededByKey();
  const seed = seeds.get(`${candidate.provider}:${candidate.certNumber}`);
  const psaApiConfigured = Boolean(process.env.PSA_PUBLIC_API_KEY ?? process.env.PSA_API_KEY);
  const warnings: string[] = [];

  let apiPatch: Partial<CertifiedReference> | null = null;
  if (candidate.provider === "PSA") {
    apiPatch = await fetchPsaReference(candidate.certNumber);
    if (!psaApiConfigured) {
      warnings.push("PSA API key not configured; stored as a certified-reference candidate using seed/manual metadata when available.");
    } else if (!apiPatch) {
      warnings.push("PSA API lookup attempted but did not return usable metadata; reference needs review.");
    }
  }

  if (candidate.provider === "TAG") {
    warnings.push("TAG is link-only unless user-provided screenshots or partner/API permission exists. No bulk scraping performed.");
  }

  const base: CertifiedReference =
    seed ??
    ({
      id: makeId(candidate.provider, candidate.certNumber),
      provider: candidate.provider,
      certNumber: candidate.certNumber,
      externalUrl: candidate.externalUrl,
      trustTier: candidate.provider === "PSA" ? "silver_plus" : "silver",
      source: "import_text",
      metadataConfidence: "extracted_candidate",
      hasFrontBackSlabImages: candidate.provider === "PSA",
      trainingAllowed: false,
      publicExampleAllowed: true,
      needsRawScanForGold: true,
      status: "cert_detected",
      psaApiAttempted: candidate.provider === "PSA",
      psaApiConfigured,
      ingestionPolicy: defaultPolicy(candidate.provider),
      limitations: [
        "Certified outcome reference only until raw pre-submission scans and human DING review are attached.",
        "Do not use cert-page images for training or local cache without permission.",
      ],
      warnings: [],
    } as CertifiedReference);

  return {
    ...base,
    ...apiPatch,
    externalUrl: candidate.externalUrl,
    rawInputHash: rawInputHash(candidate),
    psaApiAttempted: candidate.provider === "PSA",
    psaApiConfigured,
    warnings: [...(base.warnings ?? []), ...warnings],
  };
}

export function payloadToRawInputs(payload: CertImportPayload) {
  const inputs: string[] = [];
  if (payload.text) inputs.push(payload.text);
  for (const url of payload.urls ?? []) inputs.push(url);
  for (const cert of payload.certNumbers ?? []) inputs.push(cert);
  for (const file of payload.files ?? []) {
    if (file.name) inputs.push(`${file.providerHint ?? ""} ${file.name}`);
    if (file.text) inputs.push(`${file.providerHint ?? ""} ${file.text}`);
  }
  return inputs;
}

function mimeToExt(mime: string) {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export function ocrImageDataUrl(file: { name: string; dataUrl?: string }) {
  if (!file.dataUrl) return { text: "", warnings: [] as string[] };
  const warnings: string[] = [];
  const match = /^data:([^;]+);base64,(.+)$/i.exec(file.dataUrl);
  if (!match) return { text: "", warnings: [`${file.name}: unsupported image payload.`] };

  const [, mime, encoded] = match;
  const byteLength = Math.floor((encoded.length * 3) / 4);
  if (byteLength > 8 * 1024 * 1024) {
    return { text: "", warnings: [`${file.name}: skipped OCR because image is larger than 8 MB.`] };
  }

  const tmpDir = join(certReferenceDir(), ".tmp-ocr");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const hash = createHash("sha256").update(`${file.name}:${encoded.slice(0, 4096)}`).digest("hex").slice(0, 12);
  const imagePath = join(tmpDir, `${hash}.${mimeToExt(mime)}`);
  writeFileSync(imagePath, Buffer.from(encoded, "base64"));

  const command = process.env.TESSERACT_CMD ?? "tesseract";
  try {
    const result = spawnSync(command, [imagePath, "stdout", "--psm", "6"], {
      encoding: "utf-8",
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) {
      warnings.push(`${file.name}: OCR failed (${result.error.message}).`);
      return { text: "", warnings };
    }
    if (result.status !== 0) {
      warnings.push(`${file.name}: OCR exited ${result.status}; ${String(result.stderr ?? "").trim()}`);
      return { text: "", warnings };
    }
    const text = String(result.stdout ?? "").trim();
    if (!text) warnings.push(`${file.name}: OCR returned no text.`);
    return { text, warnings };
  } finally {
    rmSync(imagePath, { force: true });
  }
}

export function appendImportedCertifiedReferences(references: CertifiedReference[]) {
  if (references.length === 0) return;
  const path = join(certReferenceDir(), "imports.jsonl");
  const existing = new Set(loadAllCertifiedReferences().map((ref) => ref.id));
  const lines = references
    .filter((ref) => !existing.has(ref.id))
    .map((ref) => JSON.stringify({ ...ref, resolvedAt: ref.resolvedAt ?? new Date().toISOString() }));
  if (lines.length > 0) appendFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}
