import Link from "next/link";
import { LandingClient } from "../components/LandingClient";
import { MethodCard } from "../components/MethodCard";
import { ExampleCard } from "../components/ExampleCard";
import { loadAllPublicMethods } from "../lib/agent/methods-bridge";
import { exampleOutcomes } from "../lib/examples/registry";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  const { all } = loadAllPublicMethods();
  const newlyVerified = all
    .filter((entry) => entry.status === "verified" || entry.status === "production" || entry.status === "canary")
    .slice(0, 4);

  // Pick 6 examples that span the trust spectrum: 1 Gem, 1 non-Gem, 1 Roboflow open, 1 failure case, plus 2 fillers.
  const featuredExamples = (() => {
    const gem = exampleOutcomes.find((entry) => entry.tier === "silver" && entry.knownOutcome?.numericGrade === 10);
    const nonGem = exampleOutcomes.find((entry) => entry.knownOutcome?.numericGrade === 9);
    const open = exampleOutcomes.find((entry) => entry.tier === "bronze");
    const failure = exampleOutcomes.find((entry) => entry.failureMode);
    const seen = new Set([gem?.id, nonGem?.id, open?.id, failure?.id].filter(Boolean));
    const fill = exampleOutcomes.filter((entry) => !seen.has(entry.id)).slice(0, 2);
    return [gem, nonGem, open, failure, ...fill].filter(Boolean).slice(0, 6) as typeof exampleOutcomes;
  })();

  return (
    <>
      <LandingClient />
      <section
        aria-label="Verified Outcome Library"
        className="landing-community-strip"
      >
        <header className="landing-community-strip-head">
          <div>
            <span className="page-kicker">Verified Outcome Library</span>
            <h2>Explore real graded outcomes before you scan a card.</h2>
            <p className="muted" style={{ maxWidth: 640, margin: "8px 0 0" }}>
              Real card identities. Real PSA cert references for known outcomes. Real open-source DING
              annotations. Honest failure cases where we got it wrong. Inspect the inspection — toggle
              DING overlays, compare against official outcomes, and read the limitations before you
              trust your own scan.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="button warn" href="/examples">
              Browse outcomes
            </Link>
            <Link className="button secondary" href="/benchmarks">
              Benchmarks
            </Link>
          </div>
        </header>
        <div className="landing-community-strip-grid">
          {featuredExamples.map((example) => (
            <ExampleCard example={example} key={example.id} />
          ))}
        </div>
      </section>
      <section
        aria-label="Community-verified inspection methods"
        className="landing-community-strip"
      >
        <header className="landing-community-strip-head">
          <div>
            <span className="page-kicker">Community-verified inspection methods</span>
            <h2>Open-source improvements that make every scan better.</h2>
            <p className="muted" style={{ maxWidth: 640, margin: "8px 0 0" }}>
              Real contributors who chatted, corrected, or proposed methods that passed our benchmark
              gates. Public attribution is opt-in. Raw images stay private. Open-source registry under{" "}
              <code>inspection-methods/</code>.
            </p>
          </div>
          <Link className="button warn" href="/methods">
            View all methods
          </Link>
        </header>
        {newlyVerified.length === 0 ? (
          <p className="landing-community-empty">
            No verified methods yet. Be the first — talk to the agent on a report and propose an
            inspection workflow.
          </p>
        ) : (
          <div className="landing-community-strip-grid">
            {newlyVerified.map((method) => (
              <MethodCard compact key={method.id} method={method} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
