// Records the shareable Card Condition Vault demo set:
// - real card upload through the agent workspace
// - upload/checklist flow with the card visible
// - mobile streaming checklist
// - verified outcome library
// - certified reference import
// - certified reference benchmark grade spread
// - verified methods/reward board
// - before/after evidence compare
//
// Outputs descriptive GIFs/WebMs under public/demo, mirrors GIFs to apps/web/public,
// and keeps the original 01-04 GIF names as compatibility aliases for older docs.

import { chromium } from "@playwright/test";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100";
const sampleImage = join(root, "apps", "web", "public", "demo", "sample-cards", "roboflow-tauros-real-card.jpg");
const videoDir = join(root, "public", "demo", "videos");
const gifDir = join(root, "public", "demo", "gifs");
const appGifDir = join(root, "apps", "web", "public", "demo", "gifs");

mkdirSync(videoDir, { recursive: true });
mkdirSync(gifDir, { recursive: true });

if (!existsSync(sampleImage)) {
  throw new Error(`Missing sample image at ${sampleImage}`);
}

function demoEnv() {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-demo-gif-recorder-secret",
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseUrl,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function runPnpm(args) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const finalArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`]
      : args;
  const result = spawnSync(command, finalArgs, {
    cwd: root,
    env: demoEnv(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed with status ${result.status}`);
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReach(url)) return;
    await wait(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureServer() {
  if (await canReach(`${baseUrl}/workspace`)) {
    return null;
  }

  const serverMode = process.env.CCV_DEMO_SERVER ?? "dev";
  const parsedBaseUrl = new URL(baseUrl);
  const hostname = parsedBaseUrl.hostname || "127.0.0.1";
  const port = parsedBaseUrl.port || "3100";
  if (serverMode === "dev" && port !== "3100") {
    throw new Error(
      `${baseUrl} is not reachable. The dev:e2e script is fixed to port 3100; use CCV_DEMO_SERVER=production for another port.`,
    );
  }
  const pnpmArgs =
    serverMode === "dev"
      ? ["--filter", "@card-condition-vault/web", "dev:e2e"]
      : ["--filter", "@card-condition-vault/web", "exec", "next", "start", "-H", hostname, "-p", port];

  if (serverMode !== "dev") {
    console.log("Building @card-condition-vault/web before recording production GIFs...");
    runPnpm(["--filter", "@card-condition-vault/web", "build"]);
  }

  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${pnpmArgs.join(" ")}`]
      : pnpmArgs;
  const child = spawn(command, args, {
    cwd: root,
    env: demoEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    if (/ready|localhost|127\.0\.0\.1|started server/i.test(text)) {
      process.stdout.write(text);
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));

  await waitForServer(`${baseUrl}/workspace`);
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function cleanRawPlaywrightVideos() {
  for (const file of readdirSync(videoDir)) {
    if (file.startsWith("page@") && file.endsWith(".webm")) {
      try {
        rmSync(join(videoDir, file), { force: true });
      } catch (error) {
        if (error?.code !== "EBUSY") throw error;
        console.warn(`Skipped locked Playwright temp video: ${file}`);
      }
    }
  }
}

async function recordFlow({ name, viewport, isMobile = false, action }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
    recordVideo: {
      dir: videoDir,
      size: viewport,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await action(page);

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) throw new Error(`Playwright did not record video for ${name}`);
  const rawPath = await video.path();
  const finalPath = join(videoDir, `${name}.webm`);
  if (existsSync(finalPath)) rmSync(finalPath, { force: true });
  renameSync(rawPath, finalPath);
  return finalPath;
}

async function recordFlowWithRetry(flow) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await recordFlow(flow);
    } catch (error) {
      lastError = error;
      console.warn(`Retrying ${flow.name}; attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      await wait(1200);
    }
  }
  throw lastError;
}

function makeGif(input, output, { start = "0.3", duration = "8", width = "960", fps = 12 } = {}) {
  run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-ss",
    start,
    "-t",
    duration,
    "-vf",
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
    "-loop",
    "0",
    output,
  ]);
}

