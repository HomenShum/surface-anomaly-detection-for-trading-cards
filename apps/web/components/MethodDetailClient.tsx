"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";
import { MethodCard } from "./MethodCard";
import { methodBySlug, verifiedMethods, type VerifiedMethod } from "../lib/community-methods";

type Props = {
  method?: VerifiedMethod;
  relatedMethods?: VerifiedMethod[];
};

export function MethodDetailClient({ method: methodFromProps, relatedMethods }: Props = {}) {
  const params = useParams<{ id: string }>();
  const method = methodFromProps ?? methodBySlug(params.id);
  const related =
    relatedMethods ??
    verifiedMethods.filter((entry) => entry.id !== method?.id).slice(0, 2);

  if (!method) {
    return (
      <main className="methods-shell">
        <section className="methods-section">
          <h1>Method not found</h1>
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
        <nav className="methods-nav" aria-label="Method detail nav">
          <Link href="/methods">Methods</Link>
          <Link href={`/contributors/${method.contributorHandle}`}>Contributor</Link>
          <Link href="/workspace">Workspace</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="method-detail-hero">
        <div>
          <span className={`method-status method-status--${method.status}`}>{method.status}</span>
          <h1>{method.title}</h1>
          <p className="muted">{method.problem}</p>
          <blockquote>{method.publicRemark}</blockquote>
        </div>
        <aside className="method-reward-card">
          <span className="page-kicker">Contributor reward</span>
          <h2>{method.reward}</h2>
          <p>Credited to @{method.contributorHandle}. Attribution appears in reports when this method runs.</p>
          <Link className="button warn" href={`/contributors/${method.contributorHandle}`}>
            View contributor
          </Link>
        </aside>
      </section>

      <section className="method-detail-grid">
        <article className="method-detail-card">
          <h2>Method sequence</h2>
          <ol>
            {method.method.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
        <article className="method-detail-card">
          <h2>Benchmark proof</h2>
          <dl>
            <div><dt>Fixture pack</dt><dd>{method.benchmark.fixturePack}</dd></div>
            <div><dt>False positives</dt><dd>-{method.benchmark.falsePositiveReductionPct}%</dd></div>
            <div><dt>Precision lift</dt><dd>+{method.benchmark.precisionLiftPct}%</dd></div>
            <div><dt>Recall lift</dt><dd>+{method.benchmark.recallLiftPct}%</dd></div>
            <div><dt>Latency cost</dt><dd>+{method.benchmark.latencyAddedMs}ms</dd></div>
          </dl>
        </article>
        <article className="method-detail-card">
          <h2>Safety and limitations</h2>
          <p>{method.limitation}</p>
          <ul>
            <li>No raw user images are made public by default.</li>
            <li>Raw chat remarks are rewritten into approved public remarks before publication.</li>
            <li>No official grade or legal-proof claim is allowed.</li>
            <li>Production rollout requires benchmark pass and human approval.</li>
          </ul>
        </article>
        <article className="method-detail-card">
          <h2>Open-source registry</h2>
          <p>Source folder:</p>
          <code>{method.mergedPr}</code>
          <p>Version hash:</p>
          <code>{method.versionHash}</code>
          <p>Source:</p>
          <code>{method.source}</code>
        </article>
        <article className="method-detail-card">
          <h2>Reward events</h2>
          <ol>
            {method.rewardEvents.map((event) => (
              <li key={`${event.type}-${event.createdAt}`}>
                <strong>{event.type.replaceAll("_", " ")}</strong>
                <span>{event.label}</span>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="methods-section">
        <div className="section-header">
          <div>
            <span className="page-kicker">Related methods</span>
            <h2>More community research</h2>
          </div>
        </div>
        <div className="method-grid">
          {related.map((entry) => (
            <MethodCard compact method={entry} key={entry.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
