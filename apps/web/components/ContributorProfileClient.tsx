"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { MethodCard } from "./MethodCard";
import { contributorByHandle, methodsByContributor } from "../lib/community-methods";

export function ContributorProfileClient() {
  const params = useParams<{ handle: string }>();
  const contributor = contributorByHandle(params.handle);
  const methods = methodsByContributor(params.handle);

  if (!contributor) {
    return (
      <main className="methods-shell">
        <section className="methods-section">
          <h1>Contributor not found</h1>
          <Link className="button" href="/methods">Back to methods</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="methods-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Contributor nav">
          <Link href="/methods">Methods</Link>
          <Link href="/workspace">Workspace</Link>
          <Link href="/scan?mode=sample">Try demo</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="contributor-hero">
        <div className="contributor-avatar">{contributor.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <span className="page-kicker">Verified contributor</span>
          <h1>@{contributor.handle}</h1>
          <p>{contributor.name} - {contributor.role}</p>
          <p className="muted">{contributor.impact}</p>
          <div className="badge-row">
            {contributor.badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-stats-grid contributor-stats">
        <div className="landing-stat"><span>Verified methods</span><strong>{contributor.verifiedMethods}</strong></div>
        <div className="landing-stat"><span>Benchmark fixtures</span><strong>{contributor.benchmarkFixtures}</strong></div>
        <div className="landing-stat"><span>Corrections</span><strong>{contributor.corrections}</strong></div>
      </section>

      <section className="methods-section">
        <div className="section-header">
          <div>
            <span className="page-kicker">Contributions</span>
            <h2>Methods and research</h2>
          </div>
        </div>
        {methods.length ? (
          <div className="method-grid">
            {methods.map((method) => (
              <MethodCard method={method} key={method.id} />
            ))}
          </div>
        ) : (
          <article className="registry-card">
            <h2>No verified methods yet</h2>
            <p>This contributor is building benchmark fixtures or reviewing corrections.</p>
          </article>
        )}
      </section>
    </main>
  );
}
