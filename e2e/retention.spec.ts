import { expect, test } from "@playwright/test";

test("archives expired material, keeps references resolvable, and restores for re-qualification", async ({
  page,
}) => {
  await page.goto("/retention");

  // Policy windows and the three business categories are visible.
  await expect(page.getByRole("heading", { name: "Retention desk" })).toBeVisible();
  await expect(page.getByText("Superseded publication")).toBeVisible();
  await expect(page.getByText("Unfinished import")).toBeVisible();
  await expect(page.getByText("Disused listening site")).toBeVisible();

  // Seed study carries expired material in every category.
  await expect(page.getByRole("button", { name: /Archive \d+ expired/ })).toBeVisible();

  // An archived import is already in the vault and its clip is still
  // referenced by the route — reported as resolving to the archive.
  await expect(page.getByText("Resolves to archive").first()).toBeVisible();

  // Sweep every expired record.
  await page.getByRole("button", { name: /Archive \d+ expired/ }).click();
  await expect(page.getByText(/Archived \d+ expired record/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Archive 0 expired/ })).toBeVisible();

  // The archive vault grew; the winter pilot import can be restored.
  const restoreButtons = page.getByRole("button", { name: "Restore" });
  await expect(restoreButtons.first()).toBeVisible();

  // The route still resolves the archived rooftop clip (link never broke).
  await page.goto("/route");
  await expect(page.getByText("Rooftop snowfall hush").first()).toBeVisible();
  await expect(page.getByText(/archived/).first()).toBeVisible();

  // Restore the winter pilot import from the retention desk.
  await page.goto("/retention");
  const winterRow = page
    .locator(".archive-row")
    .filter({ hasText: "Winter pilot import" });
  await winterRow.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText(/must pass a new readiness check before release/),
  ).toBeVisible();

  // The restored material is flagged for re-qualification.
  await expect(page.getByText(/AWAITING RE-QUALIFICATION/)).toBeVisible();

  // Quality desk: restored material must still pass a readiness check before
  // publication; the study has its usual blockers until then.
  await page.goto("/quality");
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(
    page.getByText(/Still needs attention|blocking condition/i),
  ).toBeVisible();
});
