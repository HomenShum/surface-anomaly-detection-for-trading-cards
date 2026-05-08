#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { auditReferencePolicy } from "./cert_source_policy.mjs";
import { certDataDir, loadAllRefs, repoRoot, writeJson } from "./cert_reference_lib.mjs";

const args = new Set(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const refs = loadAllRefs();
const audits = refs.map(auditReferencePolicy);
const issues = audits.flatMap((audit) => audit.issues);
const summary = {
  refs: refs.length,
  syntheticRefs: audits.filter((audit) => audit.syntheticRef).length,
  p0: issues.filter((issue) => issue.severity === "P0").length,
  p1: issues.filter((issue) => issue.severity === "P1").length,
  p2: issues.filter((issue) => issue.severity === "P2").length,
};
const gates = [
  {
    id: "no_p0_policy_violations",
    label: "No P0 source-policy violations",
    passed: summary.p0 === 0,
    detail: `${summary.p0} P0 issue(s).`,
  },
  {
    id: "no_synthetic_trust_rows",
    label: "No synthetic/generated rows in trust gates",
    passed: summary.syntheticRefs === 0,
    detail: `${summary.syntheticRefs} synthetic/generated reference row(s).`,
  },
];
const report = {
  schemaVersion: 1,
  generatedAt,
  repoRoot: repoRoot(),
  policyPath: join(certDataDir(), "source-policy.json"),
  summary,
  gates,
  issues,
};
const outDir = join(certDataDir(), "source-policy-audit");
mkdirSync(outDir, { recursive: true });
writeJson(join(outDir, "latest.json"), report);
writeJson(join(outDir, `${generatedAt.replace(/[:.]/g, "-")}.json`), report);
console.log(JSON.stringify(report, null, 2));

if (args.has("--strict") && gates.some((gate) => !gate.passed)) process.exit(1);
