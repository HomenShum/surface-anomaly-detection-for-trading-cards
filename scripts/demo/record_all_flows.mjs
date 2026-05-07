// Records multiple end-to-end flows as webm + GIF for sharing with vendor friends.
//
// Flows (each desktop + mobile unless noted):
//   01-scan-end-to-end          /scan?mode=sample · 14-stage checklist + zoom-lens
//   02-landing-trust-onboarding /             · landing with outcome library + methods strips
//   03-examples-library-tour    /examples           · gallery filters + condition ladder
//   04-example-detail-grader    /examples/<slug>    · DING overlay toggles + grader comparison panel
//   05-methods-board-flywheel   /methods            · verified methods board + reward toast
//   06-benchmarks-transparency  /benchmarks         · per-class YOLO metrics + dataset provenance
//
// Output: public/demo/gifs/<flow>-<viewport>.gif (also copied to apps/web/public/demo/gifs/)
//
// Usage:
//   node scripts/demo/record_all_flows.mjs                  → all flows × desktop+mobile
//   node scripts/demo/record_all_flows.mjs scan landing     → only those flows
//   FLOWS=examples node scripts/demo/record_all_flows.mjs   → env-var override
//   CCV_DEMO_URL=http://127.0.0.1:3006 node scripts/demo/record_all_flows.mjs

import { chromium } from "@playwright/test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Default port matches the FastAPI CORS allowlist
// (services/inference-api/app/main.py: localhost:3100). Override with
// CCV_DEMO_URL when running against a different prod build.
const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100";
const videoDir = join(root, "public", "demo", "videos");
const gifDir = join(root, "public", "demo", "gifs");

