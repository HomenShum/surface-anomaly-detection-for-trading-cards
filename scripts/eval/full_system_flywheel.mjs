#!/usr/bin/env node
// Full local inspection flywheel runner.
//
// This orchestrates the complete evidence loop we can run on this machine:
//   dataset acquisition/audit -> ML eval -> agentic annotation eval ->
//   certified-reference eval -> agentic cert judge -> method flywheel ->
//   visible-condition proof gates.
//
// It does not force production readiness. Missing Roboflow exports, Silver+
// images, Gold records, and human DING reviews stay explicit blockers.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const outDir = join(root, "data", "proof", "full-system-flywheel");
const docsDir = join(root, "docs", "proof");
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const commands = [
  {
    id: "dataset_audit",
    title: "Audit configured Roboflow datasets and parse local exports",
    command: pythonCommand("ml/scripts/ingest_roboflow.py", "--skip-download", "--allow-missing"),
    required: true,
  },
  ...(args.trainSmoke
    ? [
        {
          id: "train_smoke",
          title: "Train a one-epoch YOLO smoke model without replacing production weights",
          command: pythonCommand(
            "ml/scripts/train_yolo.py",
            "--data",
            "ml/datasets/yolo/roboflow_alpha/dataset.yaml",
            "--model",
            "yolov8n.pt",
            "--imgsz",
            "320",
            "--epochs",
            "1",
            "--batch",
            "2",
            "--device",
            "cpu",
            "--project",
            "runs/ding-detector-v0",
            "--name",
            "full-loop-smoke",
            "--output",
            "services/inference-api/app/models/ding-detector-full-loop-smoke.pt",
            "--metrics",
            "services/inference-api/app/models/ding-detector-full-loop-smoke.metrics.json",
          ),
          required: false,
        },
      ]
    : []),
  {
    id: "model_eval",
    title: "Evaluate current trained DING detector on the Roboflow alpha test split",
    command: pythonCommand(
      "ml/scripts/eval_models.py",
      "--data",
      "ml/datasets/yolo/roboflow_alpha/dataset.yaml",
      "--weights",
      "services/inference-api/app/models/ding-detector-v0.pt",
      "--output",
      "ml/runs/eval_yolo_test_report.json",
      "--conf",
      "0.25",
      "--iou",
      "0.5",
    ),
    required: true,
  },
  {
    id: "agentic_annotations",
    title: "Evaluate local ML + agentic annotation fusion fixtures",
    command: pnpmCommand("eval:agentic-annotations"),
    required: true,
  },
  {
    id: "certrefs_band_eval",
    title: "Evaluate certified-reference band agreement from active predictions",
    command: pnpmCommand("eval:certrefs:bands"),
    required: true,
  },
  {
    id: "agentic_cert_eval",
    title: "Judge certified-reference rows across agent/tool/model/evidence layers",
    command: pnpmCommand("eval:certrefs:agentic"),
    required: true,
  },
  {
    id: "method_flywheel",
    title: "Run candidate-method flywheel loop",
    command: pnpmCommand("flywheel:loop"),
    required: true,
  },
  {
    id: "visible_condition_proof",
    title: "Build consolidated visible-condition proof report",
    command: pnpmCommand("proof:visible-condition"),
    required: true,
  },
  {
    id: "demo_gate",
    title: "Verify demo release gate",
    command: pnpmCommand("gate:demo"),
    required: true,
  },
  {
    id: "real_ding_gif",
    title: "Build shareable GIF from live dataset-card DING annotations",
    command: pnpmCommand("demo:gifs:real-ding"),
    required: true,
  },
  {
    id: "vendor_alpha_gate_expected_blockers",
    title: "Verify vendor-alpha blockers remain explicit",
    command: pnpmCommand("proof:visible-condition:vendor"),
    required: false,
    expectedFailure: true,
  },
];

