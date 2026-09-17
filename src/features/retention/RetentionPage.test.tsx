import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyRecordingDraft } from "../../domain/recordingValidation";
import {
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
} from "../../state/persistence";
import { StudyProvider, useStudy } from "../../state/StudyContext";
import { RetentionPage } from "./RetentionPage";

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_BACKUP_KEY);
});

function renderPage() {
  return render(
    <StudyProvider>
      <RetentionPage />
    </StudyProvider>,
  );
}

function ledgerRow(text: string): HTMLElement {
  const ledger = screen.getByTestId("retention-ledger");
  return within(ledger)
    .getAllByRole("article")
    .find((article) => article.textContent?.includes(text))!;
}

/** Adds a valid live clip that does not belong to any import batch. */
function AddUnbatchedClip() {
  const { upsertRecording } = useStudy();
  useEffect(() => {
    upsertRecording({
      ...emptyRecordingDraft,
      catalogId: "SC-26-900",
      title: "Test-only rain bridge",
      source: "QA fixture",
      recordedOn: "2026-09-01",
      location: "Footbridge",
      summary: "A short clip created inside the retention page test harness.",
    });
  }, [upsertRecording]);
  return null;
}

describe("RetentionPage workflow", () => {
  it("archives expired material, preserves references, then restores and requalifies", async () => {
    window.confirm = () => true;
    renderPage();

    // Tighten the completed-import window to expire the seed batch.
    fireEvent.change(screen.getByLabelText(/Completed imports/), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

    const expiredRow = ledgerRow("Summer listening intake");
    expect(expiredRow).toBeTruthy();
    await waitFor(() =>
      expect(within(expiredRow).getByText("Expired")).toBeTruthy(),
    );

    fireEvent.click(within(expiredRow).getByRole("button", { name: "Archive" }));

    // Reference integrity surfaces the placed clip cleaned into the vault.
    await waitFor(() =>
      expect(
        screen.getByText("Live references resolving to cleaned clips"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Underpass reverb at dawn")).toBeTruthy();

    // The ledger no longer lists the batch; it is in the vault.
    expect(screen.getByTestId("retention-ledger").textContent).not.toContain(
      "Summer listening intake",
    );

    // Restore it from the vault.
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[0]);

    // The restored ledger row requires requalification.
    await waitFor(() =>
      expect(ledgerRow("Summer listening intake")).toBeTruthy(),
    );
    const restoredRow = ledgerRow("Summer listening intake");
    expect(
      within(restoredRow).getByText("Restored · requalify"),
    ).toBeTruthy();

    // Requalify; the hold badge disappears and publication eligibility is
    // re-stamped (verified by the row dropping its requalification flag).
    fireEvent.click(
      within(restoredRow).getByRole("button", { name: "Requalify" }),
    );
    await waitFor(() =>
      expect(
        within(
          ledgerRow("Summer listening intake"),
        ).queryByText("Restored · requalify"),
      ).toBeNull(),
    );
  });

  it("opens a new import batch from clips without one", async () => {
    render(
      <StudyProvider>
        <AddUnbatchedClip />
        <RetentionPage />
      </StudyProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New import batch" }));
    fireEvent.change(screen.getByLabelText(/Batch label/), {
      target: { value: "Autumn community drop-off" },
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".import-pick-row").length).toBe(1),
    );
    fireEvent.click(
      document.querySelectorAll(".import-pick-row")[0].querySelector("input")!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open batch" }));

    // The new batch appears in the import intake panel.
    const intake = screen.getByTestId("import-intake");
    await waitFor(() =>
      expect(within(intake).getByText("Autumn community drop-off")).toBeTruthy(),
    );
  });
});
