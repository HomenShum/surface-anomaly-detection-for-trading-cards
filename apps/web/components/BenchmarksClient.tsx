import Link from "next/link";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { dataSourceTiers, exampleOutcomes } from "../lib/examples/registry";
import { benchmarkSummary } from "../lib/outcome-examples";

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function BenchmarksClient() {
  return (
    <main className="outcome-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Benchmarks nav">
          <Link href="/examples">Examples</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/methods">Methods</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="outcome-hero">
        <div>
          <span className="page-kicker">Model transparency</span>
          <h1>Performance numbers a collector can actually interpret.</h1>
          <p className="muted">
            Aggregate mAP is not enough. This page separates official-claim guardrails, cohort weaknesses, known failure
            modes, and the examples users can inspect before trusting a scan.
          </p>
        </div>
        <aside className="outcome-trust-card">
          <span className="method-status method-status--verified">{benchmarkSummary.modelVersion}</span>
          <h2>Current real model</h2>
          <p>Training run {benchmarkSummary.trainingRunId}. Manifest hash {benchmarkSummary.manifestHash.slice(0, 12)}...</p>
        </aside>
      </section>

      <section className="benchmark-metrics">
        <article><span>Precision</span><strong>{pct(benchmarkSummary.overall.precision)}</strong></article>
        <article><span>Recall</span><strong>{pct(benchmarkSummary.overall.recall)}</strong></article>
        <article><span>mAP@50</span><strong>{pct(benchmarkSummary.overall.map50)}</strong></article>
        <article><span>mAP@50-95</span><strong>{pct(benchmarkSummary.overall.map5095)}</strong></article>
      </section>

      <section className="benchmark-table-section">
        <div className="section-header">
          <div>
            <span className="page-kicker">Cohorts</span>
            <h2>Where the model is stronger and weaker</h2>
          </div>
        </div>
        <div className="benchmark-table">
          <div className="benchmark-row benchmark-row--head">
            <span>Cohort</span>
            <span>Precision</span>
            <span>Recall</span>
            <span>Trust note</span>
          </div>
          {benchmarkSummary.cohorts.map((row) => (
            <div className="benchmark-row" key={row.cohort}>
              <strong>{row.cohort}</strong>
              <span>{pct(row.precision)}</span>
              <span>{pct(row.recall)}</span>
              <p>{row.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="benchmark-table-section">
        <div className="section-header">
          <div>
            <span className="page-kicker">Data tiers</span>
            <h2>Certified references are not training data</h2>
          </div>
        </div>
        <div className="benchmark-table">
          <div className="benchmark-row benchmark-row--head benchmark-row--tiers">
            <span>Tier</span>
            <span>Source</span>
            <span>Public use</span>
            <span>Training use</span>
            <span>Trust</span>
          </div>
          {dataSourceTiers.map((row) => (
            <div className="benchmark-row benchmark-row--tiers" key={row.tier}>
              <strong>{row.tier}</strong>
              <p>{row.source}</p>
              <p>{row.publicUse}</p>
              <p>{row.trainingUse}</p>
              <span>{row.trust}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="outcome-explain-grid">
        <article className="outcome-panel">
          <h2>What we still need</h2>
          <ul>
            <li>Cert-linked PSA/TAG/CGC examples with user consent.</li>
            <li>Separate benchmark packs for holo, textured foil, dark borders, and clean cards.</li>
            <li>Grade-impact labels that distinguish visual issues from material DINGs.</li>
          </ul>
        </article>
        <article className="outcome-panel">
          <h2>Guardrails</h2>
          <ul>
            <li>No official grade claims from the model.</li>
            <li>No authenticity or market-value inference.</li>
            <li>Unsupported finishes get low-confidence guidance instead of fake certainty.</li>
          </ul>
        </article>
        <article className="outcome-panel">
          <h2>Inspectable examples</h2>
          <p>{exampleOutcomes.length} examples are available now, including certified references, open DING fixtures, and failure notes.</p>
          <Link className="button warn" href="/examples">Open examples</Link>
        </article>
      </section>
    </main>
  );
}