const results = commands.map(runCommand);
const artifacts = collectArtifacts();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  trainSmokeRequested: args.trainSmoke,
  ok: results.every((result) => result.ok || !result.required || result.expectedFailure),
  commands: results,
  artifacts,
  blockers: collectBlockers({ artifacts, results }),
};

const timestamp = report.generatedAt.replace(/[:.]/g, "-");
writeJson(join(outDir, "latest.json"), report);
writeJson(join(outDir, `${timestamp}.json`), report);
writeFileSync(join(docsDir, "FULL_SYSTEM_FLYWHEEL_REPORT.md"), renderMarkdown(report), "utf-8");

console.log(
  JSON.stringify(
    {
      ok: report.ok,
      trainSmokeRequested: report.trainSmokeRequested,
      reportPath: join(docsDir, "FULL_SYSTEM_FLYWHEEL_REPORT.md"),
      latestJson: join(outDir, "latest.json"),
      failedRequired: results.filter((result) => result.required && !result.ok).map((result) => result.id),
      expectedBlockers: report.blockers.slice(0, 10),
    },
    null,
    2,
  ),
);

if (!report.ok && args.strict) process.exit(1);

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    trainSmoke: argv.includes("--train-smoke"),
  };
}

function pythonCommand(...parts) {
  return [process.env.PYTHON || "python", ...parts];
}

function pnpmCommand(script) {
  return ["pnpm", script];
}

