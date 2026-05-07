import { expect, test } from "@playwright/test";

test.describe("verified methods community board", () => {
  test("landing and method pages show verified contribution proof", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Open-source inspection methods" })).toBeVisible();
    await expect(page.getByText("We reward benchmarked methods, not random suggestions.")).toBeVisible();
    await expect(page.getByText("Verified method accepted")).toBeVisible();

    await page.getByRole("link", { name: "Open board ->" }).click();
    await expect(page).toHaveURL(/\/methods$/);
    await expect(page.getByRole("heading", { name: "Verified methods that make the agent inspect cards better." })).toBeVisible();
    await expect(page.getByText("Holo Glare Reinspection v1").first()).toBeVisible();
    await expect(page.getByText("-18%").first()).toBeVisible();

    await page.getByRole("link", { name: "Holo Glare Reinspection v1" }).first().click();
    await expect(page).toHaveURL(/\/methods\/holo-glare-reinspection-v1$/);
    await expect(page.getByRole("heading", { name: "Benchmark proof" })).toBeVisible();
    await expect(page.getByText("ccv-alpha-fixtures-20260506", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "View contributor" }).click();
    await expect(page).toHaveURL(/\/contributors\/collector-methods$/);
    await expect(page.getByRole("heading", { name: "@collector-methods" })).toBeVisible();
    await expect(page.getByText("Verified Method Author")).toBeVisible();

    await page.goto("/methods/submit");
    await expect(page.getByRole("heading", { name: "Turn a useful inspection idea into benchmarkable community research." })).toBeVisible();
    await expect(page.getByText("method_submitted")).toBeVisible();
    await page.getByPlaceholder("@collector-methods").fill("@dogfood-reviewer");
    await page.getByPlaceholder("Example: Holo glare is being misread as scratches under direct light.").fill("Holo glare creates false scratch calls.");
    await page
      .getByPlaceholder("crop_region -> zoom_region -> run_glare_check -> run_ding_detector -> explain_uncertainty")
      .fill("crop_region -> run_glare_check -> run_ding_detector -> explain_uncertainty");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: "Submit draft candidate" }).click();
    await expect(page.getByText("Draft candidate saved")).toBeVisible();
    await expect(page.getByText("server-side draft proposal store")).toBeVisible();
  });

  test("report chat logs user-contributed inspection methods as draft candidates", async ({ request }) => {
    const response = await request.post("/api/agent/inspect", {
      data: {
        message:
          "I found a method that worked: if a holo scratch looks suspicious, crop the region, check glare, zoom it, then rerun detection before sharing it with future users.",
        userId: "methods-dogfood",
        reportContext: {
          cardId: "sample-card",
          reportSummary: "Possible surface scratch with glare risk.",
          conditionScore: 78,
          surfaceScore: 55,
          centeringScore: 92,
          edgeScore: 81,
          glareScore: 0.48,
          finishType: "holo",
          findings: [
            {
              type: "scratch",
              confidence: 0.52,
              severity: "minor",
              bbox: [72, 12, 88, 25],
              zone: "front_top_right",
              sha256: "sample-finding-hash",
            },
          ],
          evidence: [
            {
              role: "front_normalized",
              sha256: "sample-normalized-hash",
              path: "storage/samples/front_normalized.jpg",
            },
          ],
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.content).toContain("Draft method candidate logged");
    expect(body.proposedSkillIds?.[0]).toMatch(/^draft_/);
    expect(body.toolTraces.some((trace: { tool: string }) => trace.tool === "propose_inspection_method")).toBe(true);
  });
});
