import Link from "next/link";
import {
  loadMethodTraces,
  loadSkillProposals,
  loadSkills,
} from "../../lib/agent/skill-store";
import { loadAllBenchmarkRuns, loadBenchmarkRunsForSkill } from "../../lib/agent/benchmark-runs";
import { INSPECTION_SKILL_EVOLUTION_RULES } from "../../lib/agent/inspection-skill-evolution";
import { SkillActions } from "../../components/SkillActions";
import { ClusterButton } from "../../components/ClusterButton";

export const dynamic = "force-dynamic";

function formatTrigger(trigger: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(trigger)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "(no trigger)";
}

export default async function SkillsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const tab = params.tab ?? "promoted";

  const promoted = loadSkills("promoted");
  const drafts = loadSkills("drafts");
  const proposals = loadSkillProposals(20);
  const traces = loadMethodTraces(20);
  const benchmarkRuns = loadAllBenchmarkRuns(40);

  return (
    <main className="skills-shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <span className="page-kicker">Operator view · file-backed</span>
          <h1>Inspection skill registry</h1>
          <p className="muted" style={{ maxWidth: 720, margin: "8px 0 0" }}>
            Live state of <code>data/skills/</code>. The agent reads promoted skills via{" "}
            <code>lookup_promoted_skill</code> and writes self-proposed candidates here. Promotion to production
            requires benchmark + human approval — never automatic.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <Link className="button secondary" href="/methods">
            Public methods board
          </Link>
          <ClusterButton />
        </div>
      </header>

      <nav className="skills-page-tabs" aria-label="Registry sections">
        <Link className={tab === "promoted" ? "is-active" : ""} href="/skills?tab=promoted">
          <button className={tab === "promoted" ? "is-active" : ""} type="button">
            Promoted ({promoted.length})
          </button>
        </Link>
        <Link className={tab === "drafts" ? "is-active" : ""} href="/skills?tab=drafts">
          <button className={tab === "drafts" ? "is-active" : ""} type="button">
            Drafts ({drafts.length})
          </button>
        </Link>
        <Link className={tab === "proposals" ? "is-active" : ""} href="/skills?tab=proposals">
          <button className={tab === "proposals" ? "is-active" : ""} type="button">
            Proposals ({proposals.length})
          </button>
        </Link>
        <Link className={tab === "traces" ? "is-active" : ""} href="/skills?tab=traces">
          <button className={tab === "traces" ? "is-active" : ""} type="button">
            Recent traces ({traces.length})
          </button>
        </Link>
        <Link className={tab === "rules" ? "is-active" : ""} href="/skills?tab=rules">
          <button className={tab === "rules" ? "is-active" : ""} type="button">
            Guardrails
          </button>
        </Link>
      </nav>

      {tab === "promoted" || tab === "drafts" ? (
        <section className="skills-grid">
          {(tab === "promoted" ? promoted : drafts).map((skill) => {
            const skillBenchmarks = loadBenchmarkRunsForSkill(skill.skillId, 3);
            return (
              <article className="skills-card" key={skill.skillId}>
                <span className="skills-card-status" data-status={skill.status}>
                  {skill.status}
                </span>
                <h3>{skill.title}</h3>
                <code style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{skill.skillId}</code>
                <div className="skills-card-trigger">trigger: {formatTrigger(skill.trigger)}</div>
                <ul className="skills-card-steps">
                  {skill.steps.map((step, idx) => (
                    <li key={`${skill.skillId}-step-${idx}`}>
                      <code>{step.tool}</code> — {step.purpose}
                      {step.region ? <em style={{ color: "rgba(255,255,255,0.55)" }}> ({step.region})</em> : null}
                    </li>
                  ))}
                </ul>
                {skillBenchmarks.length > 0 ? (
                  <ul className="skills-card-benchmarks">
                    {skillBenchmarks.map((run) => (
                      <li key={run.benchmarkId} className={run.summary.passed ? "ok" : "fail"}>
                        <span>{run.summary.passed ? "✓" : "✗"}</span>
                        <code>{run.benchmarkId.slice(-12)}</code>
                        <em>
                          {run.fixtures.filter((f) => f.passed).length}/{run.fixtures.length} fixtures · {run.summary.latencyAddedMs}ms
                        </em>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small style={{ color: "rgba(255,255,255,0.45)" }}>No benchmarks yet.</small>
                )}
                <small style={{ color: "rgba(255,255,255,0.45)" }}>
                  consent: {skill.consentScope} · shares: {String(skill.evidencePolicy.sharesAcrossUsers)}
                </small>
                <SkillActions skillId={skill.skillId} status={skill.status} />
              </article>
            );
          })}
          {(tab === "promoted" ? promoted : drafts).length === 0 ? (
            <p className="muted">
              No skills in this folder yet. Drafts arrive when agents call <code>propose_inspection_method</code> or when{" "}
              <em>Cluster traces → drafts</em> turns recurring patterns into candidates.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === "proposals" ? (
        <section className="skills-grid">
          {proposals.length === 0 ? (
            <p className="muted">
              No proposals logged yet. Open a report and ask the agent something tricky — when it spots a reusable
              pattern, it will call <code>propose_inspection_method</code> and the proposal will land here.
            </p>
          ) : (
            proposals.map((proposal) => (
              <article className="skills-card" key={proposal.proposalId}>
                <span className="skills-card-status" data-status="draft">
                  proposed
                </span>
                <h3>{proposal.proposed.title}</h3>
                <code style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{proposal.proposalId}</code>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", margin: 0 }}>{proposal.rationale}</p>
                <div className="skills-card-trigger">
                  trigger: {formatTrigger(proposal.proposed.trigger as Record<string, unknown>)}
                </div>
                <small style={{ color: "rgba(255,255,255,0.45)" }}>
                  source: {proposal.source} · {new Date(proposal.ts).toLocaleString()}
                </small>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "traces" ? (
        <section className="skills-grid">
          {traces.length === 0 ? (
            <p className="muted">No traces yet. Each agent run writes one anonymized record to <code>candidates.jsonl</code>.</p>
          ) : (
            traces.map((trace) => (
              <article className="skills-card" key={trace.traceId}>
                <span className="skills-card-status" data-status={trace.outcome.refusedAsUngrounded ? "rejected" : "staging"}>
                  {trace.outcome.refusedAsUngrounded ? "ungrounded" : "ok"}
                </span>
                <code style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{trace.traceId}</code>
                <p style={{ fontSize: 12, margin: 0 }}>
                  intent <em>{trace.reportContext.userIntentBucket}</em> · finish{" "}
                  <em>{trace.reportContext.finishType ?? "unknown"}</em> · findings{" "}
                  <em>{trace.reportContext.findingsCount}</em>
                </p>
                <ul className="skills-card-steps">
                  {trace.toolSequence.map((step, idx) => (
                    <li key={`${trace.traceId}-tool-${idx}`}>
                      <code>{step.tool}</code> · {step.durationMs}ms · {step.ok ? "ok" : "fail"}
                    </li>
                  ))}
                </ul>
                <small style={{ color: "rgba(255,255,255,0.45)" }}>
                  {trace.modelProvider} / {trace.modelName} · {new Date(trace.ts).toLocaleString()}
                </small>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "rules" ? (
        <section className="skills-grid">
          <article className="skills-card" style={{ gridColumn: "1 / -1" }}>
            <span className="skills-card-status" data-status="production">
              immutable
            </span>
            <h3>Guardrails — these never relax</h3>
            <ul className="skills-card-steps">
              {INSPECTION_SKILL_EVOLUTION_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}
    </main>
  );
}
