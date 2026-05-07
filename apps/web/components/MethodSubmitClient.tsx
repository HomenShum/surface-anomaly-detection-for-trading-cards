"use client";

import Link from "next/link";
import { useState } from "react";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";

const defaultRemark =
  "For holo cards, compare a tilted low-glare crop before confirming that a surface line is a scratch.";

export function MethodSubmitClient() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);

  return (
    <main className="methods-shell">
      <header className="methods-topbar">
        <Link className="brand report-brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <nav className="methods-nav" aria-label="Method submit nav">
          <Link href="/methods">Methods</Link>
          <Link href="/workspace">Workspace</Link>
          <Link href="/scan?mode=sample">Try demo</Link>
        </nav>
        <div className="methods-top-actions">
          <AlphaBadge />
          <InferenceHealthPill />
        </div>
      </header>

      <section className="methods-hero method-submit-hero">
        <div>
          <span className="page-kicker">Submit a method candidate</span>
          <h1>Turn a useful inspection idea into benchmarkable community research.</h1>
          <p className="muted">
            Use this when a collector, reviewer, or agent chat discovers a repeatable way to scan better, detect
            better, or explain uncertainty better. Submission creates a draft only; verified public credit requires
            benchmark proof, consent, and human review.
          </p>
        </div>
        <aside className="methods-hero-proof">
          <span className="method-status method-status--draft">draft first</span>
          <h2>No public credit without proof</h2>
          <p>
            Raw remarks and card images stay private unless the contributor explicitly opts in. Public cards show an
            approved summary, benchmark impact, limitations, contributor, and version hash.
          </p>
        </aside>
      </section>

      <section className="method-submit-grid">
        <form
          className="method-submit-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setSubmitError(null);
            setSubmitted(false);
            const form = new FormData(event.currentTarget);
            try {
              const response = await fetch("/api/methods/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  handle: String(form.get("handle") ?? ""),
                  remark: String(form.get("remark") ?? ""),
                  problem: String(form.get("problem") ?? ""),
                  steps: String(form.get("steps") ?? ""),
                  publicRemarkConsent: form.get("publicRemarkConsent") === "on",
                  noRawImageConsent: form.get("noRawImageConsent") === "on",
                }),
              });
              const body = await response.json();
              if (!response.ok) throw new Error(String(body.error ?? "Submission failed."));
              setProposalId(String(body.proposalId ?? body.skillId ?? "draft"));
              setSubmitted(true);
            } catch (error) {
              setSubmitError(error instanceof Error ? error.message : "Submission failed.");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label>
            Contributor handle
            <input name="handle" placeholder="@collector-methods" required />
          </label>
          <label>
            Raw user remark or method idea
            <textarea defaultValue={defaultRemark} name="remark" required rows={5} />
          </label>
          <label>
            Problem this method solves
            <textarea
              name="problem"
              placeholder="Example: Holo glare is being misread as scratches under direct light."
              required
              rows={3}
            />
          </label>
          <label>
            Proposed tool sequence
            <textarea
              name="steps"
              placeholder="crop_region -> zoom_region -> run_glare_check -> run_ding_detector -> explain_uncertainty"
              required
              rows={3}
            />
          </label>
          <div className="method-submit-checks">
            <label>
              <input name="publicRemarkConsent" required type="checkbox" /> I approve rewriting my remark into a public
              attribution summary if the method is verified.
            </label>
            <label>
              <input name="noRawImageConsent" required type="checkbox" /> I understand raw card images are not published
              without separate explicit consent.
            </label>
          </div>
          <button className="button warn" disabled={submitting} type="submit">
            {submitting ? "Submitting..." : "Submit draft candidate"}
          </button>
          {submitError ? <p className="method-submit-error">{submitError}</p> : null}
        </form>

        <aside className="method-submit-preview">
          <span className="page-kicker">Lifecycle</span>
          <ol>
            <li>Draft candidate</li>
            <li>Reproducing</li>
            <li>Benchmarking</li>
            <li>Verified</li>
            <li>Canary</li>
            <li>Production</li>
          </ol>
          <p>
            Reward events: method_submitted, method_reproduced, method_verified, method_merged_open_source, and
            method_used_1000_times.
          </p>
          {submitted ? (
            <div className="method-submit-success" role="status">
              <strong>Draft candidate saved</strong>
              <p>
                Proposal <code>{proposalId}</code> entered the same server-side draft proposal store used by report
                chat. It is not public or active until benchmark review passes.
              </p>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