function makeGifFromFrames(framesDir, output, { width = "960", fps = 5 } = {}) {
  run("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    join(framesDir, "frame-%04d.png"),
    "-vf",
    `scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
    "-loop",
    "0",
    output,
  ]);
}

async function recordScreenshotFlow({ name, viewport, isMobile = false, action }) {
  const frameDir = join(videoDir, `${name}-frames`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  let frameIndex = 0;
  const captureHold = async (ms, interval = 250) => {
    const frames = Math.max(1, Math.ceil(ms / interval));
    for (let index = 0; index < frames; index += 1) {
      await page.screenshot({
        animations: "allow",
        fullPage: false,
        path: join(frameDir, `frame-${String(frameIndex).padStart(4, "0")}.png`),
      });
      frameIndex += 1;
      await wait(interval);
    }
  };

  await action(page, captureHold);
  if (frameIndex === 0) {
    await captureHold(500, 250);
  }
  await context.close();
  await browser.close();
  return frameDir;
}

async function workspaceUpload(page) {
  await page.goto(`${baseUrl}/workspace`);
  await page.waitForSelector(".magic-workspace");
  await page.waitForTimeout(700);
  await page.getByText("Upload photo", { exact: true }).click();
  await page.locator('[data-testid="agent-upload-input"]').setInputFiles(sampleImage);
  await page.getByAltText("roboflow-tauros-real-card.jpg").waitFor();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "Analyze upload" }).click();
  await page.getByText("Run DING detector", { exact: false }).waitFor();
  await page.waitForTimeout(3500);
  await page.getByText("Analysis complete", { exact: false }).waitFor({ timeout: 45_000 });
  await page.locator(".agent-message.tool").last().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Save reviewed card" }).click();
  await page.getByText("Persistence:", { exact: false }).waitFor({ timeout: 15_000 });
  await page.locator(".agent-message.tool").last().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(2200);
}

async function scanUpload(page) {
  await page.goto(`${baseUrl}/scan?mode=upload`);
  await page.waitForSelector(".scan-upload-dropzone");
  await page.locator(".scan-upload-dropzone input[type='file']").setInputFiles(sampleImage);
  await page.waitForSelector(".scan-analyze-canvas");
  await page.waitForTimeout(11_500);
}

async function scanSample(page) {
  await page.goto(`${baseUrl}/scan?mode=sample`);
  await page.waitForSelector(".scan-analyze-canvas", { timeout: 30_000 });
  await page.waitForTimeout(11_500);
}

async function examplesLibrary(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/examples`);
  await page.waitForSelector(".examples-grid");
  await hold(900);
  await page.locator(".examples-failure-toggle input").check();
  await wait(500);
  await hold(1000);
  await page.locator("#examples-tier").selectOption("all").catch(() => {});
  await hold(900);
  let firstExample = page.locator(".examples-grid a").first();
  if ((await firstExample.count()) === 0) {
    await page.locator(".examples-failure-toggle input").uncheck().catch(() => {});
    await page.locator("#examples-tier").selectOption("all").catch(() => {});
    await hold(700);
    firstExample = page.locator(".examples-grid a").first();
  }
  await firstExample.waitFor({ timeout: 10_000 });
  await firstExample.click();
  await hold(2300);
}

async function realDingAnnotations(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/examples/roboflow-tauros-real-ding-annotations`);
  await page.waitForSelector(".example-image-stage");
  await page.waitForSelector(".example-ding");
  await hold(1300);
  await page.getByLabel("Material-to-grade only").check();
  await hold(1100);
  await page.getByLabel("Material-to-grade only").uncheck();
  await hold(1100);
  await page.locator(".example-ding-list").first().scrollIntoViewIfNeeded();
  await hold(1800);
}

async function methodsBoard(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/methods?celebrate=holo_glare_reinspection_v1`);
  await page.waitForSelector(".methods-shell");
  await hold(1600);
  await page.getByRole("button", { name: "Bounties" }).click();
  await hold(900);
  await page.getByRole("button", { name: "Open Source Registry" }).click();
  await hold(1500);
}

