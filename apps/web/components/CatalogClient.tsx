"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { conditionSummary, scoreLabel, type VaultItem } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";
import { useVault } from "./useVault";

type GameFilter = "all" | VaultItem["game"];
type ReviewFilter = "all" | "needs-review" | "ready" | "premium-foil" | "before-after";

const gameLabels: Record<GameFilter, string> = {
  all: "All games",
  pokemon: "Pokémon",
  sports: "Sports",
  "one-piece": "One Piece",
  magic: "Magic",
  unknown: "Unknown",
};

const reviewLabels: Record<ReviewFilter, string> = {
  all: "All",
  "needs-review": "Needs review",
  ready: "Ready",
  "premium-foil": "Premium foil",
  "before-after": "Before/after",
};

function isPremiumFoil(item: VaultItem) {
  return /foil|holo|alt|secret|reflective/i.test(`${item.title} ${item.variant}`);
}

function hasBeforeAfter(item: VaultItem) {
  return Boolean(item.imageDataUrl && item.backImageDataUrl);
}

function isNeedsReview(item: VaultItem) {
  return /review|unsure|uncertain/i.test(item.grade) || item.confidence < 0.7;
}

export function CatalogClient() {
  const { items } = useVault();
  const [game, setGame] = useState<GameFilter>("all");
  const [review, setReview] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (game !== "all" && item.game !== game) return false;
      if (review === "needs-review" && !isNeedsReview(item)) return false;
      if (review === "ready" && isNeedsReview(item)) return false;
      if (review === "premium-foil" && !isPremiumFoil(item)) return false;
      if (review === "before-after" && !hasBeforeAfter(item)) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = `${item.title} ${item.setName} ${item.variant} ${item.notes}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [items, game, review, search]);

  const counts = useMemo(() => {
    return {
      total: items.length,
      needsReview: items.filter(isNeedsReview).length,
      premium: items.filter(isPremiumFoil).length,
      beforeAfter: items.filter(hasBeforeAfter).length,
    };
  }, [items]);

  return (
    <main className="catalog-shell">
      <header className="catalog-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <div className="catalog-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <Link className="button secondary" href="/workspace">
            Workspace
          </Link>
          <Link className="button warn" href="/scan?mode=auto">
            Scan a card
          </Link>
        </div>
      </header>

      <section className="catalog-hero">
        <div>
          <span className="page-kicker">Evidence vault</span>
          <h1>Cards</h1>
          <p className="muted">
            {counts.total} records - {counts.needsReview} need review - {counts.premium} premium foil - {counts.beforeAfter} with before/after.
          </p>
        </div>
        <Link className="button" href="/cards/new">
          + New card
        </Link>
      </section>

      <section className="catalog-filters" aria-label="Catalog filters">
        <input
          className="catalog-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, set, variant, notes..."
          type="search"
          value={search}
        />
        <div className="catalog-filter-group" role="radiogroup" aria-label="Game">
          {(Object.keys(gameLabels) as GameFilter[]).map((key) => (
            <button
              aria-checked={game === key}
              className={`filter-chip ${game === key ? "is-active" : ""}`}
              key={key}
              onClick={() => setGame(key)}
              role="radio"
              type="button"
            >
              {gameLabels[key]}
            </button>
          ))}
        </div>
        <div className="catalog-filter-group" role="radiogroup" aria-label="Review status">
          {(Object.keys(reviewLabels) as ReviewFilter[]).map((key) => (
            <button
              aria-checked={review === key}
              className={`filter-chip ${review === key ? "is-active" : ""}`}
              key={key}
              onClick={() => setReview(key)}
              role="radio"
              type="button"
            >
              {reviewLabels[key]}
            </button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="catalog-empty">
          <h2>No matches</h2>
          <p className="muted">
            Adjust the filters or <Link href="/scan?mode=sample">run the sample scan</Link> to seed the vault.
          </p>
        </section>
      ) : (
        <section className="catalog-grid">
          {filtered.map((item) => (
            <article className="catalog-card" key={item.id}>
              <div className="catalog-card-image">
                <DingOverlay
                  alt={item.title}
                  detections={item.detections.slice(0, 2)}
                  imageDataUrl={item.imageDataUrl}
                />
              </div>
              <div className="catalog-card-body">
                <div className="catalog-card-head">
                  <strong>{item.title}</strong>
                  <span className="market-pill">{scoreLabel(item.edgeScore)}</span>
                </div>
                <small className="muted">
                  {gameLabels[item.game] ?? item.game} - {item.setName} - {item.variant}
                </small>
                <p className="catalog-card-summary">{conditionSummary(item)}</p>
                <div className="catalog-card-meta">
                  <span>
                    <em>{Math.round(item.confidence * 100)}%</em>
                    confidence
                  </span>
                  <span>
                    <em>{item.detections.length}</em>
                    DINGs
                  </span>
                  <span>
                    <em>{new Date(item.scannedAt).toLocaleDateString()}</em>
                    scanned
                  </span>
                </div>
                <div className="scorebar" aria-label={`Surface score ${item.surfaceScore}`}>
                  <span style={{ width: `${item.surfaceScore}%` }} />
                </div>
                <div className="catalog-card-actions">
                  <Link className="button secondary" href={`/cards/${item.id}`}>
                    Open
                  </Link>
                  <Link className="button" href={`/cards/${item.id}/report`}>
                    Report
                  </Link>
                  {hasBeforeAfter(item) ? (
                    <Link className="button secondary" href={`/compare?id=${item.id}`}>
                      Compare
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
