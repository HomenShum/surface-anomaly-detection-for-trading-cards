"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { ExampleCard } from "./ExampleCard";
import {
  conditionLadder,
  exampleOutcomes as seededExamples,
  type ExampleGame,
  type ExampleOutcome,
  type ExampleTier,
  type FailureMode,
} from "../lib/examples/registry";

type Props = {
  /** Server-loaded merged list (seeded + Gold). Falls back to seeded when omitted. */
  examples?: ExampleOutcome[];
};

const GAMES: ExampleGame[] = ["pokemon", "one-piece", "riftbound", "mtg", "sports", "other"];
const TIERS: ExampleTier[] = ["gold", "silver_plus", "silver", "bronze", "demo"];
const FAILURES: FailureMode[] = [
  "false_positive_glare",
  "false_positive_pattern",
  "false_positive_dark_border",
  "false_negative_subtle_dent",
  "false_negative_back_edge",
  "low_confidence_capture",
  "unsupported_finish",
];

export function ExampleGalleryClient({ examples }: Props = {}) {
  const list = examples && examples.length > 0 ? examples : seededExamples;
  const [game, setGame] = useState<ExampleGame | "all">("all");
  const [tier, setTier] = useState<ExampleTier | "all">("all");
  const [showFailuresOnly, setShowFailuresOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return list.filter((entry) => {
      if (game !== "all" && entry.game !== game) return false;
      if (tier !== "all" && entry.tier !== tier) return false;
      if (showFailuresOnly && !entry.failureMode) return false;
      if (search.trim()) {
        const lc = search.toLowerCase();
        if (
          !entry.title.toLowerCase().includes(lc) &&
          !entry.tags.some((tag) => tag.toLowerCase().includes(lc))
        )
          return false;
      }
      return true;
    });
  }, [list, game, tier, showFailuresOnly, search]);

  const counts = {
    total: list.length,
    gold: list.filter((entry) => entry.tier === "gold").length,
    silverPlus: list.filter((entry) => entry.tier === "silver_plus").length,
    silver: list.filter((entry) => entry.tier === "silver").length,
    bronze: list.filter((entry) => entry.tier === "bronze").length,
    demo: list.filter((entry) => entry.tier === "demo").length,
    failures: list.filter((entry) => entry.failureMode).length,
    matched: list.filter((entry) => entry.ourPrediction.matchedKnownOutcome === true).length,
  };

  return (
    <main className="examples-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Examples nav">
          <Link href="/examples">Examples</Link>
          <Link href="/certs/import">Cert import</Link>
          <Link href="/methods">Verified methods</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/scan?mode=sample">Try sample</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="examples-hero">
        <div>
          <span className="page-kicker">Verified Outcome Library</span>
          <h1>Inspect the inspection before you trust the scanner.</h1>
          <p className="muted" style={{ maxWidth: 740 }}>
            Real official outcomes are linked as PSA cert references. Real DING annotations come from
            local/open fixtures with rights metadata. Every example shows what can be trained on, what is
            public-reference only, and what remains uncertain. No official-grade claims.
          </p>
          <div className="examples-summary-row">
            <div>
              <span>Examples</span>
              <strong>{counts.total}</strong>
            </div>
            <div>
              <span>Matched outcome</span>
              <strong>{counts.matched}</strong>
            </div>
            <div>
              <span>Failure cases</span>
              <strong>{counts.failures}</strong>
            </div>
            <div>
              <span>Trust tiers</span>
              <strong>
                {counts.gold}G · {counts.silverPlus}S+ · {counts.silver}S · {counts.bronze}B · {counts.demo}D
              </strong>
            </div>
          </div>
        </div>
        <aside className="examples-ladder-card">
          <span className="page-kicker">Our condition ladder</span>
          <h2>0–1000 benchmark band</h2>
          <ul>
            {conditionLadder.map((entry) => (
              <li key={entry.band}>
                <strong>{entry.range}</strong>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
          <small>
            Not a TAG Score. Not a PSA grade. Internal benchmark only — calibrated against the
            outcomes shown on this page.
          </small>
        </aside>
      </section>

      <section className="examples-filters" aria-label="Filters">
        <div>
          <label htmlFor="examples-game">Game</label>
          <select
            id="examples-game"
            onChange={(event) => setGame(event.target.value as typeof game)}
            value={game}
          >
            <option value="all">All</option>
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {g.replace("-", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="examples-tier">Trust tier</label>
          <select
            id="examples-tier"
            onChange={(event) => setTier(event.target.value as typeof tier)}
            value={tier}
          >
            <option value="all">All</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="examples-search">Search</label>
          <input
            id="examples-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="title, tag, set name…"
            type="text"
            value={search}
          />
        </div>
        <label className="examples-failure-toggle">
          <input
            checked={showFailuresOnly}
            onChange={(event) => setShowFailuresOnly(event.target.checked)}
            type="checkbox"
          />
          <span>Failure cases only ({counts.failures})</span>
        </label>
      </section>

      <section className="examples-grid">
        {filtered.length === 0 ? (
          <p className="muted">No examples match your filters.</p>
        ) : (
          filtered.map((example) => <ExampleCard example={example} key={example.id} />)
        )}
      </section>
    </main>
  );
}
