import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type SeedRecord = {
  id: string;
  provider: "PSA";
  cert_number: string;
  external_url?: string;
  official_grade?: string;
  card_identity?: string;
  trust_tier?: string;
  local_image_sha256?: string;
};

type SeedFile = {
  silver_plus_records?: SeedRecord[];
};

function repoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybe = resolve(cwd, "..", "..");
  if (existsSync(join(maybe, "pnpm-workspace.yaml"))) return maybe;
  return cwd;
}

let seedCache: SeedRecord[] | null = null;

function loadSeedRecords(): SeedRecord[] {
  if (seedCache) return seedCache;
  const path = join(
    repoRoot(),
    "data",
    "cert-references",
    "vendor-batches",
    "processed_psa_references",
    "psa_certified_reference_seed.json",
  );
  if (!existsSync(path)) {
    seedCache = [];
    return seedCache;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as SeedFile;
    seedCache = parsed.silver_plus_records ?? [];
    return seedCache;
  } catch {
    seedCache = [];
    return seedCache;
  }
}

export function certifiedSeedByImageHash(imageHash: string): SeedRecord | null {
  return loadSeedRecords().find((record) => record.local_image_sha256 === imageHash) ?? null;
}