async function certImport(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/certs/import`);
  await page.waitForSelector(".cert-import-shell");
  await hold(900);
  await page.getByRole("button", { name: "Import certified references" }).click();
  await page.getByText("Certified references imported", { exact: false }).waitFor({ timeout: 20_000 });
  await hold(1400);
  await page.locator(".cert-import-table a").first().scrollIntoViewIfNeeded();
  await hold(1600);
}

async function certReferenceBenchmark(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/benchmarks/certified-references`);
  await page.waitForSelector(".benchmarks-shell");
  await hold(1100);
  await page.locator("text=Grade distribution").scrollIntoViewIfNeeded();
  await hold(1200);
  await page.locator("text=Reference registry").scrollIntoViewIfNeeded();
  await hold(1400);
}

async function beforeAfterCompare(page, hold = async (ms) => wait(ms)) {
  await page.goto(`${baseUrl}/compare`);
  await page.waitForSelector(".compare-shell");
  await hold(900);
  await page.getByRole("button", { name: "Swipe compare" }).click();
  await hold(900);
  const slider = page.locator(".compare-swipe-slider");
  await slider.fill("68");
  await hold(900);
  await page.getByRole("button", { name: "Diff overlay" }).click();
  await hold(1700);
}

const flows = [
  {
    name: "real-card-upload-agent-workspace-desktop",
    label: "Real card upload through agent workspace - desktop",
    description: "Uploads the Roboflow Tauros card in the chat sidebar, runs the checklist, and saves the reviewed card.",
    viewport: { width: 1440, height: 1000 },
    action: workspaceUpload,
    gif: { start: "0.5", duration: "15", width: "960", fps: 12 },
  },
  {
    name: "real-card-upload-agent-workspace-mobile",
    label: "Real card upload through agent workspace - mobile",
    description: "Mobile-sized agent workspace with the uploaded real card visible and the model checklist running.",
    viewport: { width: 390, height: 900 },
    isMobile: true,
    action: workspaceUpload,
    gif: { start: "0.5", duration: "14", width: "390", fps: 12 },
  },
  {
    name: "upload-checklist-zoom-inspection-desktop",
    label: "Upload-first checklist with zoom inspection - desktop",
    description: "Shows the actual uploaded card, streaming checklist rows, and zoom-lens region inspection.",
    viewport: { width: 1440, height: 900 },
    action: scanUpload,
    gif: { start: "0.3", duration: "11", width: "960", fps: 14 },
  },
  {
    name: "sample-scan-checklist-zoom-inspection-mobile",
    label: "Sample scan checklist with zoom inspection - mobile",
    description: "Mobile capture/result transition with real-time status updates and visual inspection states.",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    action: scanSample,
    gif: { start: "0.3", duration: "11", width: "390", fps: 14 },
  },
  {
    name: "verified-outcome-library-trust-explorer",
    label: "Verified Outcome Library trust explorer",
    description: "Filters the public examples, shows failure cases, and opens an inspectable outcome page.",
    viewport: { width: 1440, height: 1000 },
    capture: "screenshots",
    action: examplesLibrary,
    gif: { start: "0.3", duration: "6", width: "960", fps: 10 },
  },
  {
    name: "real-ding-annotations-tauros-card-desktop",
    label: "Real DING annotations with labels - Tauros card",
    description: "Opens the real Tauros card fixture, shows DING bboxes, labels, confidence, materiality, and selected-DING notes on actual card pixels.",
    viewport: { width: 1440, height: 1000 },
    capture: "screenshots",
    action: realDingAnnotations,
    gif: { start: "0.3", duration: "7", width: "960", fps: 10 },
  },
  {
    name: "real-ding-annotations-tauros-card-mobile",
    label: "Real DING annotations with labels - mobile",
    description: "Mobile trust view of the real Tauros card fixture with labeled DING overlays visible.",
    viewport: { width: 390, height: 900 },
    isMobile: true,
    capture: "screenshots",
    action: realDingAnnotations,
    gif: { start: "0.3", duration: "7", width: "390", fps: 10 },
  },
  {
    name: "certified-reference-import-eval-workbench",
    label: "Certified reference import and eval workbench",
    description: "Imports the friend PSA/TAG references, shows Silver/Silver+ policy badges, and makes the Gold upgrade gap visible.",
    viewport: { width: 1440, height: 1000 },
    capture: "screenshots",
    action: certImport,
    gif: { start: "0.3", duration: "6", width: "960", fps: 10 },
  },
  {
    name: "certified-reference-benchmark-grade-spread",
    label: "Certified reference benchmark grade spread",
    description: "Shows the PSA 5/6/8/9/10 spread, Silver/Silver+ status, and the blocked deployability gate.",
    viewport: { width: 1440, height: 1000 },
    capture: "screenshots",
    action: certReferenceBenchmark,
    gif: { start: "0.3", duration: "6", width: "960", fps: 10 },
  },
  {
    name: "community-verified-methods-reward-board",
    label: "Community verified methods reward board",
    description: "Shows the verified-method reward toast, open bounties, and open-source method registry.",
    viewport: { width: 1440, height: 1000 },
    capture: "screenshots",
    action: methodsBoard,
    gif: { start: "0.3", duration: "6", width: "960", fps: 10 },
  },
  {
    name: "before-after-evidence-compare-dispute",
    label: "Before/after evidence compare and dispute flow",
    description: "Switches from split view to swipe compare and diff overlay with DING candidates visible.",
    viewport: { width: 1440, height: 900 },
    capture: "screenshots",
    action: beforeAfterCompare,
    gif: { start: "0.3", duration: "5", width: "960", fps: 10 },
  },
];

