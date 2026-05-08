#!/usr/bin/env node
/**
 * Browser dogfood for the collapsed /dealer hero:
 * drop one real card photo, wait for the decision card, accept findings,
 * save the signed proof packet, open See why, and verify mobile has no
 * document-level horizontal overflow. Requires the web app and inference API.
 */

import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-dealer-hero-qa-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    process.stderr.write(String(error?.message ?? error));
  });
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
  await expect(page.locator(".dealer-hero-prompt")).toHaveText("Drop card photo. Get decision. Save proof.");
  await expect(page.getByRole("heading", { name: "Scan cards into a condition evidence vault." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload card photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try sample card" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open saved vault" })).toBeVisible();
  await expect(page.getByText("Vendor pilot vault")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dashboard/i }).first()).toBeVisible();
  await expect(page.getByText(/HMAC-signed proof packets/)).toBeVisible();
  await checkNoOverflow(page, `${label} idle`);

  await page.getByRole("button", { name: "Try sample card" }).click();
  try {
    await expect(page.locator(".dealer-decision-card")).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1400)).catch(() => "");
    throw new Error(
      `${label} decision card did not render after sample click. console=${consoleErrors
        .slice(0, 3)
        .join(" | ")} network=${networkFailures.slice(0, 3).join(" | ")} body=${bodyText}`,
      { cause: error },
    );
  }
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
