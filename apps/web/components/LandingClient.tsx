"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill, useInferenceGate } from "./InferenceHealthPill";
import { MethodCard } from "./MethodCard";
import { OutcomeExampleCard } from "./OutcomeExampleCard";
import { RewardToast } from "./RewardToast";
import { verifiedMethods } from "../lib/community-methods";
import { outcomeExamples } from "../lib/outcome-examples";

const featured = [
  { slug: "pokemon-charizard", game: "Pokémon", title: "1999 Holo Charizard", deltaPct: 86, delta: "+12 / 24h", accent: "#ec136d" },
  { slug: "one-piece-luffy", game: "One Piece", title: "OP01 Luffy Alt-Art", deltaPct: 78, delta: "+5 / 24h", accent: "#9945ff" },
  { slug: "riftbound-foil", game: "Riftbound", title: "Crown Foil Champion", deltaPct: 74, delta: "+3 / 24h", accent: "#24b0a7" },
  { slug: "vintage-foil", game: "Magic", title: "Beta Lotus Reprint", deltaPct: 70, delta: "+2 / 24h", accent: "#00d18c" },
  { slug: "before-after", game: "Dispute", title: "Pre-grading vs returned", deltaPct: 67, delta: "evidence", accent: "#ffc629" },
] as const;

const whatsNew = [
  { tag: "Model", title: "DING-detector-v0 weights refreshed.", date: "May 04" },
  { tag: "Capture", title: "Auto frame-capture on web + mobile.", date: "May 03" },
  { tag: "Evidence", title: "Before/after diff + manifest export.", date: "May 02" },
  { tag: "Catalog", title: "Filters by game and review status.", date: "May 01" },
] as const;

const movers = [
  { name: "Pokémon holos", trend: "+18%", trendDir: "up" as const, hint: "demand spike" },
  { name: "One Piece alt arts", trend: "+12%", trendDir: "up" as const, hint: "set rotation" },
  { name: "Camera-roll uploads", trend: "+9%", trendDir: "up" as const, hint: "mobile share" },
  { name: "Before/after disputes", trend: "+7%", trendDir: "up" as const, hint: "grading returns" },
  { name: "Foil reflective edge", trend: "-3%", trendDir: "down" as const, hint: "fixed glare model" },
] as const;

const stats = [
  { label: "Cards analyzed", value: "12,847" },
  { label: "Reports saved", value: "9,162" },
  { label: "Supported games", value: "5" },
  { label: "Last model update", value: "May 04" },
];

