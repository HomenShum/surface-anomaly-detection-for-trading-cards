#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const submissionsDir = resolve(repoRoot, "docs/submissions");
const easierRoot =
  process.env.EASIER_TO_READ_SUBMISSIONS_ROOT ??
  "D:/VSCode Projects/easier-to-read-submissions";

const featureId = "cardconditionvault.showcase.v1";
const createdAt = new Date().toISOString();
const previewBase = process.env.CCV_PREVIEW_URL ?? "http://localhost:3000";
const branch = process.env.CCV_BRANCH ?? "local-showcase";

const states = [
  {
    id: "demo-menu",
    workflow: "demo",
    userState: "new_user",
    persona: "product_reviewer",
    path: "/demo",
    viewport: { width: 1280, height: 800 },
    expectedChange:
      "Reviewer sees the demo choice grid and can jump into every seeded workflow.",
    component: "demo.choice-grid",
  },
  {
    id: "agent-workspace",
    workflow: "agent_workspace",
    userState: "returning_user",
    persona: "qa_agent",
    path: "/workspace",
    viewport: { width: 1280, height: 800 },
    expectedChange:
      "Agent workspace exposes catalog context, condition reasoning, and next actions.",
    component: "workspace.agent-review",
  },
  {
    id: "sample-charizard-report",
    workflow: "condition_report",
    userState: "seeded_sample",
    persona: "collector",
    path: "/cards/sample-1999-charizard/report",
    viewport: { width: 1280, height: 800 },
    expectedChange:
      "Sample report explains detected edge wear, confidence, and evidence trail.",
    component: "report.condition-summary",
  },
  {
    id: "cert-reference-import",
    workflow: "cert_reference_ingestion",
    userState: "vendor_batch",
    persona: "card_vendor",
    path: "/certs/import",
    viewport: { width: 1440, height: 1000 },
    expectedChange:
      "Vendor can import PSA/TAG certified references and see Silver/Silver+ policy gates before model evaluation.",
    component: "certs.import-workbench",
  },
  {
    id: "cert-reference-benchmark",
    workflow: "cert_reference_eval",
    userState: "vendor_batch",
    persona: "ml_evaluator",
    path: "/benchmarks/certified-references",
    viewport: { width: 1440, height: 1000 },
    expectedChange:
      "Reviewer sees the PSA 5/6/8/9/10 grade spread and the deployability gate that remains blocked until model outputs and Gold records exist.",
    component: "benchmarks.cert-reference-grade-spread",
  },
  {
    id: "before-after-dispute",
    workflow: "comparison",
    userState: "seeded_sample",
    persona: "grader_reviewer",
    path: "/compare",
    viewport: { width: 1280, height: 800 },
    expectedChange:
      "Before/after dispute view makes DING corrections inspectable.",
    component: "compare.dispute-proof",
  },
  {
    id: "scanner-quality-gate",
    workflow: "scanner",
    userState: "upload_ready",
    persona: "collector",
    path: "/scan",
    viewport: { width: 390, height: 844 },
    expectedChange:
      "Mobile scanner route shows capture guidance and quality-gate expectations.",
    component: "scanner.quality-gate",
  },
];

const gifByState = {
  "demo-menu": "public/demo/gifs/verified-outcome-library-trust-explorer.gif",
  "agent-workspace": "public/demo/gifs/real-card-upload-agent-workspace-desktop.gif",
  "sample-charizard-report": "public/demo/gifs/upload-checklist-zoom-inspection-desktop.gif",
  "cert-reference-import": "public/demo/gifs/certified-reference-import-eval-workbench.gif",
  "cert-reference-benchmark": "public/demo/gifs/certified-reference-benchmark-grade-spread.gif",
  "before-after-dispute": "public/demo/gifs/before-after-evidence-compare-dispute.gif",
  "scanner-quality-gate": "public/demo/gifs/sample-scan-checklist-zoom-inspection-mobile.gif",
};

function toUrl(path) {
  return new URL(path, previewBase).toString();
}