mkdirSync(videoDir, { recursive: true });
mkdirSync(gifDir, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// ─── Flow definitions ───────────────────────────────────────────────────────

/**
 * @typedef {Object} Flow
 * @property {string} name             slug used in the output filename
 * @property {(page: import("@playwright/test").Page, viewport: {width:number,height:number}) => Promise<void>} run
 * @property {{startSeconds: string, durationSeconds: string, fpsDesktop?: number, fpsMobile?: number}} gif
 * @property {boolean} [mobileOnly]
 * @property {boolean} [desktopOnly]
 */

/** @type {Flow[]} */
const FLOWS = [
  {
    name: "01-scan-end-to-end",
    async run(page) {
      await page.goto(`${baseUrl}/scan?mode=sample`);
      await page.waitForSelector(".scan-analyze-canvas", { timeout: 30_000 });
      // 12s budget covers 14-stage checklist + corners (4×950ms) + edges (4×750ms) + report build.
      await page.waitForTimeout(12_000);
      // After the checklist completes, scroll into the rendered report so the
      // GIF captures the final DING bounding-box overlays + label chips that
      // the post-scan ReportClient renders. Without this scroll the recording
      // ends before the bboxes paint and the demo never shows real DINGs.
      const dingBox = page.locator(".ding-box, .ding-overlay, .scan-report-canvas").first();
      if (await dingBox.count()) {
        await dingBox.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(2400);
      } else {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(2400);
      }
    },
    gif: { startSeconds: "0.4", durationSeconds: "14", fpsDesktop: 12, fpsMobile: 12 },
  },
  {
    name: "02-landing-trust-onboarding",
    async run(page) {
      await page.goto(`${baseUrl}/`);
      // Wait for outcome strip to be present.
      await page.waitForSelector(".landing-community-strip", { timeout: 15_000 });
      await page.waitForTimeout(800);
      // Slow scroll down through the landing to surface the Outcome Library + Community Methods.
      const totalScroll = 1800;
      const steps = 36;
      const dy = totalScroll / steps;
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(800);
    },
    gif: { startSeconds: "0", durationSeconds: "9", fpsDesktop: 12, fpsMobile: 12 },
  },
  {
    name: "03-examples-library-tour",
    async run(page, viewport) {
      await page.goto(`${baseUrl}/examples`);
      await page.waitForSelector(".examples-grid", { timeout: 15_000 });
      await page.waitForTimeout(1200);
      // Scroll partway to show the cards.
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(1500);
      // Toggle the "failure cases only" filter.
      const failureToggle = page.locator(".examples-failure-toggle input");
      if (viewport.width > 500 && (await failureToggle.count())) {
        await failureToggle.first().check();
        await page.waitForTimeout(1500);
        await failureToggle.first().uncheck();
        await page.waitForTimeout(1000);
      }
      // Switch to a tier filter.
      const tierSelect = page.locator("#examples-tier");
      if (await tierSelect.count()) {
        await tierSelect.selectOption("silver");
        await page.waitForTimeout(1500);
        await tierSelect.selectOption("all");
        await page.waitForTimeout(900);
      }
    },
    gif: { startSeconds: "0", durationSeconds: "10", fpsDesktop: 12, fpsMobile: 12 },
  },
  {
    name: "04-example-detail-grader",
    async run(page) {
      // DING annotation showcase: tour 3 hand-authored example cards back-to-
      // back so vendor / customer can see real labeled DING bounding boxes
      // (corner_wear, edge_whitening, scratch) plus the materiality label
      // ("DING" vs "cosmetic"), severity (moderate/major), and provenance.
      // Each card has the example-ding overlay with text label visible on
      // the image frame plus a textual DINGs (N) panel with description.
      const tour = ["roboflow-tauros-real-ding-annotations"];
      for (const slug of tour) {
        await page.goto(`${baseUrl}/examples/${slug}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".example-image-frame", { timeout: 15_000 });
        // Pull the image-frame into the viewport first. `loading="lazy"` on
        // the underlying <img> only fetches when in viewport, so on a wide
        // desktop viewport the image-frame can be slightly below the fold
        // when the page first renders.
        const frame = page.locator(".example-image-frame").first();
        await frame.scrollIntoViewIfNeeded().catch(() => {});
        // Force the lazy <img> to fetch by patching its `loading` attribute
        // and waiting for `complete + naturalWidth>0` so the GIF captures
        // a real card pixel rather than the dark placeholder.
        await page
          .waitForFunction(
            () => {
              const img = document.querySelector(".example-image-frame img");
              if (!(img instanceof HTMLImageElement)) return false;
              if (img.loading === "lazy") img.loading = "eager";
              return img.complete && img.naturalWidth > 0;
            },
            { timeout: 12_000 },
          )
          .catch(() => {});
        // Wait for the bbox overlay to mount on the image (the .example-ding
        // is rendered client-side after hydration).
        await page.waitForSelector(".example-ding", { timeout: 8_000 }).catch(() => {});
        // Hold on the labeled bbox for ~2.2s so the GIF captures
        // "DING · {type}" text on the actual card image.
        await page.waitForTimeout(2200);
        // Pull the DINGs (1) text panel into view so the type, severity,
        // and material-to-grade label are captured below the image.
        const dingList = page.locator(".example-ding-list").first();
        if (await dingList.count()) {
          await dingList.scrollIntoViewIfNeeded();
          await page.waitForTimeout(1500);
        }
      }
    },
    gif: { startSeconds: "0", durationSeconds: "8", fpsDesktop: 11, fpsMobile: 11 },
  },
  {
    name: "05-methods-board-flywheel",
    async run(page) {
      await page.goto(`${baseUrl}/methods`);
      await page.waitForSelector(".methods-section", { timeout: 15_000 });
      await page.waitForTimeout(1500);
      // Cycle through the tabs to show the registry diversity.
      const tabs = page.locator(".methods-tabs button");
      const tabCount = await tabs.count();
      for (let i = 1; i < Math.min(tabCount, 5); i += 1) {
        await tabs.nth(i).click();
        await page.waitForTimeout(1500);
      }
      // Back to Featured + scroll a bit.
      if (tabCount > 0) {
        await tabs.first().click();
        await page.waitForTimeout(1200);
      }
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1500);
    },
    gif: { startSeconds: "0", durationSeconds: "11", fpsDesktop: 12, fpsMobile: 12 },
    desktopOnly: true,
  },
  {
    name: "06-benchmarks-transparency",
    async run(page) {
      await page.goto(`${baseUrl}/benchmarks`);
      await page.waitForSelector(".benchmarks-summary", { timeout: 15_000 });
      await page.waitForTimeout(1200);
      // Walk down through every section.
      const totalScroll = 2400;
      const steps = 40;
      const dy = totalScroll / steps;
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(800);
    },
    gif: { startSeconds: "0", durationSeconds: "11", fpsDesktop: 11, fpsMobile: 11 },
    desktopOnly: true,
  },
  {
    name: "07-certs-import-pipeline",
    async run(page) {
      await page.goto(`${baseUrl}/certs/import`);
      await page.waitForSelector(".cert-import-shell", { timeout: 15_000 });
      await page.waitForTimeout(1100);
      // Linger on hero copy + scoreboard.
      await page.mouse.wheel(0, 380);
      await page.waitForTimeout(1600);
      // Cert-eval scoreboard with band-agreement totals.
      const scoreboard = page.locator(".cert-eval-scoreboard").first();
      if (await scoreboard.count()) {
        await scoreboard.scrollIntoViewIfNeeded();
        await page.waitForTimeout(2200);
      }
      // Friend-ask panel.
      const askPanel = page.locator(".friend-ask-panel").first();
      if (await askPanel.count()) {
        await askPanel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(2000);
      }
      // Cert-import textarea + table.
      const importGrid = page.locator(".cert-import-grid").first();
      if (await importGrid.count()) {
        await importGrid.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
      }
      const resultsTable = page.locator(".cert-import-table").first();
      if (await resultsTable.count()) {
        await resultsTable.scrollIntoViewIfNeeded();
        await page.waitForTimeout(2000);
      }
    },
    gif: { startSeconds: "0", durationSeconds: "12", fpsDesktop: 11, fpsMobile: 11 },
  },
  {
    name: "08-benchmarks-certified-references",
    async run(page) {
      await page.goto(`${baseUrl}/benchmarks/certified-references`);
      await page.waitForSelector(".benchmarks-summary", { timeout: 15_000 });
      await page.waitForTimeout(1200);
      // 4-tile summary including Band match rate.
      await page.waitForTimeout(800);
      // Slow scroll through grade-bucket table + reference registry.
      const totalScroll = 2200;
      const steps = 36;
      const dy = totalScroll / steps;
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(900);
    },
    gif: { startSeconds: "0", durationSeconds: "11", fpsDesktop: 11, fpsMobile: 11 },
    desktopOnly: true,
  },
  {
    name: "09-benchmarks-flywheel",
    async run(page) {
      await page.goto(`${baseUrl}/benchmarks/flywheel`);
      await page.waitForLoadState("networkidle", { timeout: 20_000 });
      await page.waitForTimeout(900);
      // System score + per-layer scoreboard up top.
      await page.waitForTimeout(1100);
      // Slow scroll through recommended-fixes panel + error buckets + per-cert table.
      const totalScroll = 2800;
      const steps = 42;
      const dy = totalScroll / steps;
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(900);
    },
    gif: { startSeconds: "0", durationSeconds: "12", fpsDesktop: 11, fpsMobile: 11 },
    desktopOnly: true,
  },
];

// ─── Plumbing ──────────────────────────────────────────────────────────────

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function demoEnv() {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-demo-gif-recorder-secret",
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseUrl,
  };
}

function runPnpm(args) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const finalArgs = process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`] : args;
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
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(url, timeoutMs = 120_000) {
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
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${pnpmArgs.join(" ")}`] : pnpmArgs;
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
      rmSync(join(videoDir, file), { force: true });
    }
  }
}

cleanRawPlaywrightVideos();

async function recordOne(flow, viewportLabel, viewport) {
  const isMobile = viewportLabel === "mobile";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  let flowError;
  try {
    await flow.run(page, viewport);
  } catch (error) {
    flowError = error;
    // Capture what we have so far — don't fail the whole batch.
    console.warn(`[record] flow ${flow.name} (${viewportLabel}) error:`, error?.message ?? error);
  }
  const video = page.video();
  await context.close();
  await browser.close();
  if (flowError) {
    throw new Error(
      `[record] flow ${flow.name} (${viewportLabel}) failed before GIF conversion: ${flowError?.message ?? flowError}`,
    );
  }
  if (!video) throw new Error(`Playwright did not record a video for ${flow.name}-${viewportLabel}`);
  const rawPath = await video.path();
  const finalPath = join(videoDir, `${flow.name}-${viewportLabel}.webm`);
  try {
    if (existsSync(finalPath)) rmSync(finalPath);
    renameSync(rawPath, finalPath);
  } catch (error) {
    if (!existsSync(finalPath)) throw error;
  }
  return finalPath;
}

function makeGif(input, output, options) {
  const fps = options.fps ?? 12;
  const width = options.width ?? 960;
  run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-ss",
    options.startSeconds ?? "0",
    "-t",
    options.durationSeconds ?? "10",
    "-vf",
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
    output,
  ]);
  const size = statSync(output).size;
  if (size < 50_000) {
    throw new Error(`GIF ${output} is only ${size} bytes; refusing to accept likely blank/error capture.`);
  }
}

// Selection: positional args + FLOWS env override.
const requested = (() => {
  const fromEnv = process.env.FLOWS ? process.env.FLOWS.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  const fromArgs = process.argv.slice(2);
  const requested = [...fromEnv, ...fromArgs];
  if (requested.length === 0) return null;
  return new Set(requested.map((entry) => entry.replace(/^-+/, "")));
})();

const flowsToRun = FLOWS.filter((flow) => {
  if (!requested) return true;
  if (requested.has(flow.name)) return true;
  // Allow short matches: "scan", "landing", etc.
  for (const alias of requested) {
    if (flow.name.includes(alias)) return true;
  }
  return false;
});

console.log(
  `[record] base=${baseUrl} flows=${flowsToRun.map((flow) => flow.name).join(", ")} (${flowsToRun.length} of ${FLOWS.length})`,
);

const outputs = [];
const spawnedServer = await ensureServer();
try {
  for (const flow of flowsToRun) {
    if (!flow.mobileOnly) {
      const desktopVideo = await recordOne(flow, "desktop", DESKTOP);
      const desktopGif = join(gifDir, `${flow.name}-desktop.gif`);
      makeGif(desktopVideo, desktopGif, {
        startSeconds: flow.gif.startSeconds,
        durationSeconds: flow.gif.durationSeconds,
        width: 960,
        fps: flow.gif.fpsDesktop ?? 12,
      });
      outputs.push({ flow: flow.name, viewport: "desktop", gif: desktopGif });
    }
    if (!flow.desktopOnly) {
      const mobileVideo = await recordOne(flow, "mobile", MOBILE);
      const mobileGif = join(gifDir, `${flow.name}-mobile.gif`);
      makeGif(mobileVideo, mobileGif, {
        startSeconds: flow.gif.startSeconds,
        durationSeconds: flow.gif.durationSeconds,
        width: 390,
        fps: flow.gif.fpsMobile ?? 12,
      });
      outputs.push({ flow: flow.name, viewport: "mobile", gif: mobileGif });
    }
  }

  cpSync(gifDir, join(root, "apps", "web", "public", "demo", "gifs"), { recursive: true });
  cleanRawPlaywrightVideos();

  console.log(JSON.stringify({ baseUrl, outputs }, null, 2));
} finally {
  stopServer(spawnedServer);
}
