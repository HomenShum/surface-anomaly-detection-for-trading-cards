import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("inspection-methods");
const outPath = resolve("docs/qa/VERIFIED_METHODS_REPORT.md");
const verifiedStatuses = new Set(["verified", "canary", "production"]);

function valueFromYaml(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"));
  return match ? match[1].trim() : "";
}

function boolFromYaml(text, key) {
  const match = text.match(new RegExp(`${key}:\\s*(true|false)`, "m"));
  return match ? match[1] === "true" : undefined;
}

const failures = [];
const rows = [];

for (const name of readdirSync(root)) {
  const dir = join(root, name);
  if (name === "README.md") continue;
  const methodPath = join(dir, "method.yaml");
  if (!existsSync(methodPath)) continue;
  const methodYaml = readFileSync(methodPath, "utf-8");
  const id = valueFromYaml(methodYaml, "id");
  const status = valueFromYaml(methodYaml, "status");
  const contributor = valueFromYaml(methodYaml, "contributor");
  const sharesRaw = boolFromYaml(methodYaml, "shares_raw_user_images");
  const benchmarkPath = join(dir, "benchmark.json");
  const limitationsPath = join(dir, "limitations.md");
  const contributorPath = join(dir, "contributor.md");
  let benchmark = null;

  if (!id) failures.push(`${name}: method.yaml missing id.`);
  if (!status) failures.push(`${name}: method.yaml missing status.`);
  if (!contributor) failures.push(`${name}: method.yaml missing contributor.`);
  if (sharesRaw === true) failures.push(`${name}: registry method attempts to share raw user images.`);

  if (verifiedStatuses.has(status)) {
    if (!existsSync(benchmarkPath)) {
      failures.push(`${id}: ${status} method missing benchmark.json.`);
    } else {
      benchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"));
      if (benchmark.status !== "passed") failures.push(`${id}: verified method benchmark did not pass.`);
      if (benchmark.safety?.agent_claims_without_tool_evidence !== 0) {
        failures.push(`${id}: benchmark has ungrounded agent claims.`);
      }
      if (benchmark.safety?.official_grade_claims !== 0) {
        failures.push(`${id}: benchmark has official-grade claims.`);
      }
      if (benchmark.safety?.privacy_violations !== 0) {
        failures.push(`${id}: benchmark has privacy violations.`);
      }
      if (benchmark.safety?.shares_raw_user_images) {
        failures.push(`${id}: benchmark shares raw user images.`);
      }
    }
    if (!existsSync(limitationsPath)) {
      failures.push(`${id}: ${status} method missing limitations.md.`);
    }
    if (!existsSync(contributorPath)) {
      failures.push(`${id}: ${status} method missing contributor.md.`);
    }
  }

  rows.push({
    id,
    status,
    contributor,
    benchmark: benchmark?.benchmark_id ?? "pending",
    falsePositiveReduction: benchmark?.delta?.false_positive_reduction ?? null,
    precisionLift: benchmark?.delta?.precision_lift ?? null,
  });
}

const report = `# Verified Methods Registry QA

Generated: ${new Date().toISOString()}

| Method | Status | Contributor | Benchmark | FP delta | Precision delta |
|---|---|---|---|---:|---:|
${rows
  .map(
    (row) =>
      `| ${row.id} | ${row.status} | ${row.contributor} | ${row.benchmark} | ${
        row.falsePositiveReduction === null ? "pending" : `-${Math.round(row.falsePositiveReduction * 100)}%`
      } | ${row.precisionLift === null ? "pending" : `+${Math.round(row.precisionLift * 100)}%`} |`,
  )
  .join("\n")}

## Result

${failures.length === 0 ? "PASS - all verified methods have benchmark proof and safety checks." : `FAIL\n\n- ${failures.join("\n- ")}`}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, report, "utf-8");

if (failures.length) {
  throw new Error(failures.join(" "));
}

console.log("Verified methods registry QA passed.");
