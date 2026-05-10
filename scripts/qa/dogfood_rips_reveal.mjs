#!/usr/bin/env node
/**
 * Browser dogfood for /rips:
 * open the web-rip prototype, trigger a pack reveal, save a vault decision,
 * and verify desktop/mobile have no document overflow or console errors.
 */

import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const externalBaseUrl = process.env.CCV_DEMO_URL?.replace(/\/$/, "");
const managedPort = process.env.CCV_RIPS_PORT ?? "3214";
const baseUrl = externalBaseUrl ?? `http://127.0.0.1:${managedPort}`;

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startManagedWebServer() {
  if (externalBaseUrl) return null;
  const webCwd = join(ROOT, "apps", "web");
  const buildIdPath = join(webCwd, ".next", "BUILD_ID");
  const serverManifestPath = join(webCwd, ".next", "server", "pages-manifest.json");
  const shouldBuild = process.env.CCV_SKIP_BUILD !== "1";
  if (shouldBuild || !existsSync(buildIdPath) || !existsSync(serverManifestPath)) {
    const nextDir = join(webCwd, ".next");
    if (existsSync(nextDir)) {
      const resolvedNextDir = resolve(nextDir);
      if (!resolvedNextDir.startsWith(resolve(webCwd))) {
        throw new Error(`Refusing to clean unexpected path: ${resolvedNextDir}`);
      }
      rmSync(resolvedNextDir, { recursive: true, force: true });
    }
    const buildCommand = process.platform === "win32" ? "cmd.exe" : "pnpm";
    const buildArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm build"] : ["build"];
    const build = spawnSync(buildCommand, buildArgs, {
      cwd: webCwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (build.status !== 0) throw new Error(`pnpm build failed with status ${build.status}`);
  }

  const pnpmEntrypoint = process.env.npm_execpath;
  const command = pnpmEntrypoint ? process.execPath : process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = pnpmEntrypoint
    ? [pnpmEntrypoint, "start"]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm start"]
      : ["start"];
  const child = spawn(command, args, {
    cwd: webCwd,
    env: {
      ...process.env,
      PORT: managedPort,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseUrl,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-rips-qa-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function stopManagedWebServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function checkNoOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.scrollWidth;
    const viewport = window.innerWidth;
    return width > viewport + 1 ? { width, viewport } : null;
  });
  if (overflow) throw new Error(`${label} overflow: scrollWidth=${overflow.width} viewport=${overflow.viewport}`);
}

async function dragPackOpen(page, label, from, to) {
  const stage = page.getByTestId("rip-pack-stage");
  await expect(stage).toBeVisible();
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (!box) throw new Error(`${label} rip pack stage has no bounding box`);
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 14 });
  await page.mouse.up();
  await expect(page.getByText(/Reveal complete/)).toBeVisible({ timeout: 15_000 });
}

async function resetSeal(page) {
  const reset = page.getByRole("button", { name: "Reset seal", exact: true });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page.getByRole("button", { name: "Open pack" })).toBeVisible();
}

async function runRips(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    hasTouch: viewport.width < 600,
    isMobile: viewport.width < 600,
    viewport,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const consoleErrors = [];
  const networkFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (!failure.includes("ABORTED")) networkFailures.push(`${failure} ${request.url()}`);
  });

  await page.goto(`${baseUrl}/rips`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Rip a sealed pack on web/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open pack" })).toBeVisible();
  await checkNoOverflow(page, `${label} idle`);

  const dragCases = viewport.width < 600
    ? [
        [`${label} down-right`, { x: 0.2, y: 0.22 }, { x: 0.86, y: 0.72 }],
        [`${label} up-left`, { x: 0.82, y: 0.76 }, { x: 0.18, y: 0.18 }],
        [`${label} horizontal`, { x: 0.12, y: 0.48 }, { x: 0.88, y: 0.5 }],
      ]
    : [
        [`${label} down-right`, { x: 0.2, y: 0.22 }, { x: 0.84, y: 0.72 }],
        [`${label} up-left`, { x: 0.82, y: 0.76 }, { x: 0.18, y: 0.18 }],
        [`${label} horizontal`, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.48 }],
        [`${label} vertical`, { x: 0.52, y: 0.9 }, { x: 0.48, y: 0.1 }],
        [`${label} down-left`, { x: 0.86, y: 0.2 }, { x: 0.14, y: 0.78 }],
      ];

  for (let i = 0; i < dragCases.length; i += 1) {
    const [caseLabel, from, to] = dragCases[i];
    if (i > 0) await resetSeal(page);
    await dragPackOpen(page, caseLabel, from, to);
  }

  await expect(page.getByText(/Estimated value/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sell for vault credit" })).toBeEnabled();
  await page.getByRole("button", { name: "Sell for vault credit" }).click();
  await expect(page.getByText(/Decision saved: sell/)).toBeVisible();
  await expect(page.getByText(/Sold to vault credit/)).toBeVisible();
  await checkNoOverflow(page, `${label} revealed`);

  if (consoleErrors.length) throw new Error(`${label} console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  if (networkFailures.length) throw new Error(`${label} network failures: ${networkFailures.slice(0, 3).join(" | ")}`);

  await browser.close();
  console.log(`OK ${label}: /rips opened, pack revealed, decision saved.`);
}

let server = null;
try {
  server = startManagedWebServer();
  await waitForServer(`${baseUrl}/rips`);
  await runRips({ width: 1440, height: 920 }, "desktop");
  await runRips({ width: 390, height: 844 }, "mobile");
} finally {
  stopManagedWebServer(server);
}
