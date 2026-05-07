#!/usr/bin/env node
// Run the /scan?mode=sample flow and capture what DINGs the report shows.

import { chromium } from "@playwright/test";

const baseUrl = process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${baseUrl}/scan?mode=sample`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".scan-analyze-canvas", { timeout: 30_000 });
await page.waitForTimeout(15_000);
// Inspect what got rendered
const dingBoxes = await page.locator(".ding-box").count();
const dingLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".ding-box span")).map(s => s.textContent ?? ""));
const reportText = await page.locator(".scan-report, .report-shell, .report-summary, .scan-summary").first().innerText().catch(() => "");
const visible = await page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log(JSON.stringify({
  dingBoxes,
  dingLabels: dingLabels.slice(0, 10),
  reportTextSnippet: reportText.slice(0, 600),
  visibleContains: {
    findings: visible.toLowerCase().includes("finding"),
    severity: visible.toLowerCase().includes("severity"),
    cornerWear: visible.toLowerCase().includes("corner_wear") || visible.toLowerCase().includes("corner wear"),
    edgeWear: visible.toLowerCase().includes("edge_wear") || visible.toLowerCase().includes("edge wear"),
    scratch: visible.toLowerCase().includes("scratch"),
    DING: visible.includes("DING") || visible.includes("DINGs"),
  },
}, null, 2));
await browser.close();
