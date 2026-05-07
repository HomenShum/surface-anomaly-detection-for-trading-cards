#!/usr/bin/env node
/**
 * Build data/cert-references/identity-cache.json from seed.json.
 *
 * For each PSA reference, try to resolve an identity image URL via the
 * public Pokémon TCG API (https://pokemontcg.io). Best-effort:
 *   - Parse the cardIdentity string for name + number hints
 *   - Query name:"..." and pick the first hit (preferring number match)
 *   - Cache imageUrl + matchedName + setName
 *
 * Records that don't resolve (Japanese-only sets, TAG/non-Pokémon refs) are
 * skipped entirely — the loader falls back to the "deep-link only"
 * placeholder gracefully.
 *
 *   node scripts/certs/build_identity_cache.mjs           → write cache
 *   node scripts/certs/build_identity_cache.mjs --dry-run → preview only
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED_PATH = join(ROOT, "data", "cert-references", "seed.json");
const CACHE_PATH = join(ROOT, "data", "cert-references", "identity-cache.json");
const DRY_RUN = process.argv.includes("--dry-run");

function parseIdentity(cardIdentity) {
  // Examples (representative):
  //   "2025 Pokemon Japanese SV11B-Black Bolt #174 Zekrom ex BW Rare"
  //   "Tyranitar V Battle Styles #155"
  //   "2020 Pokemon SWSH FA/Snorlax VMAX #142"
  //   "Meowth #07"
  //   "1999 Pokemon Fossil Dragonite-Holo #4"
  if (!cardIdentity) return null;
  const text = cardIdentity.trim();
  const numMatch = text.match(/#(\d{1,4}[a-z]?)/i);
  const number = numMatch ? numMatch[1] : null;
  const beforeHash = numMatch ? text.slice(0, numMatch.index) : text;
  const afterHash = numMatch ? text.slice(numMatch.index + numMatch[0].length) : "";
  const cleaned = `${beforeHash} ${afterHash}`
    .replace(/^\d{4}\s+/, "")
    .replace(/Pokemon\s+(Japanese\s+)?/i, "")
    .replace(/[A-Z]{2,5}\d?[A-Z]?-?[A-Z]?/g, " ")
    .replace(/\bFA\b\/?/gi, "")
    .replace(/\bHolo\b/gi, "")
    .replace(/\bRare\b/gi, "")
    .replace(/\bPromo\b/gi, "")
    .replace(/\bBox Topper\b/gi, "")
    .replace(/\bElite Trainer Box\b/gi, "")
    .replace(/\bUltra-Premium Collection\b/gi, "")
    .replace(/\bSpecial Illustration\b/gi, "")
    .replace(/\bSpecial Art\b/gi, "")
    .replace(/\bIllustration\b/gi, "")
    .replace(/\b(BW|GS|GX|VMAX|VSTAR|EX|V|ex)\b/g, (m) => m)
    .replace(/[\/\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The first word(s) are usually the card name. Take up to 4 words to
  // anchor the search (heuristic, will be refined by API ranking).
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let nameGuess = "";
  for (const tok of tokens.slice(0, 6)) {
    nameGuess += (nameGuess ? " " : "") + tok;
    if (/(ex|GX|V|VMAX|VSTAR)$/i.test(tok)) break;
  }
  return { nameGuess: nameGuess || tokens[0] || "", number, raw: cardIdentity };
}

async function searchPokemonTcg(nameGuess, number) {
  // The pokemontcg.io API supports name + number filters.
  // No API key needed for low-volume queries.
  const params = new URLSearchParams();
  const q = number ? `name:"${nameGuess}" number:${number}` : `name:"${nameGuess}"`;
  params.set("q", q);
  params.set("pageSize", "5");
  const url = `https://api.pokemontcg.io/v2/cards?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const j = await res.json();
  return j?.data ?? [];
}

function pickBest(hits, parsed) {
  if (!hits.length) return null;
  // Prefer number match if any; otherwise first result.
  if (parsed.number) {
    const exact = hits.find((h) => String(h.number ?? "").toLowerCase() === parsed.number.toLowerCase());
    if (exact) return exact;
  }
  return hits[0];
}

async function main() {
  if (!existsSync(SEED_PATH)) {
    console.error(`Missing seed: ${SEED_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
  const records = Array.isArray(raw) ? raw : raw.records ?? raw.references ?? [];

  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf-8")) : {};
  let added = 0;
  let kept = 0;
  let skipped = 0;
  const failures = [];

  for (const r of records) {
    const id = r.id;
    if (!id) { skipped++; continue; }
    if (cache[id]?.imageUrl) { kept++; continue; }
    if (!r.publicExampleAllowed) { skipped++; continue; }

    const parsed = parseIdentity(r.cardIdentity ?? "");
    if (!parsed?.nameGuess) {
      failures.push({ id, reason: "could not parse identity", raw: r.cardIdentity });
      skipped++;
      continue;
    }

    let hits = [];
    try {
      hits = await searchPokemonTcg(parsed.nameGuess, parsed.number);
      if (hits.length === 0 && parsed.number) {
        // Retry without number filter — Japanese sets often missing.
        hits = await searchPokemonTcg(parsed.nameGuess, null);
      }
    } catch (e) {
      failures.push({ id, reason: `api error: ${String(e?.message ?? e).slice(0, 200)}` });
      skipped++;
      continue;
    }

    const best = pickBest(hits, parsed);
    if (!best?.images?.large) {
      failures.push({ id, reason: "no match", nameGuess: parsed.nameGuess, number: parsed.number });
      skipped++;
      continue;
    }
    cache[id] = {
      imageUrl: best.images.large,
      matchedName: best.name,
      setName: best.set?.name ?? null,
      setId: best.set?.id ?? null,
      number: best.number ?? null,
      source: "pokemontcg.io",
      builtAt: new Date().toISOString(),
    };
    added++;
    process.stderr.write(`✓ ${id} → ${best.name} (${best.set?.name})\n`);
    // Soft rate-limit: 4 req/sec is well under any quota.
    await new Promise((r) => setTimeout(r, 250));
  }

  const summary = { total: records.length, added, kept, skipped, failures };
  if (DRY_RUN) {
    console.log("DRY RUN — would write:", JSON.stringify(summary, null, 2));
    return;
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote:", CACHE_PATH);
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
