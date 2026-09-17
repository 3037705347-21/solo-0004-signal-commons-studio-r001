import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { evaluateRelease } from "./releaseRules";
import type { ImportBatch, StudyState } from "./models";
import {
  archiveRetained,
  completeImportBatch,
  restoreRetained,
  requalifyRetained,
} from "./retentionLifecycle";
import {
  DEFAULT_RETENTION_POLICY,
  deriveRetention,
  findRetentionEntry,
  importRetentionKey,
  isRecordingArchived,
  resolveRecording,
  resolveRelease,
  resolveSite,
  retentionOverview,
  unqualifiedRecordingIds,
  unqualifiedSiteIds,
} from "./retention";
import { createSeedStudy } from "../state/seed";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function batchFor(state: StudyState, id: string): ImportBatch {
  const batch = state.importBatches.find((item) => item.id === id);
  if (!batch) throw new Error(`missing batch ${id}`);
  return batch;
}

describe("retention derivation", () => {
  it("classifies live material as active, expired, or archived by class policy", () => {
    const state = createSeedStudy();
    const entries = deriveRetention(state, NOW);

    // Completed summer intake stamped 2026-09-08 + 180 days => active.
    const summer = entries[importRetentionKey("batch-summer")];
    expect(summer.status).toBe("active");
    expect(summer.policyDays).toBe(
      DEFAULT_RETENTION_POLICY.importCompletedDays,
    );

    // Open July intake uses the shorter open-import window.
    const workshop = entries[importRetentionKey("batch-workshop")];
    expect(workshop.policyDays).toBe(DEFAULT_RETENTION_POLICY.importOpenDays);

    const siteEntries = Object.values(entries).filter(
      (entry) => entry.category === "site",
    );
    expect(siteEntries).toHaveLength(state.sites.length);
    expect(siteEntries.every((entry) => entry.status === "active")).toBe(true);
  });

  it("marks a long-finished completed import expired under a short policy", () => {
    const state: StudyState = {
      ...createSeedStudy(),
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, importCompletedDays: 5 },
    };
    const entry = findRetentionEntry(state, "import", "batch-summer", NOW);
    expect(entry?.status).toBe("expired");
  });

  it("recomputes standing immediately when the policy changes", () => {
    const state = createSeedStudy();
    expect(
      findRetentionEntry(state, "site", "site-threshold", NOW)?.status,
    ).toBe("active");
    const tightened: StudyState = {
      ...state,
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, siteDays: 1 },
    };
    expect(
      findRetentionEntry(tightened, "site", "site-threshold", NOW)?.status,
    ).toBe("expired");
  });
});

describe("import batch archive lifecycle", () => {
  it("refuses to archive material still inside its retention window", () => {
    const state = createSeedStudy();
    expect(() =>
      archiveRetained(state, "import", "batch-summer", NOW),
    ).toThrow(/expired/);
  });

  it("moves an expired batch and its clips to the vault but keeps references resolving", () => {
    const tightened: StudyState = {
      ...createSeedStudy(),
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, importCompletedDays: 5 },
    };
    const archived = archiveRetained(
      tightened,
      "import",
      "batch-summer",
      NOW,
    );

    expect(archived.importBatches.map((batch) => batch.id)).not.toContain(
      "batch-summer",
    );
    expect(archived.recordings.map((recording) => recording.id)).not.toContain(
      "rec-underpass",
    );

    // The threshold site still references rec-underpass.
    const threshold = archived.sites.find(
      (site) => site.id === "site-threshold",
    );
    expect(threshold?.recordingIds).toContain("rec-underpass");

    // The reference resolves through the tombstone and is flagged archived.
    const resolved = resolveRecording(archived, "rec-underpass");
    expect(resolved?.title).toBe("Underpass reverb at dawn");
    expect(isRecordingArchived(archived, "rec-underpass")).toBe(true);

    // The entry is now archived.
    const entry = findRetentionEntry(archived, "import", "batch-summer", NOW);
    expect(entry?.status).toBe("archived");

    // Findings linked to cleaned clips remain in place.
    expect(
      archived.issues.some((issue) => issue.recordingId === "rec-courtyard"),
    ).toBe(true);
  });

  it("restores a batch and its clips, but requires requalification before release", () => {
    const tightened: StudyState = {
      ...createSeedStudy(),
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, importCompletedDays: 5 },
    };
    const archived = archiveRetained(tightened, "import", "batch-summer", NOW);
    const restored = restoreRetained(archived, "import", "batch-summer", NOW);

    expect(restored.recordings.map((recording) => recording.id)).toContain(
      "rec-underpass",
    );
    const restoredRecording = restored.recordings.find(
      (recording) => recording.id === "rec-underpass",
    );
    expect(restoredRecording?.restoredAt).toBeTruthy();
    expect(unqualifiedRecordingIds(restored)).toContain("rec-underpass");

    const entry = findRetentionEntry(restored, "import", "batch-summer", NOW);
    expect(entry?.requalificationRequired).toBe(true);
    expect(entry?.status).toBe("active");

    const analysis = analyzeRoute(restored.recordings, restored.sites);
    const result = evaluateRelease(restored, analysis, NOW);
    expect(result.blockers.join(" ")).toMatch(/requalified before release/);

    const requalified = requalifyRetained(
      restored,
      "import",
      "batch-summer",
      NOW,
    );
    expect(unqualifiedRecordingIds(requalified)).not.toContain(
      "rec-underpass",
    );
    expect(
      findRetentionEntry(requalified, "import", "batch-summer", NOW)
        ?.requalificationRequired,
    ).toBe(false);
  });
});