cleanRawPlaywrightVideos();
const spawnedServer = await ensureServer();
const outputs = [];

try {
  for (const flow of flows) {
    console.log(`Recording ${flow.name}`);
    const gifPath = join(gifDir, `${flow.name}.gif`);
    let sourceVideo;
    let sourceFrames;
    if (flow.capture === "screenshots") {
      const framesDir = await recordScreenshotFlow(flow);
      makeGifFromFrames(framesDir, gifPath, { width: flow.gif.width, fps: 5 });
      sourceFrames = `public/demo/videos/${flow.name}-frames`;
    } else {
      const video = await recordFlowWithRetry(flow);
      makeGif(video, gifPath, flow.gif);
      sourceVideo = `public/demo/videos/${flow.name}.webm`;
    }
    outputs.push({
      file: `public/demo/gifs/${flow.name}.gif`,
      label: flow.label,
      description: flow.description,
      ...(sourceVideo ? { sourceVideo } : {}),
      ...(sourceFrames ? { sourceFrames } : {}),
      viewport: flow.viewport,
      mobile: Boolean(flow.isMobile),
      loop: "infinite",
    });
  }

  const legacyAliases = [
    ["real-card-upload-agent-workspace-desktop.gif", "01-sample-card-analysis.gif"],
    ["sample-scan-checklist-zoom-inspection-mobile.gif", "02-scanner-quality-gate.gif"],
    ["real-ding-annotations-tauros-card-desktop.gif", "03-ding-correction.gif"],
    ["before-after-evidence-compare-dispute.gif", "04-before-after-dispute.gif"],
  ];

  for (const [source, alias] of legacyAliases) {
    copyFileSync(join(gifDir, source), join(gifDir, alias));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    note: "Descriptive GIFs are the source of truth; 01-04 files remain compatibility aliases for older docs.",
    gifs: outputs,
    legacyAliases: legacyAliases.map(([source, alias]) => ({
      file: `public/demo/gifs/${alias}`,
      source: `public/demo/gifs/${source}`,
    })),
  };
  writeFileSync(join(gifDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  cpSync(gifDir, appGifDir, { recursive: true });
  cleanRawPlaywrightVideos();
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  stopServer(spawnedServer);
}
