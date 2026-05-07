import { bandLabel, bandRange, type ExampleOutcome } from "../lib/examples/registry";

/**
 * Side-by-side grader comparison.
 *
 * Renders rows for: official outcome (one of PSA/BGS/CGC/TAG), our prediction,
 * and a TAG-equivalent band derived from the same numeric grade. If sub-grades
 * are attached (BGS-style: centering / corners / edges / surface), render them
 * as a secondary mini-grid.
 *
 * Honesty: we do NOT pretend to have CGC and TAG numbers we never measured.
 * We render placeholder rows ONLY when the example explicitly has those data
 * points. Otherwise we surface a "not measured" note so the user sees what's
 * absent.
 */

type GraderRow = {
  source: string;
  label: string;
  numeric: string;
  bandRange: string;
  bandLabel: string;
  classCss: string;
  note?: string;
};

function tagEquivalentFromNumeric(numeric: number | undefined): { range: string; label: string; numeric: string } {
  if (numeric === undefined) return { range: "—", label: "—", numeric: "—" };
  if (numeric >= 10) return { range: "950–1000", label: "Gem / Pristine candidate", numeric: "950–1000" };
  if (numeric >= 9.5) return { range: "950–989", label: "TAG-equivalent Gem Mint", numeric: "975" };
  if (numeric >= 9) return { range: "900–949", label: "TAG-equivalent Mint", numeric: "925" };
  if (numeric >= 8.5) return { range: "850–899", label: "TAG-equivalent NM-MT+", numeric: "875" };
  if (numeric >= 8) return { range: "800–849", label: "TAG-equivalent NM-MT", numeric: "825" };
  if (numeric >= 7) return { range: "700–799", label: "TAG-equivalent EX-MT", numeric: "750" };
  return { range: "<700", label: "Below NM", numeric: "650" };
}

export function GraderComparison({ example }: { example: ExampleOutcome }) {
  const rows: GraderRow[] = [];

  if (example.knownOutcome) {
    rows.push({
      source: example.knownOutcome.grader,
      label: example.knownOutcome.grade ?? "—",
      numeric: example.knownOutcome.numericGrade !== undefined ? String(example.knownOutcome.numericGrade) : "—",
      bandRange: bandRange(example.knownOutcome.band),
      bandLabel: bandLabel(example.knownOutcome.band),
      classCss: "official",
    });

    const tagEquiv = tagEquivalentFromNumeric(example.knownOutcome.numericGrade);
    rows.push({
      source: "TAG-equivalent",
      label: tagEquiv.label,
      numeric: tagEquiv.numeric,
      bandRange: tagEquiv.range,
      bandLabel: tagEquiv.label,
      classCss: "tag-equiv",
      note: "Derived from the official numeric grade. Not a real TAG submission.",
    });
  }

  rows.push({
    source: "Card Condition Vault",
    label: bandLabel(example.ourPrediction.band),
    numeric: String(example.ourPrediction.benchmarkScore),
    bandRange: bandRange(example.ourPrediction.band),
    bandLabel: bandLabel(example.ourPrediction.band),
    classCss: example.ourPrediction.matchedKnownOutcome
      ? "ours-matched"
      : example.ourPrediction.matchedKnownOutcome === false
        ? "ours-mismatched"
        : "ours-neutral",
  });

  // Graders we DON'T have data for — surface as honest "not measured" rows.
  const haveGraders = new Set([example.knownOutcome?.grader].filter(Boolean));
  const expected = ["PSA", "BGS", "CGC", "TAG"] as const;
  for (const candidate of expected) {
    if (!haveGraders.has(candidate)) {
      rows.push({
        source: candidate,
        label: "not measured",
        numeric: "—",
        bandRange: "—",
        bandLabel: "—",
        classCss: "not-measured",
        note: "No public cert reference for this card from this grader.",
      });
    }
  }

  return (
    <article className="example-detail-card">
      <h2>Grader comparison</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Side-by-side: the official record, our model&apos;s band, and the TAG-equivalent band derived from
        the official numeric grade. We don&apos;t fabricate numbers for graders we don&apos;t have a
        certified-reference link for.
      </p>
      <div className="grader-comparison">
        <div className="grader-comparison-row grader-comparison-row--head">
          <span>Source</span>
          <span>Label</span>
          <span>Numeric</span>
          <span>Band</span>
        </div>
        {rows.map((row, idx) => (
          <div className={`grader-comparison-row grader-comparison-row--${row.classCss}`} key={`${row.source}-${idx}`}>
            <span>
              <strong>{row.source}</strong>
              {row.note ? <em className="grader-comparison-note">{row.note}</em> : null}
            </span>
            <span>{row.label}</span>
            <span>
              <code>{row.numeric}</code>
            </span>
            <span>
              {row.bandRange}
              {row.bandLabel !== row.label ? (
                <em className="grader-comparison-band-label"> · {row.bandLabel}</em>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {example.knownOutcome?.subGrades ? (
        <>
          <h3 style={{ fontSize: 13, marginTop: 14 }}>Sub-grades (BGS-style)</h3>
          <div className="grader-subgrades">
            {(["centering", "corners", "edges", "surface"] as const).map((key) => {
              const value = example.knownOutcome?.subGrades?.[key];
              return (
                <div className="grader-subgrade-cell" key={key}>
                  <span>{key}</span>
                  <strong>{value !== undefined ? value : "—"}</strong>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          No sub-grades attached. BGS-style sub-grade calibration is on the roadmap.
        </p>
      )}
    </article>
  );
}
