#!/usr/bin/env node
/**
 * Browser dogfood for the collapsed /dealer hero:
 * drop one real card photo, wait for the decision card, accept findings,
 * save the signed proof packet, open See why, and verify mobile has no
 * document-level horizontal overflow. Requires the web app and inference API.
 */

import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const externalBaseUrl = process.env.CCV_DEMO_URL?.replace(/\/$/, "");
const managedPort = process.env.CCV_DEALER_HERO_PORT ?? "3202";
const baseUrl = externalBaseUrl ?? `http://127.0.0.1:${managedPort}`;

function firstExisting(candidates) {
  for (const candidate of candidates) {
    const path = resolve(ROOT, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`No hero fixture image found from: ${candidates.join(", ")}`);
}

const fixture = firstExisting([
  "apps/web/public/demo/sample-cards/roboflow-tauros-real-card.jpg",
  "apps/web/public/examples/corner-wear.png",
]);

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
  const pnpmEntrypoint = process.env.npm_execpath;
  const command = pnpmEntrypoint ? process.execPath : "pnpm";
  const args = pnpmEntrypoint
    ? [pnpmEntrypoint, "--filter", "@card-condition-vault/web", "start"]
    : ["--filter", "@card-condition-vault/web", "start"];
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, PORT: managedPort },
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

async function runHero(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
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

  await page.goto(`${baseUrl}/dealer`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Drop card photo. Get decision. Save proof.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await checkNoOverflow(page, `${label} idle`);

  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator(".dealer-decision-card")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("14 stages")).toBeVisible();
  await expect(page.locator(".dealer-hero-bbox").first()).toBeVisible();

  const acceptAll = page.getByRole("button", { name: "Accept all findings" });
  if ((await acceptAll.count()) > 0) {
    await acceptAll.click();
  }

  await page.getByRole("button", { name: "Save proof packet" }).click();
  await expect(page.getByRole("button", { name: "Proof saved" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Public report:/)).toBeVisible();

  await page.getByRole("button", { name: /See why/ }).click();
  await expect(page.getByText("Stage timeline")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await checkNoOverflow(page, `${label} decision`);

  if (consoleErrors.length) throw new Error(`${label} console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  if (networkFailures.length) throw new Error(`${label} network failures: ${networkFailures.slice(0, 3).join(" | ")}`);

  await browser.close();
  console.log(`OK ${label}: /dealer hero uploaded ${fixture}, decision rendered, proof saved, See why opened.`);
}

let server = null;
try {
  server = startManagedWebServer();
  await waitForServer(`${baseUrl}/dealer`);
  await runHero({ width: 1440, height: 900 }, "desktop");
  await runHero({ width: 390, height: 844 }, "mobile");
} finally {
  stopManagedWebServer(server);
}
