#!/usr/bin/env node
// Resolve canonical front-image URLs for cert references using the public
// Pokémon TCG API.
//
// Reads:   data/cert-references/seed.json (+ imports.jsonl)
// Writes:  data/cert-references/identity-cache.json
//
// Usage:
//   pnpm certs:resolve-identities                   # process every cert without a cache hit
//   pnpm certs:resolve-identities --refresh         # ignore cache, re-resolve everything
//   pnpm certs:resolve-identities psa_148901890     # resolve specific cert ids
//   POKEMON_TCG_API_KEY=... pnpm certs:resolve-identities  # use higher rate-limit tier
//
// Honest behaviour:
//   - We only hotlink to TCG API images (their public docs explicitly permit it).
//   - We never claim the identity image is the cert's actual slab.
//   - When the API can't find a confident match, we leave the cert without
//     an identity image and mark the cache entry as `null` so we don't retry.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");
const certDir = join(root, "data", "cert-references");
const seedPath = join(certDir, "seed.json");
const importsPath = join(certDir, "imports.jsonl");
const cachePath = join(certDir, "identity-cache.json");

const TCG_BASE = process.env.POKEMON_TCG_API_BASE ?? "https://api.pokemontcg.io/v2";
const TCG_KEY = process.env.POKEMON_TCG_API_KEY;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const targetIds = new Set(args.filter((a) => !a.startsWith("--")));

if (!existsSync(seedPath)) {
  console.error(`[resolve-identities] seed file missing: ${seedPath}`);
  process.exit(2);
}

const refs = loadAllRefs();
const cache = refresh ? {} : (existsSync(cachePath) ? readJson(cachePath, {}) : {});
mkdirSync(certDir, { recursive: true });

const summary = { total: refs.length, attempted: 0, resolved: 0, missed: 0, cached: 0, skipped: 0 };

for (const ref of refs) {
  if (targetIds.size > 0 && !targetIds.has(ref.id)) {
    summary.skipped += 1;
    continue;
  }
  if (!refresh && cache[ref.id]) {
    summary.cached += 1;
    continue;
  }
  if (ref.provider !== "PSA") {
    // Only Pokémon TCG cards have a TCG API. TAG references skip.
    cache[ref.id] = null;
    summary.skipped += 1;
    continue;
  }
  if (!ref.cardIdentity) {
    cache[ref.id] = null;
    summary.missed += 1;
    continue;
  }
  summary.attempted += 1;
  try {
    const hit = await resolveIdentity(ref);
    if (hit) {
      cache[ref.id] = hit;
      summary.resolved += 1;
      console.log(`✓ ${ref.id} → ${hit.matchedName ?? "match"} (${hit.imageUrl})`);
    } else {
      cache[ref.id] = null;
      summary.missed += 1;
      console.log(`× ${ref.id} → no confident TCG match`);
    }
    // Light rate-limit so we stay friendly to the public API.
    await sleep(TCG_KEY ? 120 : 320);
  } catch (error) {
    cache[ref.id] = null;
    summary.missed += 1;
    console.warn(`! ${ref.id} → ${error instanceof Error ? error.message : "lookup failed"}`);
  }
}

writeJson(cachePath, cache);
console.log(JSON.stringify({ ok: true, cachePath, summary }, null, 2));

