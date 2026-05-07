import { chromium } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3000/workspace";
const sampleImage = join(root, "apps", "web", "public", "demo", "sample-cards", "roboflow-tauros-real-card.jpg");
const videoDir = join(root, "public", "demo", "videos");
const gifDir = join(root, "public", "demo", "gifs");

mkdirSync(videoDir, { recursive: true });
mkdirSync(gifDir, { recursive: true });

if (!existsSync(sampleImage)) {
  throw new Error(`Missing sample image at ${sampleImage}`);
}

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

async function recordFlow({ name, viewport, isMobile = false, scrollChecklist = false }) {
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
  page.setDefaultTimeout(45_000);

  await page.goto(baseUrl);
  await page.waitForSelector(".magic-workspace");
  await page.waitForTimeout(700);

  await page.getByText("Upload photo", { exact: true }).click();
  await page.locator('[data-testid="agent-upload-input"]').setInputFiles(sampleImage);
  await page.getByAltText("roboflow-tauros-real-card.jpg").waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Analyze upload"));
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.waitForTimeout(650);

  await page.getByRole("button", { name: "Analyze upload" }).click();
  await page.getByText("Run DING detector", { exact: false }).waitFor();
  if (scrollChecklist) {
    await page.getByText("Run checklist", { exact: false }).scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(1600);
  await page.getByText("Analysis complete", { exact: false }).waitFor();
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: "Save reviewed card" }).click();
  await page.waitForTimeout(1400);

  const video = page.video();
  await context.close();
  await browser.close();

  const rawPath = await video.path();
  const finalPath = join(videoDir, `${name}.webm`);
  try {
    if (existsSync(finalPath)) {
      rmSync(finalPath);
    }
    renameSync(rawPath, finalPath);
  } catch (error) {
    // Playwright may already have written to the target on retries.
    if (!existsSync(finalPath)) {
      throw error;
    }
  }
  return finalPath;
}

function makeGif(input, output, { start = "0", duration = "8", width = "960" } = {}) {
  run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-ss",
    start,
    "-t",
    duration,
    "-vf",
    `fps=12,scale=${width}:-1:flags=lanczos`,
    output,
  ]);
}

const desktopVideo = await recordFlow({
  name: "workspace-upload-analysis-desktop",
  viewport: { width: 1440, height: 1000 },
});

const mobileVideo = await recordFlow({
  name: "workspace-upload-analysis-mobile",
  viewport: { width: 390, height: 900 },
  isMobile: true,
  scrollChecklist: true,
});

makeGif(desktopVideo, join(gifDir, "01-sample-card-analysis.gif"), { start: "0.6", duration: "12", width: "960" });
makeGif(mobileVideo, join(gifDir, "02-scanner-quality-gate.gif"), { start: "0.6", duration: "12", width: "390" });
makeGif(desktopVideo, join(gifDir, "03-ding-correction.gif"), { start: "2.8", duration: "7", width: "960" });
makeGif(desktopVideo, join(gifDir, "04-before-after-dispute.gif"), { start: "4.6", duration: "3", width: "960" });

cpSync(join(root, "public", "demo", "gifs"), join(root, "apps", "web", "public", "demo", "gifs"), {
  recursive: true,
});
cleanRawPlaywrightVideos();

console.log(
  JSON.stringify(
    {
      baseUrl,
      desktopVideo,
      mobileVideo,
      gifs: [
        "public/demo/gifs/01-sample-card-analysis.gif",
        "public/demo/gifs/02-scanner-quality-gate.gif",
        "public/demo/gifs/03-ding-correction.gif",
        "public/demo/gifs/04-before-after-dispute.gif",
      ],
    },
    null,
    2,
  ),
);
