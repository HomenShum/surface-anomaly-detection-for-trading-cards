#!/usr/bin/env node
// Quick Playwright probe: visit a route, log console + network failures
// against the live local prod server. No recording — just observability.
//
//   node scripts/qa/probe_runtime_errors.mjs /scan?mode=sample
//   node scripts/qa/probe_runtime_errors.mjs /examples/psa-148901890

import { chromium } from "@playwright/test";

const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100";
const path = process.argv[2] ?? "/";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleMsgs = [];
const networkFails = [];
const inferenceCalls = [];

page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleMsgs.push({ type: msg.type(), text: msg.text().slice(0, 320) });
  }
});
page.on("requestfailed", (req) => {
  networkFails.push({ url: req.url().slice(0, 200), failure: req.failure()?.errorText });
});
page.on("response", (resp) => {
  const url = resp.url();
  if (url.includes("/api/inference") || url.includes("8000") || url.includes("/inference")) {
    inferenceCalls.push({ status: resp.status(), url: url.slice(0, 160) });
  }
});

await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(8_000);

// Grep visible text for "offline" / "unavailable" / "unreachable"
const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 4000));
const flags = [];
for (const needle of ["offline", "unavailable", "unreachable", "deep-link only", "no predictions yet", "no eval", "blocked"]) {
  if (visibleText.toLowerCase().includes(needle)) flags.push(needle);
}

console.log(JSON.stringify({
  path,
  consoleMsgs: consoleMsgs.slice(0, 20),
  networkFails: networkFails.slice(0, 20),
  inferenceCalls: inferenceCalls.slice(0, 20),
  visibleTextFlags: flags,
}, null, 2));

await browser.close();