// ===========================================================================
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function loadAllRefs() {
  const seed = readJson(seedPath, []);
  const imports = existsSync(importsPath)
    ? readFileSync(importsPath, "utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
  const byId = new Map();
  for (const ref of seed) byId.set(ref.id, ref);
  for (const ref of imports) byId.set(ref.id, ref);
  return [...byId.values()];
}

/**
 * Try to find a confident TCG match for a friend-photo cardIdentity string.
 * The strings look like:
 *   "2020 Pokemon SWSH FA/Snorlax VMAX #142"
 *   "Tyranitar V Battle Styles #155"
 *   "2025 Pokemon DRI EN Cynthia's Garchomp ex Special Illustration Rare #232"
 *
 * Strategy: extract a primary-Pokémon name (e.g. "Snorlax VMAX") and an optional
 * card number (e.g. "142"), then query the API. We score matches by name/number
 * proximity and pick the top hit if confidence is sufficient.
 */
async function resolveIdentity(ref) {
  const tokens = parseIdentityTokens(ref.cardIdentity);
  if (!tokens.searchName) return null;
  const params = new URLSearchParams();
  // Quote name to make the search literal-ish; * matches partials in the API.
  const numberPart = tokens.cardNumber ? ` number:${tokens.cardNumber}` : "";
  params.set("q", `name:"${tokens.searchName}"${numberPart}`);
  params.set("pageSize", "10");
  const url = `${TCG_BASE.replace(/\/$/, "")}/cards?${params.toString()}`;
  const response = await fetch(url, {
    headers: TCG_KEY ? { "X-Api-Key": TCG_KEY } : {},
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("rate limited (429); set POKEMON_TCG_API_KEY for higher quota");
    throw new Error(`TCG API ${response.status}`);
  }
  const data = await response.json();
  const hits = Array.isArray(data?.data) ? data.data : [];
  if (hits.length === 0) return null;
  // Pick the best hit: prefer same number, then most recent set.
  const ranked = hits
    .map((card) => {
      const numberMatch = tokens.cardNumber && card.number === String(tokens.cardNumber);
      const setReleased = card.set?.releaseDate ?? "0000-00-00";
      return { card, score: (numberMatch ? 1000 : 0) + setReleasedToScore(setReleased) };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.card;
  if (!best?.images?.large) return null;
  return {
    imageUrl: best.images.large,
    matchedName: best.name,
    setName: best.set?.name,
    cardNumber: best.number,
    resolvedAt: new Date().toISOString(),
  };
}

function setReleasedToScore(yyyyMmDd) {
  const ts = Date.parse(yyyyMmDd);
  if (Number.isNaN(ts)) return 0;
  return Math.floor(ts / 86_400_000);
}

function parseIdentityTokens(identity) {
  const cleaned = String(identity).replace(/\s+/g, " ").trim();
  // Number suffix like "#142" or "#SM210" or "#07"
  const numberMatch = cleaned.match(/#([A-Za-z]?\d+[A-Za-z]?)\s*$/);
  const cardNumber = numberMatch ? numberMatch[1].replace(/^0+/, "") : undefined;
  // Strip leading year + brand fluff to leave the Pokémon name. Heuristic:
  // pop the dominant Pokémon noun by taking the last meaningful word group
  // before the # token, dropping decorations.
  let name = numberMatch ? cleaned.slice(0, numberMatch.index).trim() : cleaned;
  name = name
    .replace(/^\d{4}\s+/, "")
    .replace(/\bPok[eé]mon\b/gi, "")
    .replace(/\bJPN?\b|\bEN\b|\bSP\b|\bSWSH\b|\bSM\b|\bMEG\b|\bM1S\b|\bMEP\b|\bPFL\b|\bDRI\b|\bCBB3\b|\bCS\b|\bBSP\b|\bSVP\b/gi, "")
    .replace(/\b(Full Art|Special Art Rare|Special Illustration Rare|Illustration Rare|Box Topper|Ultra-Premium Collection|Elite Trainer Box|Promo|Holo|Secret|Black Star)\b/gi, "")
    .replace(/[\.\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The API matches whole words; trim trailing "ex"/"VMAX"/"V" etc only as needed.
  // We keep them — Pokémon names like "Snorlax VMAX" need them.
  // Pick the longest contiguous proper-noun-ish chunk (max 3 words) for the search.
  const tokens = name.split(" ").filter(Boolean);
  const searchName = tokens.slice(-4).join(" ");
  return { searchName, cardNumber };
}
