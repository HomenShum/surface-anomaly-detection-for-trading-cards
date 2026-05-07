import { expect, test } from "@playwright/test";

test.describe("verified outcome library", () => {
  test("landing, examples, detail, and benchmark trust surfaces are inspectable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Explore annotated outcomes before scanning your own card" })).toBeVisible();
    await expect(page.getByText("The library separates external PSA certified references from local annotated DING fixtures.")).toBeVisible();

    await page.getByRole("link", { name: "Open library ->" }).click();
    await expect(page).toHaveURL(/\/examples$/);
    await expect(page.getByRole("heading", { name: "Inspect the inspection before you trust the scanner." })).toBeVisible();
    await expect(page.getByText("Mew ex").first()).toBeVisible();
    await expect(page.getByText("Carmine - Special Art Rare")).toBeVisible();
    await expect(page.getByText("Edge whitening (Roboflow Card Condition v0)")).toBeVisible();

    await expect(page.getByText("PSA 101964593")).toBeVisible();
    await expect(page.getByText("not training data").first()).toBeVisible();

    await page.getByRole("link", { name: /Mew ex/ }).first().click();
    await expect(page).toHaveURL(/\/examples\/pokemon-mew-ex-paldean-fates-gem-10$/);
    await expect(page.getByRole("heading", { name: /Mew ex/ })).toBeVisible();
    await expect(page.getByText("Official grade attached")).toBeVisible();
    await expect(page.getByText("DING labels")).toBeVisible();
    await expect(page.getByText("not training data").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /101964593/ }).first()).toBeVisible();

    await page.goto("/examples");
    await page.getByRole("link", { name: /Holo glare false positive/ }).first().click();
    await expect(page).toHaveURL(/\/examples\/demo-holo-glare-false-positive$/);
    await expect(page.getByRole("heading", { name: /Holo glare false positive/ })).toBeVisible();
    await expect(page.getByText("glare uncertain").first()).toBeVisible();
    await expect(page.getByText("Our scan is not TAG photometric stereoscopic imaging")).toBeVisible();

    await page.goto("/benchmarks");
    await expect(page.getByRole("heading", { name: "What our model has actually been tested on." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Per-finish performance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Certified references/ })).toBeVisible();
    await expect(page.getByText("Authenticity / counterfeit detection")).toBeVisible();
  });
});
