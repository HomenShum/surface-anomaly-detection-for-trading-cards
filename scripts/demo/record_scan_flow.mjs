// Records the new /scan flow end-to-end: question form skipped via ?mode=sample
// → 14-stage checklist → 4-corner + 4-edge zoom-lens animation → report.
// Output: webm video + GIF under public/demo/gifs and apps/web/public/demo/gifs.

import { chromium } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Default port matches the FastAPI CORS allowlist
// (services/inference-api/app/main.py: localhost:3100). Override via
// CCV_DEMO_URL when running against a different prod build.
const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100";
const videoDir = join(root, "public", "demo", "videos");
const gifDir = join(root, "public", "demo", "gifs");

mkdirSync(videoDir, { recursive: true });
mkdirSync(gifDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function cleanRawPlaywrightVideos() {
  for (const file of readdirSync(videoDir)) {
    if (file.startsWith("page@") && file.endsWith(".webm")) {
      rmSync(join(videoDir, file), { force: true });
    }
  }
}

cleanRawPlaywrightVideos();

async function recordFlow({ name, viewport, isMobile = false }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    recordVideo: {
      dir: videoDir,
      size: viewport,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  // Land directly in sample-mode → ScanFlowClient autostarts the pipeline.
  await page.goto(`${baseUrl}/scan?mode=sample`);
  // Wait for the analyze stage to mount and the canvas to appear.
  await page.waitForSelector(".scan-analyze-canvas", { timeout: 30_000 });

  // Watch the lens fire through 4 corners + 4 edges. Total budget:
  //   corners 4 × 950ms + edges 4 × 750ms ≈ 6.8s
  // Plus surface (~520ms) + DING-await (offline → fails fast) + report-build animations (~2s).
  // Give it 12s of generous headroom; the inference call against localhost:8000
  // will fail fast on this recording machine if FastAPI isn't up, which is fine —
  // the flow still surfaces real frame-quality + the lens animation is the focus.
  await page.waitForTimeout(12_000);

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error("Playwright did not record a video");
  }

  const rawPath = await video.path();
  const finalPath = join(videoDir, `${name}.webm`);
  try {
    if (existsSync(finalPath)) rmSync(finalPath);
    renameSync(rawPath, finalPath);
  } catch (error) {
    if (!existsSync(finalPath)) throw error;
  }
  return finalPath;
}

function makeGif(input, output, { start = "0", duration = "12", width = "960", fps = 14 } = {}) {
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
    output,
  ]);
}

const desktopVideo = await recordFlow({
  name: "scan-end-to-end-desktop",
  viewport: { width: 1440, height: 900 },
});

const mobileVideo = await recordFlow({
  name: "scan-end-to-end-mobile",
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

const desktopGif = join(gifDir, "scan-end-to-end-desktop.gif");
const mobileGif = join(gifDir, "scan-end-to-end-mobile.gif");

makeGif(desktopVideo, desktopGif, { start: "0.4", duration: "11", width: "960", fps: 14 });
makeGif(mobileVideo, mobileGif, { start: "0.4", duration: "11", width: "390", fps: 14 });

cpSync(gifDir, join(root, "apps", "web", "public", "demo", "gifs"), { recursive: true });
cleanRawPlaywrightVideos();

console.log(
  JSON.stringify(
    {
      baseUrl,
      desktopVideo,
      mobileVideo,
      gifs: [desktopGif, mobileGif],
    },
    null,
    2,
  ),
);