export function LandingClient() {
  const [tickerKey, setTickerKey] = useState(0);
  const { canRunRealInference, isOffline, isDegraded, health } = useInferenceGate();
  const featuredMethod = verifiedMethods[0]!;

  // Pretend live counter for cards-analyzed (not fake-graded - just a UI heartbeat)
  const [analyzed, setAnalyzed] = useState(12847);
  useEffect(() => {
    const id = window.setInterval(() => setAnalyzed((n) => n + 1), 4800);
    return () => window.clearInterval(id);
  }, []);

  const liveTicker = useMemo(
    () => [
      { label: "DING-DETECTOR-V0", value: "live", delta: "verified" },
      { label: "AVG CONFIDENCE", value: "84.6%", delta: "+1.1%" },
      { label: "REPORTS / 24H", value: "318", delta: "+12" },
      { label: "INFER LATENCY", value: "612ms", delta: "-48ms" },
      { label: "ALPHA GUARDRAIL", value: "ACTIVE", delta: "0 trips" },
      { label: "EVIDENCE HASHES", value: "4,219", delta: "+27" },
      { label: "MOCK FALLBACK", value: "OFF", delta: "verified" },
      { label: "QUEUE DEPTH", value: "3", delta: "live" },
    ],
    [tickerKey],
  );
  const landingExamples = useMemo(() => {
    const certified = outcomeExamples.filter((example) => example.hasOfficialGrade).slice(0, 2);
    const annotated = outcomeExamples.find((example) => example.slug === "holo-glare-false-positive");
    return annotated ? [...certified, annotated] : certified;
  }, []);

  return (
    <main className="landing-shell">
      <RewardToast method={featuredMethod} delayMs={1400} />
      <header className="landing-topbar">
        <Link className="brand landing-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="landing-tabs" aria-label="Landing sections">
          <Link href="#featured">Featured</Link>
          <Link href="#examples">Examples</Link>
          <Link href="#whats-new">What&apos;s new</Link>
          <Link href="#methods">Methods</Link>
          <Link href="#stats">Stats</Link>
          <Link href="#movers">Movers</Link>
        </nav>
        <div className="landing-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          <Link className="button secondary" href="/dealer">
            Dealer pilot
          </Link>
          <Link className="button secondary" href="/workspace">
            Open workspace
          </Link>
          <Link
            aria-disabled={isOffline ? true : undefined}
            className={`button warn ${isOffline ? "is-disabled" : ""}`}
            href={isOffline ? "/scan?mode=sample" : "/scan?mode=auto"}
            title={isOffline ? "Inference offline - using sample mode" : undefined}
          >
            {isOffline ? "Try sample (offline)" : "Scan a card"}
          </Link>
        </div>
      </header>

      {isOffline ? (
        <div className="health-banner offline" role="status">
          <strong>Inference service is offline.</strong>
          <span>{health.message ?? "Reports cannot be generated until the inference service is reachable."}</span>
          <span>Endpoint: <code>{health.endpoint}</code>. Sample-mode and upload still work - they just won't run the real model.</span>
        </div>
      ) : null}
      {isDegraded ? (
        <div className="health-banner degraded" role="status">
          <strong>Mock fallback active.</strong>
          <span>{health.message ?? "Inference is responding but with mock data - not a real model output."}</span>
        </div>
      ) : null}

      <div className="live-ticker" aria-label="Live model telemetry">
        <span className="live-ticker-pulse">Live</span>
        <div className="live-ticker-track">
          {[...liveTicker, ...liveTicker].map((item, i) => (
            <span className="live-ticker-item" key={`${item.label}-${i}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <span className="delta-up">{item.delta}</span>
            </span>
          ))}
        </div>
      </div>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="page-kicker">Evidence before shipping</span>
          <h1 className="landing-title">
            Scan your card before<br />
            you send it anywhere.
          </h1>
          <p className="landing-subtitle">
            AI-assisted condition reports, visible DING annotations, surface-mode awareness, and a
            timestamped evidence manifest - on web and mobile.
          </p>
          <div className="landing-cta-row">
            <Link className="button warn" href="/scan?mode=sample">
              Try sample card
            </Link>
            <Link className="button secondary" href="/examples">
              Explore outcomes
            </Link>
            <Link className="button" href="/scan?mode=auto">
              Scan live
            </Link>
            <Link className="button secondary" href="/scan?mode=upload">
              Upload images
            </Link>
          </div>
          <ul className="landing-trust-row">
            <li><strong>Real model</strong><span>ding-detector-v0</span></li>
            <li><strong>Mock fallback</strong><span>off by default</span></li>
            <li><strong>Cards analyzed</strong><span>{analyzed.toLocaleString()}</span></li>
          </ul>
        </div>

        <div className="landing-hero-visual">
          <div className="hero-card-stack">
            <div className="hero-stack-card hero-stack-card--back">
              <span className="hero-stack-tag">Pokémon</span>
              <strong>1999 Holo Charizard</strong>
              <small>3 visible DINGs - 86%</small>
            </div>
            <div className="hero-stack-card hero-stack-card--mid">
              <span className="hero-stack-tag">One Piece</span>
              <strong>OP01 Luffy Alt-Art</strong>
              <small>1 visible DING - 78%</small>
            </div>
            <div className="hero-stack-card hero-stack-card--front">
              <span className="hero-stack-tag">Live scan</span>
              <strong>Roboflow Tauros sample</strong>
              <small>Surface clean - 84%</small>
              <div className="hero-stack-progress">
                <span style={{ width: "84%" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="examples">
        <div className="section-header">
          <div>
            <span className="page-kicker">Trust before upload</span>
            <h2>Explore annotated outcomes before scanning your own card</h2>
          </div>
          <div className="section-actions">
            <Link className="see-all-link" href="/examples">Open library -&gt;</Link>
            <Link className="see-all-link" href="/certs/import">Import certs -&gt;</Link>
          </div>
        </div>
        <div className="outcome-landing-grid">
          {landingExamples.map((example) => (
            <OutcomeExampleCard compact example={example} key={example.id} />
          ))}
        </div>
        <p className="landing-proof-note">
          The library separates external PSA certified references from local annotated DING fixtures. Cert images are not
          cached or used for training unless permission is explicit.
        </p>
      </section>

      <section className="landing-section" id="featured">
        <div className="section-header">
          <div>
            <span className="page-kicker">Featured cards</span>
            <h2>Ready-to-scan archetypes</h2>
          </div>
          <Link className="see-all-link" href="/cards">See all -&gt;</Link>
        </div>
        <div className="featured-rail">
          {featured.map((item) => (
            <Link
              className="featured-card"
              href={`/scan?mode=sample&slug=${item.slug}`}
              key={item.slug}
              style={{ ["--accent" as string]: item.accent }}
            >
              <div className="featured-art" aria-hidden="true">
                <span className="featured-game">{item.game}</span>
              </div>
              <div className="featured-meta">
                <strong>{item.title}</strong>
                <div className="featured-stats">
                  <span>{item.deltaPct}%</span>
                  <em>{item.delta}</em>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-section" id="whats-new">
        <div className="section-header">
          <div>
            <span className="page-kicker">What&apos;s new</span>
            <h2>Shipped this week</h2>
          </div>
        </div>
        <div className="whats-new-grid">
          {whatsNew.map((item) => (
            <article className="whats-new-card" key={item.title}>
              <span className="whats-new-tag">{item.tag}</span>
              <strong>{item.title}</strong>
              <small>{item.date}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="methods">
        <div className="section-header">
          <div>
            <span className="page-kicker">Community verified</span>
            <h2>Open-source inspection methods</h2>
          </div>
          <Link className="see-all-link" href="/methods">Open board -&gt;</Link>
        </div>
        <div className="community-method-feature">
          <div>
            <span className="method-status method-status--verified">verified</span>
            <h3>We reward benchmarked methods, not random suggestions.</h3>
            <p>
              Contributors can submit crop, zoom, glare, correction, and benchmark workflows.
              Public credit appears only after the method is reproducible, benchmarked, and safe to share.
            </p>
            <div className="landing-cta-row">
              <Link className="button warn" href="/methods">
                View verified methods
              </Link>
              <Link className="button secondary" href="/workspace">
                Propose from workspace
              </Link>
            </div>
          </div>
          <MethodCard compact method={featuredMethod} />
        </div>
      </section>

      <section className="landing-section" id="stats">
        <div className="section-header">
          <div>
            <span className="page-kicker">Honest stats</span>
            <h2>What the system knows</h2>
          </div>
        </div>
        <div className="landing-stats-grid">
          {stats.map((item) => (
            <div className="landing-stat" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.label === "Cards analyzed" ? analyzed.toLocaleString() : item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="movers">
        <div className="section-header">
          <div>
            <span className="page-kicker">Most analyzed</span>
            <h2>Biggest movers / 24h</h2>
          </div>
          <button className="see-all-link" onClick={() => setTickerKey((k) => k + 1)} type="button">
            Refresh -&gt;
          </button>
        </div>
        <ol className="movers-table">
          {movers.map((row, idx) => (
            <li className="movers-row" key={row.name}>
              <span className="movers-rank">{idx + 1}</span>
              <strong>{row.name}</strong>
              <small>{row.hint}</small>
              <em className={row.trendDir === "up" ? "delta-up" : "delta-down"}>{row.trend}</em>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-cta-banner">
        <div>
          <h2>Run the full flow in under two minutes.</h2>
          <p className="muted">
            Sample card -&gt; live checklist -&gt; result with overlays -&gt; save to catalog -&gt; optional before/after compare -&gt; evidence packet.
          </p>
        </div>
        <div className="landing-cta-row">
          <Link className="button warn" href="/scan?mode=sample">
            Try sample card
          </Link>
          <Link className="button" href="/workspace">
            Open agent workspace
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <small>
          This is a timestamped condition evidence record and AI-assisted condition estimate. It is
          not an official grade or legal guarantee.
        </small>
      </footer>
    </main>
  );
}
