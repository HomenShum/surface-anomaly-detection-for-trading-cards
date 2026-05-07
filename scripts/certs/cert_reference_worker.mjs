#!/usr/bin/env node
import { join } from "node:path";
import {
  certDataDir,
  loadAllRefs,
  repoRoot,
  resolvePsaViaApi,
  summarizeRefs,
  writeJson,
} from "./cert_reference_lib.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const root = repoRoot();
const docsDir = join(root, "docs", "qa");
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

const input = loadAllRefs();
const resolved = [];

for (const ref of input) {
  if (ref.provider === "PSA") {
    resolved.push(await resolvePsaViaApi(ref));
    continue;
  }
  if (ref.provider === "TAG") {
    resolved.push({
      ...ref,
      status: ref.status ?? "metadata_resolved",
      warnings: [
        ...(ref.warnings ?? []),
        "TAG remains link-only. The worker intentionally does not crawl or scrape TAG DIG reports.",
      ],
    });
    continue;
  }
  resolved.push(ref);
}

writeJson(join(certDataDir(), "resolved.json"), resolved);

const summary = summarizeRefs(resolved);
const report = [
  "# Certified Reference Ingestion Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Summary",
  "",
  `- Total references: ${summary.total}`,
  `- PSA references: ${summary.psa}`,
  `- TAG references: ${summary.tag}`,
  `- Silver+ references: ${summary.silverPlus}`,
  `- References still needing raw scans for Gold: ${summary.needsRawScanForGold}`,
  "",
  "## Safety Gates",
  "",
  `- External training violations: ${summary.trainingViolations}`,
  `- TAG bulk-scrape violations: ${summary.tagBulkScrapeViolations}`,
  `- PSA API configured: ${Boolean(process.env.PSA_PUBLIC_API_KEY ?? process.env.PSA_API_KEY)}`,
  "",
  "## Policy",
  "",
  "- PSA: API-first when credentials are configured; otherwise seed/manual metadata is retained with warnings.",
  "- TAG: link-only unless user-provided screenshots or explicit permission exists.",
  "- Cert images are not cached locally and are not training data without permission.",
  "- Gold requires raw pre-submission scan + official outcome + human DING review + consent.",
  "",
  "## References",
  "",
  ...resolved.map((ref) =>
    [
      `### ${ref.provider} ${ref.certNumber}`,
      "",
      `- Status: ${ref.status}`,
      `- Trust: ${ref.trustTier}`,
      `- Outcome: ${ref.officialGrade ?? "pending"}`,
      `- Identity: ${ref.cardIdentity ?? "pending"}`,
      `- External URL: ${ref.externalUrl}`,
      `- Needs Gold upgrade: ${ref.needsRawScanForGold}`,
      `- Warnings: ${(ref.warnings ?? []).join(" | ") || "none"}`,
      "",
    ].join("\n"),
  ),
].join("\n");

writeFileSync(join(docsDir, "CERT_REFERENCE_INGESTION_REPORT.md"), report, "utf-8");

console.log(`Resolved ${resolved.length} certified references.`);
console.log(`Wrote ${join(certDataDir(), "resolved.json")}`);
console.log(`Wrote ${join(docsDir, "CERT_REFERENCE_INGESTION_REPORT.md")}`);
