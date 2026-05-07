import { expect, test } from "@playwright/test";
import path from "node:path";

test("agent workspace uploads an annotated card image and runs live analysis", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/workspace");
  await expect(page.getByText("Condition marketplace desk", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Model facts").getByText("ding-detector-v0", { exact: false })).toBeVisible();

  const sampleImage = path.join(
    process.cwd(),
    "apps",
    "web",
    "public",
    "demo",
    "sample-cards",
    "roboflow-tauros-real-card.jpg",
  );
  await page.locator('[data-testid="agent-upload-input"]').setInputFiles(sampleImage);
  await expect(page.getByAltText("roboflow-tauros-real-card.jpg")).toBeVisible();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Analyze upload"));
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const analyzeButton = page.getByRole("button", { name: "Analyze upload" });
  await expect(analyzeButton).toBeEnabled();

  await analyzeButton.click();
  await expect(page.getByText("Analysis complete", { exact: false })).toBeVisible();
  await expect(page.getByText("Run checklist", { exact: false })).toBeVisible();
  await expect(page.getByText("DING detection running", { exact: false })).toBeVisible();
  await expect(page.getByTestId("inspection-tool-target")).toBeVisible();
  await expect(page.getByTestId("inspection-crop-preview")).toBeVisible();
  await expect(page.getByTestId("tool-event-timeline").getByText("run ding detector").first()).toBeVisible();
  await expect(page.getByText("warning", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("not an official grade or legal guarantee")).toBeVisible();

  await page.screenshot({
    fullPage: true,
    path: `docs/screenshots/workspace-upload-analysis-${testInfo.project.name}.png`,
  });
  expect(consoleErrors).toEqual([]);
});
