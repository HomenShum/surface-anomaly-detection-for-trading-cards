#!/usr/bin/env node
/**
 * Records the web rips reveal flow as shareable desktop and mobile GIFs.
 *
 * Outputs:
 *   public/demo/videos/14-rips-web-reveal-*.webm
 *   public/demo/gifs/14-rips-web-reveal-*.gif
 *   apps/web/public/demo/gifs/14-rips-web-reveal-*.gif
 */

import { chromium } from "@playwright/test";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3215";
const videoDir = join(root, "public", "demo", "videos");
const gifDir = join(root, "public", "demo", "gifs");
const appGifDir = join(root, "apps", "web", "public", "demo", "gifs");

mkdirSync(videoDir, { recursive: true });
mkdirSync(gifDir, { recursive: true });
mkdirSync(appGifDir, { recursive: true });

function demoEnv() {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-rips-gif-recorder-secret",
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseUrl,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: demoEnv(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}

function runPnpm(args) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const finalArgs = process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`] : args;
  run(command, finalArgs);
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
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
  if (await canReach(`${baseUrl}/rips`)) return null;

  const parsedBaseUrl = new URL(baseUrl);
  const hostname = parsedBaseUrl.hostname || "127.0.0.1";
  const port = parsedBaseUrl.port || "3215";
  runPnpm(["--filter", "@card-condition-vault/web", "build"]);

  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm --filter @card-condition-vault/web exec next start -H ${hostname} -p ${port}`]
      : ["--filter", "@card-condition-vault/web", "exec", "next", "start", "-H", hostname, "-p", port];
  const child = spawn(command, args, {
    cwd: root,
    env: demoEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    if (/ready|localhost|127\.0\.0\.1|started server/i.test(text)) process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
  await waitForServer(`${baseUrl}/rips`);
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function recordFlow({ name, viewport, isMobile = false }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  await page.goto(`${baseUrl}/rips`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open pack", exact: true }).click();
  await page.getByRole("button", { name: "Auto rip", exact: true }).click();
  await page.getByText("Reveal complete").waitFor({ state: "visible", timeout: 15_000 });
  await wait(900);
  await page.getByRole("button", { name: "Hold in vault", exact: true }).click();
  await page.getByText("Decision saved: vault.").waitFor({ state: "visible", timeout: 10_000 });
  await wait(1200);

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

function makeGif(input, output, { start = "0", duration = "7.5", width = "960", fps = 12 } = {}) {
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

async function main() {
  const server = await ensureServer();
  try {
    const flows = [
      { name: "14-rips-web-reveal-desktop", viewport: { width: 1440, height: 920 }, isMobile: false, width: "960" },
      { name: "14-rips-web-reveal-mobile", viewport: { width: 390, height: 844 }, isMobile: true, width: "390" },
    ];

    for (const flow of flows) {
      const video = await recordFlow(flow);
      const gif = join(gifDir, `${flow.name}.gif`);
      makeGif(video, gif, { width: flow.width });
      copyFileSync(gif, join(appGifDir, `${flow.name}.gif`));
      console.log(`Recorded ${flow.name}: ${gif}`);
    }
  } finally {
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
