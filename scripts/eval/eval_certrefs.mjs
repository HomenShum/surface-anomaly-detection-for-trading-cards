#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeToBand, loadAllRefs, repoRoot, summarizeRefs, writeJson } from "../certs/cert_reference_lib.mjs";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const check = args.has("--check");
const root = repoRoot();
const docsDir = join(root, "docs", "qa");
const dataDir = join(root, "data", "cert-references");
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const refs = loadAllRefs();
const summary = summarizeRefs(refs);

const referenceRows = refs.map((ref) => {
  const officialBand = gradeToBand(ref.officialGrade);
  return {
    id: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    trustTier: ref.trustTier,
    officialGrade: ref.officialGrade ?? null,
    officialBand,
    modelAnalyzed: ["model_analyzed", "comparison_ready", "example_published"].includes(ref.status),
    needsHumanReview: ref.status === "human_review_needed" || officialBand === "unknown" || ref.metadataConfidence !== "api_verified",
    trainingAllowed: ref.trainingAllowed,
    publicExampleAllowed: ref.publicExampleAllowed,
    needsRawScanForGold: ref.needsRawScanForGold,
    limitations: ref.limitations ?? [],
  };
});

const gates = [
  {
    id: "cert_references_exist",
    label: "Certified references are seeded or imported",
    passed: summary.total > 0,
    detail: `${summary.total} references loaded.`,
  },
  {
    id: "external_refs_not_training_data",
    label: "External certified references are not marked training-allowed",
    passed: summary.trainingViolations === 0,
    detail: `${summary.trainingViolations} external training violations.`,
  },
  {
    id: "tag_no_bulk_scrape",
    label: "TAG references remain no-bulk-scrape/link-only",
    passed: summary.tagBulkScrapeViolations === 0,
    detail: `${summary.tagBulkScrapeViolations} TAG policy violations.`,
  },
  {
    id: "psa_api_first_path",
    label: "PSA API-first path exists with documented fallback",
    passed: refs.some((ref) => ref.provider === "PSA") && refs.every((ref) => ref.provider !== "PSA" || ref.psaApiAttempted !== undefined),
    detail: "Worker/importer attempt PSA API when credentials are configured; otherwise warnings are recorded.",
  },
  {
    id: "gold_upgrade_gap_visible",
    label: "Silver/Silver+ references explicitly require raw scans for Gold",
    passed: refs.filter((ref) => ref.trustTier === "silver" || ref.trustTier === "silver_plus").every((ref) => ref.needsRawScanForGold),
    detail: `${summary.needsRawScanForGold} references still need raw pre-submission scan + human DING review.`,
  },
  {
    id: "minimum_model_analyzed_refs",
    label: "At least five certified references have current model outputs",
    passed: summary.analyzed >= 5,
    detail: `${summary.analyzed} certified references have model-analysis status.`,
  },
  {
    id: "gold_eval_set_exists",
    label: "Gold eval set exists before deployability",
    passed: summary.gold > 0,
    detail: `${summary.gold} Gold/gold-candidate records loaded.`,
  },
];

const deployable = gates.every((gate) => gate.passed);
const report = {
  generatedAt: new Date().toISOString(),
  checkMode: check,
  deployable,
  summary,
  gates,
  references: referenceRows,
};

writeJson(join(dataDir, "eval-report.json"), report);

const markdown = [
  "# Certified Reference Evaluation Report",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  `Deployable: **${deployable ? "yes" : "no"}**`,
  "",
  "This report evaluates certified-reference readiness only. It does not claim PSA/TAG grade prediction and does not train on cert-page images.",
  "",
  "## Summary",
  "",
  `- Total references: ${summary.total}`,
  `- PSA: ${summary.psa}`,
  `- TAG: ${summary.tag}`,
  `- Silver+: ${summary.silverPlus}`,
  `- Model-analyzed references: ${summary.analyzed}`,
  `- Gold/gold-candidate records: ${summary.gold}`,
  "",
  "## Gates",
  "",
  "| Gate | Status | Detail |",
  "| --- | --- | --- |",
  ...gates.map((gate) => `| ${gate.label} | ${gate.passed ? "PASS" : "BLOCKED"} | ${gate.detail} |`),
  "",
  "## Reference Rows",
  "",
  "| Reference | Trust | Official outcome | Band | Model analyzed | Needs review |",
  "| --- | --- | --- | --- | --- | --- |",
  ...referenceRows.map(
    (row) =>
      `| ${row.provider} ${row.certNumber} | ${row.trustTier} | ${row.officialGrade ?? "pending"} | ${row.officialBand} | ${row.modelAnalyzed ? "yes" : "no"} | ${row.needsHumanReview ? "yes" : "no"} |`,
  ),
  "",
  "## Promotion Rule",
  "",
  "A model/pipeline version is not deployable from cert-reference eval alone until at least five certified references have current model outputs and at least one Gold/gold-candidate record exists. Use `pnpm eval:certrefs -- --strict` in release gates when this should fail CI.",
  "",
].join("\n");

writeFileSync(join(docsDir, "CERT_REFERENCE_EVAL_REPORT.md"), markdown, "utf-8");

console.log(`Cert refs deployable: ${deployable}`);
console.log(`Wrote ${join(dataDir, "eval-report.json")}`);
console.log(`Wrote ${join(docsDir, "CERT_REFERENCE_EVAL_REPORT.md")}`);

if (strict && !deployable) process.exit(1);
