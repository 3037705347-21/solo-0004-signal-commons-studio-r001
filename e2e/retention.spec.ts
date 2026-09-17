import { test, expect } from "@playwright/test";

test("archives expired material, preserves references, and restores with requalification", async ({
  page,
}) => {
  await page.goto("/retention");

  // The ledger lists the seed import batches and sites.
  await expect(page.getByText("Summer listening intake")).toBeVisible();
  await expect(page.getByText("July supplement")).toBeVisible();

  // Tighten the completed-import window so the September-completed seed
  // batch expires immediately.
  await page.getByLabel("Completed imports (days)").fill("5");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Retention policy updated.")).toBeVisible();

  // The completed batch is now reported expired.
  const summerRow = page
    .locator(".retention-row")
    .filter({ hasText: "Summer listening intake" });
  await expect(summerRow.getByText("Expired")).toBeVisible();

  // Archive it. Its clips (incl. the featured rec-underpass at the Threshold
  // site) move to the vault.
  page.on("dialog", (dialog) => dialog.accept());
  await summerRow.getByRole("button", { name: "Archive" }).click();

  // The reference integrity panel reports the live route reference.
  await expect(
    page.getByText("Live references resolving to cleaned clips"),
  ).toBeVisible();
  await expect(page.getByText("Underpass reverb at dawn")).toBeVisible();

  // The vault now holds the batch and its five clips.
  await expect(page.getByText("Summer listening intake").first()).toBeVisible();

  // Restore the batch: it returns unqualified.
  const vaultBatch = page
    .locator(".vault-group")
    .filter({ hasText: "Import batches" });
  await vaultBatch.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText("Restored. Requalification is required before release."),
  ).toBeVisible();

  // The ledger flags it for requalification; clear the hold.
  const restoredRow = page
    .locator(".retention-row")
    .filter({ hasText: "Summer listening intake" });
  await expect(restoredRow.getByText("Restored · requalify")).toBeVisible();
  await restoredRow.getByRole("button", { name: "Requalify" }).click();
  await expect(
    page.getByText("Requalified for publication"),
  ).toBeVisible();
  await expect(
    restoredRow.getByText("Restored · requalify"),
  ).toHaveCount(0);
});

test("opens a new import batch from unassigned clips", async ({ page }) => {
  await page.goto("/retention");
  await page.getByRole("button", { name: "New import batch" }).click();
  await page.getByLabel("Batch label").fill("Autumn community drop-off");
  await page.getByLabel("Source").fill("Community hall laptop");
  await page
    .getByLabel("Note")
    .fill("Waiting on consent forms for the evening recordings.");
  await page.locator(".import-pick-row").first().locator("input").check();
  await page.getByRole("button", { name: "Open batch" }).click();
  await expect(page.getByText("Autumn community drop-off")).toBeVisible();
  await expect(page.getByText("Import batch opened.")).toBeVisible();
});
