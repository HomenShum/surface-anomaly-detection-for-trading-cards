"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { MethodCard } from "./MethodCard";
import { RewardToast } from "./RewardToast";
import {
  contributors as seededContributors,
  methodBounties,
  verifiedMethods as seededVerifiedMethods,
  type ContributorProfile,
  type VerifiedMethod,
  type VerifiedMethodStatus,
} from "../lib/community-methods";

const tabs = ["Featured", "Newly Verified", "In Review", "Bounties", "Top Contributors", "Open Source Registry"] as const;
type Tab = (typeof tabs)[number];

function methodIsInReview(status: VerifiedMethodStatus) {
  return status === "draft" || status === "submitted" || status === "reproducing" || status === "benchmarking";
}

type Props = {
  /** Combined list (seed + registry). Falls back to seeded when empty. */
  methods?: VerifiedMethod[];
  contributors?: ContributorProfile[];
  /** When set, RewardToast celebrates this method ID once on mount. */
  celebrateMethodId?: string;
};

export function MethodsBoardClient({ methods, contributors, celebrateMethodId }: Props = {}) {
  const allMethods = methods && methods.length > 0 ? methods : seededVerifiedMethods;
  const allContributors = contributors && contributors.length > 0 ? contributors : seededContributors;
  const [activeTab, setActiveTab] = useState<Tab>("Featured");
  const featured = useMemo(
    () =>
      allMethods.find(
        (method) => method.status === "verified" || method.status === "production",
      ) ?? allMethods[0]!,
    [allMethods],
  );
  const celebrate = useMemo(
    () => (celebrateMethodId ? allMethods.find((method) => method.id === celebrateMethodId) : null),
    [allMethods, celebrateMethodId],
  );

  const visibleMethods = useMemo(() => {
    if (activeTab === "Newly Verified")
      return allMethods.filter(
        (method) => method.status === "verified" || method.status === "production" || method.status === "canary",
      );
    if (activeTab === "In Review") return allMethods.filter((method) => methodIsInReview(method.status));
    return allMethods;
  }, [activeTab, allMethods]);

  return (
    <main className="methods-shell">
      <RewardToast method={celebrate ?? featured} delayMs={celebrate ? 0 : 900} />
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Method board">
          <Link href="/workspace">Workspace</Link>
          <Link href="/methods">Methods</Link>
          <Link href="/scan?mode=sample">Try demo</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="methods-hero">
        <div>
          <span className="page-kicker">Open-source inspection flywheel</span>
          <h1>Verified methods that make the agent inspect cards better.</h1>
          <p className="muted">
            We reward reliable, reproducible contributions: crop strategies, glare handling, benchmark fixtures,
            correction patterns, and before/after workflows. Suggestions do not become production behavior until
            they pass benchmarks and review.
          </p>
          <div className="landing-cta-row">
            <Link className="button warn" href="/methods/holo-glare-reinspection-v1">
              View featured method
            </Link>
            <Link className="button secondary" href="/workspace">
              Propose from workspace
            </Link>
            <Link className="button secondary" href="/methods/submit">
              Submit method
            </Link>
          </div>
        </div>
        <aside className="methods-hero-proof">
          <span className="method-status method-status--verified">verified</span>
          <h2>{featured.title}</h2>
          <p>{featured.remark}</p>
          <dl>
            <div><dt>Benchmark lift</dt><dd>-{featured.benchmark.falsePositiveReductionPct}% false positives</dd></div>
            <div><dt>Contributor</dt><dd>@{featured.contributorHandle}</dd></div>
            <div><dt>Reward</dt><dd>{featured.reward}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="methods-tabs" aria-label="Verified methods board tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab ? "is-active" : ""} key={tab} onClick={() => setActiveTab(tab)} type="button">
            {tab}
          </button>
        ))}
      </section>

      {activeTab === "Bounties" ? (
        <section className="methods-section">
          <div className="section-header">
            <div>
              <span className="page-kicker">Help wanted</span>
              <h2>Open benchmark bounties</h2>
            </div>
          </div>
          <div className="bounty-grid">
            {methodBounties.map((bounty) => (
              <article className="bounty-card" key={bounty}>
                <span>Open bounty</span>
                <strong>{bounty}</strong>
                <p>Submit a method, fixture pack, or correction pattern. Verified impact earns public credit and rewards.</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Top Contributors" ? (
        <section className="methods-section">
          <div className="contributor-grid">
            {allContributors.map((contributor) => (
              <Link className="contributor-card" href={`/contributors/${contributor.handle}`} key={contributor.handle}>
                <span>@{contributor.handle}</span>
                <strong>{contributor.name}</strong>
                <p>{contributor.impact}</p>
                <div>
                  <em>{contributor.verifiedMethods} verified methods</em>
                  <em>{contributor.benchmarkFixtures} fixtures</em>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Open Source Registry" ? (
        <section className="methods-section">
          <div className="registry-card">
            <span className="page-kicker">Registry path</span>
            <h2>inspection-methods/</h2>
            <p>
              Each method ships as a folder with method.yaml, benchmark.json, limitations.md, contributor.md,
              reproducibility notes, and safety notes. The public board only marks a method verified when the
              benchmark proof exists.
            </p>
            <code>inspection-methods/holo-glare-reinspection-v1/</code>
          </div>
        </section>
      ) : null}

      {activeTab !== "Bounties" && activeTab !== "Top Contributors" && activeTab !== "Open Source Registry" ? (
        <section className="methods-section">
          <div className="method-grid">
            {visibleMethods.map((method) => (
              <MethodCard method={method} key={method.id} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
