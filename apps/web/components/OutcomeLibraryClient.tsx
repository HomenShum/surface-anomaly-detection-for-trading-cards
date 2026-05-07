"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { OutcomeExampleCard } from "./OutcomeExampleCard";
import { outcomeExamples } from "../lib/outcome-examples";

const filters = ["All", "Official refs", "Training data", "Matched", "Failure notes", "Holo risk", "Dominant DING"] as const;
type Filter = (typeof filters)[number];

export function OutcomeLibraryClient() {
  const [activeFilter, setActiveFilter] = useState<Filter>("All");

  const visible = useMemo(() => {
    if (activeFilter === "Matched") return outcomeExamples.filter((example) => example.result === "matched_band");
    if (activeFilter === "Official refs") return outcomeExamples.filter((example) => example.sourceType === "certified_reference");
    if (activeFilter === "Training data") return outcomeExamples.filter((example) => example.useForTraining);
    if (activeFilter === "Failure notes") {
      return outcomeExamples.filter((example) => example.result === "overcalled" || example.result === "missed_issue");
    }
    if (activeFilter === "Holo risk") return outcomeExamples.filter((example) => example.finishType === "holo");
    if (activeFilter === "Dominant DING") {
      return outcomeExamples.filter((example) => example.dings.some((ding) => ding.materiality === "dominant_ding"));
    }
    return outcomeExamples;
  }, [activeFilter]);

  return (
    <main className="outcome-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Outcome library">
          <Link href="/examples">Examples</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/methods">Methods</Link>
          <Link href="/scan?mode=sample">Try demo</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="outcome-hero">
        <div>
          <span className="page-kicker">Verified outcome library</span>
          <h1>Inspect the inspection before trusting your own scan.</h1>
          <p className="muted">
            Explore annotated examples with known outcomes, visible DINGs, materiality, confidence, provenance, source
            rights, and failure notes. Certified references are linked outcome records, not detector training data.
          </p>
          <div className="landing-cta-row">
            <Link className="button warn" href="/examples/holo-glare-false-positive">
              Inspect failure case
            </Link>
            <Link className="button secondary" href="/benchmarks">
              View benchmark limits
            </Link>
          </div>
        </div>
        <aside className="outcome-trust-card">
          <span className="method-status method-status--benchmarking">trust tiers</span>
          <h2>Provenance is part of the product.</h2>
          <p>
            Gold means user-consented scan plus official outcome and human DING review. Silver can mean external cert
            reference or human-reviewed fixture. Bronze means open DING dataset. The app should never hide which one you
            are seeing.
          </p>
        </aside>
      </section>

      <section className="methods-tabs" aria-label="Outcome filters">
        {filters.map((filter) => (
          <button className={activeFilter === filter ? "is-active" : ""} key={filter} onClick={() => setActiveFilter(filter)} type="button">
            {filter}
          </button>
        ))}
      </section>

      <section className="outcome-grid" aria-label="Outcome examples">
        {visible.map((example) => (
          <OutcomeExampleCard example={example} key={example.id} />
        ))}
      </section>
    </main>
  );
}
