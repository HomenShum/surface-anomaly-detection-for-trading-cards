import Link from "next/link";
import { TrustBadge } from "./TrustBadge";
import { ExampleImage } from "./ExampleImage";
import { bandLabel, bandRange, exampleRights, type ExampleOutcome } from "../lib/examples/registry";

export function ExampleCard({ example }: { example: ExampleOutcome }) {
  const rights = exampleRights(example);
  const matched = example.ourPrediction.matchedKnownOutcome;
  const matchPill =
    matched === true
      ? { text: "matched outcome", cls: "matched" }
      : matched === false
        ? { text: "mismatched", cls: "mismatched" }
        : { text: "no official outcome", cls: "neutral" };
  const imageFallbackHint =
    example.provenance.identityImageSource === "synthetic-placeholder"
      ? "no local image evidence yet"
      : "external identity image unavailable";

  return (
    <Link className="example-card" href={`/examples/${example.slug}`}>
      <div className="example-card-art">
        <ExampleImage
          alt={example.title}
          externalReferenceLabel={example.provenance.externalReferenceLabel}
          externalReferenceUrl={example.provenance.externalReferenceUrl}
          fallbackLabel={example.game.replace("-", " ").toUpperCase()}
          fallbackHint={imageFallbackHint}
          src={example.provenance.identityImageUrl}
        />
        <TrustBadge tier={example.tier} size="sm" />
      </div>
      <div className="example-card-body">
        <h3>{example.title}</h3>
        {example.knownOutcome ? (
          <>
          <p className="example-card-outcome">
            <strong>{example.knownOutcome.grader}</strong> · {example.knownOutcome.grade}
          </p>
          {example.knownOutcome.certNumber ? (
            <p className="example-card-outcome muted">PSA {example.knownOutcome.certNumber}</p>
          ) : null}
          </>
        ) : (
          <p className="example-card-outcome muted">No official outcome attached.</p>
        )}
        <div className="example-card-metrics">
          <div>
            <span>Our score</span>
            <strong>{example.ourPrediction.confidence > 0 ? example.ourPrediction.benchmarkScore : "N/A"}</strong>
            <small>{example.ourPrediction.confidence > 0 ? bandRange(example.ourPrediction.band) : "reference only"}</small>
          </div>
          <div>
            <span>DINGs (material)</span>
            <strong>
              {example.dings.filter((ding) => ding.materialToGrade).length}/{example.dings.length}
            </strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{example.ourPrediction.confidence > 0 ? `${Math.round(example.ourPrediction.confidence * 100)}%` : "N/A"}</strong>
          </div>
        </div>
        <div className="outcome-rights-badges" aria-label="Source rights">
          <span className={rights.hasOfficialGrade ? "is-on" : ""}>official grade {rights.hasOfficialGrade ? "yes" : "no"}</span>
          <span className={rights.hasDingLabels ? "is-on" : ""}>DING labels {rights.hasDingLabels ? "yes" : "no"}</span>
          <span className={rights.useForTraining ? "is-on" : "is-off"}>{rights.useForTraining ? "training ok" : "not training data"}</span>
        </div>
        <div className={`example-card-match example-card-match--${matchPill.cls}`}>
          {matchPill.text}
        </div>
        {example.failureMode ? (
          <span className="example-card-failure">⚠ {example.failureMode.replaceAll("_", " ")}</span>
        ) : null}
      </div>
    </Link>
  );
}