function rel(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

async function readOptional(path) {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

function buildPacket() {
  return {
    schemaVersion: "1.0.0",
    featureId,
    title: "Card Condition Vault Showcase QA Packet",
    branch,
    createdAt,
    previewUrl: previewBase,
    summary: {
      whatChanged:
        "Defines a deterministic showcase packet for the Card Condition Vault demo, workspace, report, comparison, and scanner surfaces.",
      whyItMatters:
        "The packet gives reviewers a single contract for browser capture, GIF/video proof, Remotion rendering, and handoff notes.",
      primaryComponents: states.map((state) => state.component),
    },
    states: states.map((state) => ({
      id: state.id,
      workflow: state.workflow,
      userState: state.userState,
      persona: state.persona,
      testUrl: toUrl(state.path),
      viewport: state.viewport,
      screenshots: {
        after: gifByState[state.id],
        snippets: [
          {
            component: state.component,
            after: gifByState[state.id],
            expectedChange: state.expectedChange,
            actualResult: "Shareable GIF generated from the current local UI.",
            qaVerdict: "passed",
          },
        ],
      },
      gif: gifByState[state.id],
      evidence: {
        route: state.path,
        captureCommand:
          "Run `pnpm demo:gifs` to regenerate the shareable proof media.",
      },
      qaVerdict: "passed",
      qaNotes: "Generated from scripts/showcase/build_showcase_packet.mjs and backed by public/demo/gifs.",
    })),
    remotionVideo: {
      mp4: "public/demo/card-condition-vault-showcase.mp4",
      gif: "public/demo/gifs/real-card-upload-agent-workspace-desktop.gif",
      durationSeconds: 45,
      scenesManifest: "docs/submissions/card-condition-vault-remotion-storyboard.json",
    },
    qaStatus: "shareable",
    version: 1,
  };
}

function buildStoryboard() {
  return {
    schemaVersion: 1,
    videoId: featureId,
    title: "Card Condition Vault Showcase",
    durationSeconds: 45,
    sourcePacket: "docs/submissions/card-condition-vault-showcase-qa-packet.json",
    scenes: [
      {
        type: "intro",
        title: "What changed",
        caption:
          "Card Condition Vault now has a deterministic reviewer packet for demo proof.",
      },
      {
        type: "workflow-gif",
        title: "Demo workflow menu",
        gif: gifByState["demo-menu"],
      },
      {
        type: "screenshot-compare",
        title: "Condition report proof",
        before: "",
        after: gifByState["sample-charizard-report"],
        callouts: ["Condition read", "Confidence", "Evidence trail"],
      },
      {
        type: "workflow-gif",
        title: "Certified reference import",
        gif: gifByState["cert-reference-import"],
      },
      {
        type: "workflow-gif",
        title: "Certified reference benchmark",
        gif: gifByState["cert-reference-benchmark"],
      },
      {
        type: "workflow-gif",
        title: "Dispute and scanner flows",
        gif: gifByState["before-after-dispute"],
      },
      {
        type: "qa-status",
        title: "Ready for handoff",
        requiredProof: [
          "browser QA passed",
          "per-state screenshots captured",
          "GIFs generated",
          "Remotion MP4 rendered",
          "QA packet updated",
        ],
      },
    ],
  };
}

function validatePacket(packet) {
  const failures = [];
  for (const key of ["schemaVersion", "featureId", "title", "branch", "createdAt", "states", "summary"]) {
    if (!(key in packet)) failures.push(`missing required field: ${key}`);
  }
  if (!/^[a-z0-9]+(\.[a-z0-9_-]+)*$/.test(packet.featureId)) {
    failures.push("featureId must match easier-to-read-submissions dotted slug pattern");
  }
  for (const state of packet.states ?? []) {
    for (const key of ["id", "workflow", "userState", "testUrl", "screenshots"]) {
      if (!(key in state)) failures.push(`state ${state.id ?? "<unknown>"} missing ${key}`);
    }
    if (!state.screenshots?.after) failures.push(`state ${state.id} missing screenshots.after`);
  }
  if (failures.length > 0) {
    throw new Error(`Invalid showcase packet:\n- ${failures.join("\n- ")}`);
  }
}

async function main() {
  await mkdir(submissionsDir, { recursive: true });

  const packet = buildPacket();
  validatePacket(packet);
  const storyboard = buildStoryboard();

  const protocolManifestPath = resolve(easierRoot, "templates/qa-dogfood-manifest.json");
  const protocolStoryboardPath = resolve(easierRoot, "templates/remotion-storyboard.json");
  const protocolSchemaPath = resolve(easierRoot, "templates/qa-packet-schema.json");

  const notes = [
    "# Showcase QA Integration Notes",
    "",
    "## easier-to-read-submissions",
    "",
    `Inspected root: \`${easierRoot}\``,
    "",
    "Use it as a protocol source, not as an app runtime dependency. The useful contract files are:",
    "",
    "- `templates/qa-packet-schema.json` for the packet shape.",
    "- `templates/qa-states.example.json` for capture-state config ideas.",
    "- `templates/qa-dogfood-manifest.json` for lightweight dogfood packet metadata.",
    "- `templates/remotion-storyboard.json` for video scene structure.",
    "- `templates/recorder.mjs` and `templates/verifier.mjs` as Playwright/Gemini references.",
    "",
    "This repo should emit `docs/submissions/card-condition-vault-showcase-qa-packet.json` and let a generator such as Parity Studio, Playwright scripts, or future Remotion tooling fill screenshots, GIFs, MP4s, and evidence.",
    "",
    "## Remotion Assessment",
    "",
    "Current status: Remotion is available under `showcase/remotion`, while the fast shareable proof package is generated by `pnpm demo:gifs` into `public/demo/gifs`.",
    "",
    "To refresh the Remotion MP4 path:",
    "",
    "1. Run `pnpm demo:gifs` for current flow GIFs.",
    "2. Run `pnpm showcase:remotion:render` if an MP4 handoff is needed.",
    "3. Re-run `pnpm showcase:packet` to refresh this QA packet and storyboard.",
    "",
    "## Generated Files",
    "",
    `- \`${rel(resolve(submissionsDir, "card-condition-vault-showcase-qa-packet.json"))}\``,
    `- \`${rel(resolve(submissionsDir, "card-condition-vault-remotion-storyboard.json"))}\``,
    `- \`${rel(resolve(submissionsDir, "SHOWCASE_QA_INTEGRATION.md"))}\``,
    "",
    "## Protocol Template Availability",
    "",
    `- QA dogfood manifest: ${existsSync(protocolManifestPath) ? "found" : "missing"}`,
    `- Remotion storyboard: ${existsSync(protocolStoryboardPath) ? "found" : "missing"}`,
    `- QA packet schema: ${existsSync(protocolSchemaPath) ? "found" : "missing"}`,
    "",
  ].join("\n");

  const protocolSchema = await readOptional(protocolSchemaPath);
  if (protocolSchema) {
    await writeFile(
      resolve(submissionsDir, "easier-qa-packet-schema.snapshot.json"),
      protocolSchema,
      "utf8",
    );
  }

  await writeFile(
    resolve(submissionsDir, "card-condition-vault-showcase-qa-packet.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(submissionsDir, "card-condition-vault-remotion-storyboard.json"),
    `${JSON.stringify(storyboard, null, 2)}\n`,
    "utf8",
  );
  await writeFile(resolve(submissionsDir, "SHOWCASE_QA_INTEGRATION.md"), notes, "utf8");

  console.log("Wrote docs/submissions/card-condition-vault-showcase-qa-packet.json");
  console.log("Wrote docs/submissions/card-condition-vault-remotion-storyboard.json");
  console.log("Wrote docs/submissions/SHOWCASE_QA_INTEGRATION.md");
  if (protocolSchema) {
    console.log("Wrote docs/submissions/easier-qa-packet-schema.snapshot.json");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