function runCommand(spec) {
  const startedAt = new Date().toISOString();
  const commandLine = spec.command.map(shellQuote).join(" ");
  const result = spawnSync(commandLine, {
    cwd: root,
    encoding: "utf-8",
    shell: true,
    windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  return {
    id: spec.id,
    title: spec.title,
    command: commandLine,
    required: spec.required,
    expectedFailure: Boolean(spec.expectedFailure),
    status: result.status,
    ok: result.status === 0,
    startedAt,
    endedAt: new Date().toISOString(),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error ? `${result.error.name}: ${result.error.message}` : null,
  };
}

function shellQuote(value) {
  const text = String(value);
  if (!/[\s"'&|<>^]/.test(text)) return text;
  if (process.platform === "win32") return `"${text.replace(/"/g, '\\"')}"`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function collectArtifacts() {
  return {
    datasetAudit: readJson("ml/datasets/manifests/roboflow_alpha_manifest.audit.json"),
    modelEval: readJson("ml/runs/eval_yolo_test_report.json"),
    agenticAnnotations: readJson("data/benchmarks/agentic_annotations/latest.json"),
    certBands: readJson("data/benchmarks/cert_refs/latest.json"),
    agenticCert: readJson("data/cert-references/agentic-eval/latest.json"),
    flywheel: readJson("data/cert-references/flywheel/latest.json"),
    visibleConditionProof: readJson("data/proof/visible-condition/latest.json"),
    productionReadiness: readJson("data/cert-references/production-readiness/latest.json"),
    liveDatasetApiProbe: readJson("data/proof/full-system-flywheel/live_dataset_card_api_analysis.json"),
    liveTaurosApiProbe: readJson("data/proof/full-system-flywheel/live_tauros_api_analysis.json"),
    realDingGif: fileArtifact("public/demo/gifs/real-dataset-card-corner-wear-model-annotations.gif"),
    realDingGifVerificationFrame: fileArtifact("docs/screenshots/real-dataset-card-corner-wear-model-annotations-frame.png"),
  };
}

function collectBlockers({ artifacts, results }) {
  const blockers = [];
  for (const result of results) {
    if (!result.ok && !result.expectedFailure) {
      blockers.push(`${result.id}: command failed with status ${result.status}`);
    }
  }
  for (const source of artifacts.datasetAudit?.missing_sources ?? []) {
    blockers.push(`dataset:${source.id}: ${source.reason}; ${source.dataset_url}`);
  }
  for (const reason of artifacts.visibleConditionProof?.release?.vendorPilotAlpha ? [] : artifacts.visibleConditionProof?.gates?.vendorPilot?.filter((gate) => !gate.passed).map((gate) => `${gate.id}: ${gate.detail}`) ?? []) {
    blockers.push(`vendor-alpha:${reason}`);
  }
  for (const reason of artifacts.productionReadiness?.releaseModes?.production?.blockingReasons ?? []) {
    blockers.push(`production:${reason}`);
  }
  return [...new Set(blockers)];
}

function readJson(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function fileArtifact(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  const stats = statSync(path);
  return {
    path: relativePath,
    bytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function tail(value = "", max = 1800) {
  const text = String(value).trim();
  return text.length <= max ? text : text.slice(text.length - max);
}

function renderMarkdown(report) {
  const dataset = report.artifacts.datasetAudit;
  const model = report.artifacts.modelEval?.modelVersion ?? report.artifacts.visibleConditionProof?.model?.modelVersion ?? "unknown";
  const yolo = report.artifacts.modelEval?.metrics?.overall ?? report.artifacts.visibleConditionProof?.model?.yolo ?? {};
  const agentic = report.artifacts.agenticAnnotations?.summaries?.c_multimodel_agent_reinspection;
  const liveDatasetFindings = report.artifacts.liveDatasetApiProbe?.report?.findings ?? [];
  const liveTaurosFindings = report.artifacts.liveTaurosApiProbe?.report?.findings ?? [];
  const realDingGif = report.artifacts.realDingGif;
  return [
    "# Full System Flywheel Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Overall local loop: **${report.ok ? "pass" : "blocked"}**`,
    "",
    "## Dataset State",
    "",
    `- Configured Roboflow sources: ${dataset?.configured_sources?.length ?? 0}`,
    `- Downloaded/trainable sources: ${dataset?.downloaded_sources?.length ?? Object.keys(dataset?.sources ?? {}).length}`,
    `- Missing configured exports: ${dataset?.missing_sources?.length ?? 0}`,
    `- Local records: ${dataset?.records ?? 0}`,
    `- Manifest SHA-256: ${dataset?.manifest_sha256 ?? "missing"}`,
    "",
    "## Model + Agent Eval",
    "",
    `- Model: ${model}`,
    `- YOLO precision: ${fmt(yolo.precision)}`,
    `- YOLO recall: ${fmt(yolo.recall)}`,
    `- Agentic annotation precision: ${fmt(agentic?.metrics?.overall?.precision)}`,
    `- Agentic annotation recall: ${fmt(agentic?.metrics?.overall?.recall)}`,
    `- Agentic claim grounding: ${fmt(agentic?.agent?.claimGroundedRate)}`,
    `- Official-grade claim violations: ${agentic?.agent?.officialGradeClaimViolations ?? "n/a"}`,
    "",
    "## Live API Probe",
    "",
    `- Dataset-card API findings: ${liveDatasetFindings.length}`,
    `- Dataset-card evidence manifest: ${report.artifacts.liveDatasetApiProbe?.report?.evidence_manifest?.manifest_sha256 ?? "not run"}`,
    `- Tauros API findings: ${liveTaurosFindings.length}`,
    `- Tauros evidence manifest: ${report.artifacts.liveTaurosApiProbe?.report?.evidence_manifest?.manifest_sha256 ?? "not run"}`,
    "",
    "## Shareable GIF",
    "",
    `- Real DING annotation GIF: ${realDingGif?.path ?? "missing"}`,
    `- GIF bytes: ${realDingGif?.bytes ?? "n/a"}`,
    `- Verification frame: ${report.artifacts.realDingGifVerificationFrame?.path ?? "missing"}`,
    "",
    "## Command Results",
    "",
    "| Step | Status | Required |",
    "| --- | --- | --- |",
    ...report.commands.map((result) => `| ${result.id} | ${result.ok ? "PASS" : result.expectedFailure ? "EXPECTED BLOCK" : "FAIL"} | ${result.required ? "yes" : "no"} |`),
    "",
    "## Remaining Blockers",
    "",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["No blockers in the selected local loop."]),
    "",
  ].join("\n");
}

function fmt(value) {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}
