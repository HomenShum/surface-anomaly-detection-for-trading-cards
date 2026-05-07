import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const inferenceUrl = (process.env.INFERENCE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const webUrl = (process.env.WEB_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const launchMode = normalizeReleaseMode(process.env.CCV_LAUNCH_MODE ?? "demo");
const samplePath = resolve(repoRoot, "apps/web/public/demo/sample-cards/roboflow-tauros-real-card.jpg");
const reportPath = resolve(repoRoot, "docs/qa/LAUNCH_BLOCKERS_STATUS.md");
const productionReadinessPath = resolve(repoRoot, "data/cert-references/production-readiness/latest.json");

const checks = [];

function record(name, passed, detail) {
  checks.push({ name, passed, detail });
  const marker = passed ? "PASS" : "FAIL";
  console.log(`${marker} ${name}: ${detail}`);
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function checkInference() {
  try {
    const health = await fetchJson(`${inferenceUrl}/health`);
    record("Inference health", health.response.ok, `GET /health -> ${health.response.status}`);
  } catch (error) {
    record("Inference health", false, error instanceof Error ? error.message : "unknown");
    return null;
  }

  const models = await fetchJson(`${inferenceUrl}/models/current`);
  const model = models.body ?? {};
  const realModel =
    models.response.ok &&
    model.mock === false &&
    model.allow_mock_detector === false &&
    model.require_real_model === true &&
    Boolean(model.weights_sha256) &&
    Boolean(model.dataset_manifest_hash) &&
    Boolean(model.training_run_id);
  record(
    "Real model metadata",
    realModel,
    `mock=${model.mock}, version=${model.model_version}, training=${model.training_run_id ?? "missing"}`,
  );
  return model;
}

async function checkSampleAnalyze() {
  if (!existsSync(samplePath)) {
    record("Sample image fixture", false, samplePath);
    return null;
  }
  const image = await readFile(samplePath);
  const request = {
    image_base64: image.toString("base64"),
    filename: "roboflow-tauros-real-card.jpg",
    content_type: "image/jpeg",
    card_id: "launch-check-card",
    report_id: "launch-check-report",
    scan_session_id: "launch-check-scan",
  };

  const analyze = await fetchJson(`${inferenceUrl}/scan/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "launch-check-scan",
    },
    body: JSON.stringify(request),
  });
  const body = analyze.body ?? {};
  const report = body.report ?? {};
  const manifest = report.evidence_manifest ?? {};
  const normalized = body.normalized ?? {};
  const analyzed =
    analyze.response.ok &&
    report.report_id === "launch-check-report" &&
    typeof report.analysis_job_key === "string" &&
    report.analysis_job_key.length === 64 &&
    Array.isArray(report.findings) &&
    manifest.manifest_sha256 &&
    normalized.sha256;
  record(
    "Real sample analysis",
    analyzed,
    `status=${analyze.response.status}, findings=${Array.isArray(report.findings) ? report.findings.length : "n/a"}`,
  );

  if (!analyzed) return null;

  const verify = await fetchJson(`${inferenceUrl}/evidence/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manifest,
      files: [
        {
          image_base64: request.image_base64,
          filename: "source",
          content_type: request.content_type,
        },
        {
          image_base64: normalized.image_base64,
          filename: "normalized",
          content_type: "image/png",
        },
      ],
    }),
  });
  record(
    "Evidence hash verification",
    verify.response.ok && verify.body?.passed === true,
    `status=${verify.response.status}, passed=${verify.body?.passed}`,
  );
  return body;
}

async function checkWebProxy() {
  try {
    const response = await fetchJson(`${webUrl}/api/inference/health`);
    record("Vercel/Next proxy smoke", response.response.ok, `${webUrl}/api/inference/health -> ${response.response.status}`);
  } catch (error) {
    record("Vercel/Next proxy smoke", false, error instanceof Error ? error.message : "unknown");
  }
}

async function checkRepoContracts() {
  const requiredFiles = [
    "services/inference-api/Dockerfile",
    "render.yaml",
    "docker-compose.yml",
    "convex/schema.ts",
    "convex/cards.ts",
    "docs/PRODUCTION_FAULT_TOLERANCE.md",
  ];
  for (const file of requiredFiles) {
    record(`Contract file ${file}`, existsSync(resolve(repoRoot, file)), file);
  }
}

async function checkProductionAccuracyReadiness() {
  if (!existsSync(productionReadinessPath)) {
    record("Production accuracy readiness", false, "missing production-readiness report; run pnpm eval:production-readiness");
    return;
  }
  try {
    const report = JSON.parse(await readFile(productionReadinessPath, "utf8"));
    const mode = report.releaseModes?.[launchMode] ?? null;
    const deployable = Boolean(mode?.deployable ?? (launchMode === "production" ? report.productionDeployable : false));
    record(
      `Release gate (${launchMode})`,
      deployable,
      `deployable=${deployable}, production=${report.productionDeployable}, alpha=${report.certifiedReferenceAlphaDeployable}, realRows=${report.summary?.realOutcomeRows ?? "n/a"}, gold=${report.summary?.goldRefs ?? "n/a"}, P0=${report.summary?.blockerIssues ?? "n/a"}`,
    );
  } catch (error) {
    record(`Release gate (${launchMode})`, false, error instanceof Error ? error.message : "invalid report");
  }
}

function normalizeReleaseMode(mode) {
  const value = String(mode).toLowerCase();
  if (value === "alpha" || value === "certified-reference-alpha") return "certified_reference_alpha";
  if (value === "beta" || value === "trust-beta") return "trust_beta";
  if (value === "production") return "production";
  return "demo";
}

function markdownReport() {
  const now = new Date().toISOString();
  const rows = checks
    .map((check) => `| ${check.passed ? "PASS" : "FAIL"} | ${check.name} | ${String(check.detail).replaceAll("|", "\\|")} |`)
    .join("\n");
  const failed = checks.filter((check) => !check.passed);
  return `# Launch Blockers Status

Generated: ${now}

Inference endpoint: \`${inferenceUrl}\`
Web endpoint: \`${webUrl || "not provided"}\`
Launch mode: \`${launchMode}\`

| Status | Check | Detail |
| --- | --- | --- |
${rows}

## Verdict

${failed.length === 0 ? "All executable in-repo launch checks passed." : `${failed.length} launch check(s) failed. Do not call this public-launch ready until these are green.`}
`;
}

await checkRepoContracts();
await checkProductionAccuracyReadiness();
await checkInference();
await checkSampleAnalyze();
await checkWebProxy();
await writeFile(reportPath, markdownReport(), "utf8");

const failed = checks.filter((check) => !check.passed);
if (failed.length > 0) process.exitCode = 1;
