import { describe, expect, it } from "vitest";
import { buildSiteChecklist, serializeSiteChecklistCsv } from "./siteChecklist";
import { archiveRetained } from "./retentionLifecycle";
import { createSeedStudy } from "../state/seed";

const NOW = new Date("2026-09-17T12:00:00.000Z");

describe("site checklist", () => {
  it("lists placed clips with recording-scoped findings", () => {
    const state = createSeedStudy();
    const checklist = buildSiteChecklist(state, "site-voices");
    expect(checklist?.entries[0].title).toBe("Courtyard conversation");
    expect(checklist?.entries[0].durationSeconds).toBe(241);
    expect(
      checklist?.entries[0].unresolvedFindings.every(
        (finding) => finding.scope === "recording" || finding.scope === "site",
      ),
    ).toBe(true);
  });

  it("serializes audio durations and clip rows to CSV", () => {
    const checklist = buildSiteChecklist(createSeedStudy(), "site-rhythm");
    const csv = checklist ? serializeSiteChecklistCsv(checklist) : "";
    expect(csv).toContain("Clip");
    expect(csv).toContain("Tram brake chorus");
    expect(csv).toContain("duration (sec)");
  });

  it("still resolves a placed clip after its import batch was archived", () => {
    const state: ReturnType<typeof createSeedStudy> = {
      ...createSeedStudy(),
      retentionPolicies: {
        ...createSeedStudy().retentionPolicies,
        importCompletedDays: 5,
      },
    };
    // site-threshold places rec-underpass from the completed summer batch.
    const archived = archiveRetained(state, "import", "batch-summer", NOW);
    const checklist = buildSiteChecklist(archived, "site-threshold");
    expect(checklist?.entries).toHaveLength(1);
    expect(checklist?.entries[0].archived).toBe(true);
    const csv = checklist ? serializeSiteChecklistCsv(checklist) : "";
    expect(csv).toContain("Underpass reverb at dawn");
    expect(csv).toContain("[archived]");
  });
});
