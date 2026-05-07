import Link from "next/link";
import type { OutcomeExample } from "../lib/outcome-examples";
import { provenanceLabel } from "../lib/outcome-examples";

export function OutcomeExampleCard({ example, compact = false }: { example: OutcomeExample; compact?: boolean }) {
  return (
    <article className={`outcome-card ${compact ? "outcome-card--compact" : ""}`}>
      <Link className="outcome-card-image" href={`/examples/${example.slug}`}>
        {example.image ? (
          <img alt={example.title} src={example.image} />
        ) : (
          <div className="outcome-cert-placeholder">
            <span>{example.grader ?? "Cert"}</span>
            <strong>{example.certNumber}</strong>
            <em>{example.officialGrade ?? "External reference"}</em>
          </div>
        )}
        <span className={`outcome-result outcome-result--${example.result}`}>{example.result.replaceAll("_", " ")}</span>
      </Link>
      <div className="outcome-card-body">
        <span className="page-kicker">{provenanceLabel(example.provenance)}</span>
        <h3>
          <Link href={`/examples/${example.slug}`}>{example.title}</Link>
        </h3>
        <p>{example.summary}</p>
        <div className="outcome-rights-badges" aria-label="Source rights">
          <span className={example.hasOfficialGrade ? "is-on" : ""}>official grade {example.hasOfficialGrade ? "yes" : "no"}</span>
          <span className={example.hasDingLabels ? "is-on" : ""}>DING labels {example.hasDingLabels ? "yes" : "no"}</span>
          <span className={example.useForTraining ? "is-on" : "is-off"}>{example.useForTraining ? "training ok" : "not training data"}</span>
        </div>
        <dl>
          <div>
            <dt>Known outcome</dt>
            <dd>{example.knownOutcome}</dd>
          </div>
          <div>
            <dt>Our band</dt>
            <dd>{example.modelBand}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{example.modelConfidence}%</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