describe("site archive lifecycle", () => {
  it("archives an expired site, restores it unqualified, and requalifies it", () => {
    const tightened: StudyState = {
      ...createSeedStudy(),
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, siteDays: 5 },
    };
    const archived = archiveRetained(tightened, "site", "site-voices", NOW);
    expect(resolveSite(archived, "site-voices")?.archived).toBe(true);
    expect(archived.sites.map((site) => site.id)).not.toContain("site-voices");

    // The finding scoped to the site still resolves the archived site.
    const restored = restoreRetained(archived, "site", "site-voices", NOW);
    expect(unqualifiedSiteIds(restored)).toContain("site-voices");
    expect(resolveSite(restored, "site-voices")?.archived).toBe(false);

    const requalified = requalifyRetained(restored, "site", "site-voices", NOW);
    expect(unqualifiedSiteIds(requalified)).not.toContain("site-voices");
  });
});

describe("release archive lifecycle", () => {
  it("archives an expired published release, keeps it resolvable, and restores it as unqualified lineage", () => {
    const state = createSeedStudy();
    const tightened: StudyState = {
      ...state,
      retentionPolicies: { ...DEFAULT_RETENTION_POLICY, releaseDays: 1 },
    };
    // Fabricate an old "ready" release stamped before the current window.
    const release = {
      id: "release-old",
      sequence: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "ready" as const,
      revision: 0,
      fingerprint: "old",
      readiness: {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const withRelease: StudyState = { ...tightened, release };
    const archived = archiveRetained(
      withRelease,
      "release",
      "release-old",
      NOW,
    );
    expect(archived.release).toBeNull();
    expect(resolveRelease(archived, "release-old")?.archived).toBe(true);

    const restored = restoreRetained(archived, "release", "release-old", NOW);
    // Restored release is lineage, never the current publication.
    expect(restored.release).toBeNull();
    expect(
      restored.releaseLineage.map((item) => item.id),
    ).toContain("release-old");
    expect(
      findRetentionEntry(restored, "release", "release-old", NOW)
        ?.requalificationRequired,
    ).toBe(true);
  });
});

describe("batch completion", () => {
  it("switches an open batch to the completed retention window", () => {
    const state = createSeedStudy();
    expect(
      findRetentionEntry(state, "import", "batch-workshop", NOW)?.policyDays,
    ).toBe(DEFAULT_RETENTION_POLICY.importOpenDays);
    const completed = completeImportBatch(state, "batch-workshop", NOW);
    expect(batchFor(completed, "batch-workshop").status).toBe("completed");
    expect(
      findRetentionEntry(completed, "import", "batch-workshop", NOW)
        ?.policyDays,
    ).toBe(DEFAULT_RETENTION_POLICY.importCompletedDays);
  });
});

describe("overview", () => {
  it("counts active, expired, and archived material", () => {
    const tightened: StudyState = {
      ...createSeedStudy(),
      retentionPolicies: {
        ...DEFAULT_RETENTION_POLICY,
        importCompletedDays: 5,
        siteDays: 5,
      },
    };
    const overview = retentionOverview(tightened, NOW);
    expect(overview.expiredCount).toBeGreaterThan(0);
    expect(overview.activeCount).toBeGreaterThan(0);

    const archived = archiveRetained(tightened, "import", "batch-summer", NOW);
    const after = retentionOverview(archived, NOW);
    expect(after.archivedCount).toBeGreaterThanOrEqual(2); // batch + clips
    expect(after.archived.importBatches).toHaveLength(1);
    expect(after.archived.recordings.length).toBe(
      batchFor(tightened, "batch-summer").recordingIds.length,
    );
  });
});
