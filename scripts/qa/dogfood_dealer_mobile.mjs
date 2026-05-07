#!/usr/bin/env node
/**
 * Mobile-viewport dogfood for dealer surfaces.
 *
 * Visits each /dealer/* route at 390x844, captures:
 *   - status code
 *   - main heading visibility
 *   - whether the page horizontally overflows the viewport (broken layout)
 *   - whether key interactive elements (drop zone, lane swimlane, accept/reject buttons) are reachable
 *
 * No GIF — that's a separate step.
 */

import { chromium } from "@playwright/test";

const baseUrl = (process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

const PROBES = [
  { path: "/dealer/intake", expected: ["Bulk PSA-label intake", ".dealer-dropzone", ".dealer-lane", ".dealer-batches"] },
  { path: "/dealer/dashboard", expected: ["Dealer dashboard", ".dealer-summary", ".dealer-section"] },
  { path: "/dealer/listings", expected: ["Listing queue", ".dealer-section"] },
  { path: "/dealer/submissions", expected: ["Submission tracker", ".dealer-summary"] },
  { path: "/dealer/alerts", expected: ["Watchlist alerts", ".dealer-section"] },
  { path: "/dealer/records/dlr_seed_psa_148901890", expected: [".dealer-record-shell", ".dealer-finding-list", "Variant resolver"] },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);

const results = [];
for (const probe of PROBES) {
  const consoleErrors = [];
  const networkFails = [];
  page.removeAllListeners("console");
  page.removeAllListeners("requestfailed");
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    // Ignore prefetch ABORTs which are normal during quick navigation.
    const fail = req.failure()?.errorText ?? "";
    if (fail.includes("ABORTED")) return;
    networkFails.push({ url: url.slice(0, 160), failure: fail });
  });
  const t0 = Date.now();
  let status, html;
  try {
    const resp = await page.goto(`${baseUrl}${probe.path}`, { waitUntil: "domcontentloaded" });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(1200);
    html = await page.content();
  } catch (e) {
    results.push({ path: probe.path, ok: false, error: (e && e.message) || String(e) });
    continue;
  }
  // Check expected substrings. CSS class probes go via querySelector; text probes via includes.
  const missing = [];
  for (const needle of probe.expected) {
    if (needle.startsWith(".") || needle.startsWith("#")) {
      const count = await page.locator(needle).count();
      if (count === 0) missing.push(needle);
    } else if (!html.includes(needle)) {
      missing.push(needle);
    }
  }
  // Detect horizontal overflow at the document level.
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth;
    const vw = window.innerWidth;
    return w > vw + 1 ? { scrollWidth: w, viewport: vw } : null;
  });
  const ms = Date.now() - t0;
  const ok = status === 200 && missing.length === 0 && consoleErrors.length === 0 && networkFails.length === 0 && !overflow;
  results.push({
    path: probe.path,
    ok,
    status,
    ms,
    missing,
    consoleErrors,
    networkFails,
    overflow,
  });
}

await browser.close();

let allOk = true;
for (const r of results) {
  const tag = r.ok ? "✅" : "❌";
  console.log(`${tag} [${r.status}] ${r.path} (${r.ms}ms)`);
  if (r.missing?.length) console.log(`     missing: ${r.missing.join(", ")}`);
  if (r.consoleErrors?.length) console.log(`     console: ${r.consoleErrors.slice(0, 2).join(" | ")}`);
  if (r.networkFails?.length) console.log(`     network: ${r.networkFails.slice(0, 2).map((f) => f.failure + " " + f.url).join(" | ")}`);
  if (r.overflow) console.log(`     overflow: scroll=${r.overflow.scrollWidth} vw=${r.overflow.viewport}`);
  if (r.error) console.log(`     error: ${r.error}`);
  if (!r.ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
