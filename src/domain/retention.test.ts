import { describe, expect, it } from "vitest";
import { createSeedStudy } from "../state/seed";
import { analyzeRoute } from "./routeAnalysis";
import { evaluateRelease, createReleaseRecord } from "./releaseRules";
import {
  archiveRecord,
  classifyImport,
  classifyRelease,
  classifyRetention,
  classifySite,
  pendingRequalification,
  resolveRecording,
  restoreArchived,
  scanReferences,
  sweepExpired,
} from "./retention";
import { workspaceReducer } from "../state/reducer";
import type { ReleaseResult, StudyState } from "./models";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function seedAt(): StudyState {
  return createSeedStudy();
}

describe("retention classification", () => {
  it("classifies a historical publication past its window as expired", () => {
    const state = seedAt();
    const historical = state.releaseHistory[0];
    expect(historical).toBeDefined();
    expect(classifyRelease(historical, NOW).status).toBe("expired");
  });

  it("classifies an unfinished import after 90 days as expired and a completed one as active", () => {
    const state = seedAt();
    const stale = state.importBatches.find(
      (batch) => batch.id === "batch-spring-leftovers",
    )!;
    const summer = state.importBatches.find(
      (batch) => batch.id === "batch-summer-2026",
    )!;
    expect(classifyImport(stale, state.recordings, NOW).status).toBe("expired");
    expect(classifyImport(summer, state.recordings, NOW).status).toBe("active");
  });

  it("protects a site with clips and expires a disused empty site", () => {
    const state = seedAt();
    const active = state.sites.find((site) => site.id === "site-voices")!;
    const disused = state.sites.find((site) => site.id === "site-civic-hall")!;
    expect(classifySite(active, NOW).status).toBe("active");
    expect(classifySite(disused, NOW).status).toBe("expired");
  });

  it("groups every active record into a status", () => {
    const items = classifyRetention(seedAt(), NOW);
    const statuses = new Set(items.map((item) => item.status));
    expect(statuses).toContain("expired");
    expect(statuses).toContain("active");
    const expired = items.filter((item) => item.status === "expired");
    expect(expired.map((item) => item.kind).sort()).toEqual([
      "import",
      "release",
      "site",
    ]);
  });
});

describe("retention sweep", () => {
  it("archives all three expired categories while retaining references", () => {
    const state = seedAt();
    const { state: swept, archived } = sweepExpired(state, NOW);
    expect(archived.length).toBe(3);
    // The stale import's clip leaves the active library.
    expect(swept.recordings.map((r) => r.id)).not.toContain("rec-lecture");
    expect(swept.sites.map((s) => s.id)).not.toContain("site-civic-hall");
    expect(swept.releaseHistory.map((r) => r.id)).not.toContain(
      "release-2025-summer",
    );
    // But the archived clip is still resolvable by id.
    const resolved = resolveRecording(swept, "rec-lecture");
    expect(resolved?.archived).toBe(true);
    expect(resolved?.recording.title).toBe("Lecture hall room tone");
  });

  it("refuses to archive an active record individually", () => {
    const state = seedAt();
    const result = archiveRecord(state, "import", "batch-summer-2026", NOW);
    expect(result.archived).toHaveLength(0);
  });

  it("allows archiving a single expired record", () => {
    const state = seedAt();
    const result = archiveRecord(state, "site", "site-civic-hall", NOW);
    expect(result.archived).toHaveLength(1);
    expect(result.state.sites.map((s) => s.id)).not.toContain(
      "site-civic-hall",
    );
  });

  it("is a no-op when nothing is expired", () => {
    const state = seedAt();
    const fresh = new Date("2026-01-01T00:00:00.000Z");
    const { archived } = sweepExpired(state, fresh);
    expect(archived).toHaveLength(0);
  });
});

describe("reference resolution after cleanup", () => {
  it("keeps a route reference and a finding linked to an archived clip resolvable", () => {
    const state = seedAt();
    const issues = scanReferences(state);
    const rooftopRoute = issues.find(
      (issue) => issue.targetId === "rec-rooftop" && issue.ownerId === "site-return",
    );
    const rooftopFinding = issues.find(
      (issue) => issue.targetId === "rec-rooftop" && issue.ownerId === "issue-rooftop-note",
    );
    expect(rooftopRoute?.state).toBe("archived");
    expect(rooftopFinding?.state).toBe("archived");
    expect(issues.some((issue) => issue.state === "missing")).toBe(false);
    // Direct resolution yields the archived tombstone.
    const resolved = resolveRecording(state, "rec-rooftop");
    expect(resolved?.archived).toBe(true);
  });

  it("blocks release while a route reference points at archived material", () => {
    const state = seedAt();
    const analysis = analyzeRoute(state.recordings, state.sites);
    const result = evaluateRelease(state, analysis, NOW);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/archived material/);
  });
});

describe("archived restore and re-qualification", () => {
  it("restores an archived import with its clips and flags requalification", () => {
    const state = seedAt();
    const { state: restored, restored: items } = restoreArchived(
      state,
      "archive-winter-pilot",
      NOW,
    );
    expect(items).toHaveLength(1);
    const clip = restored.recordings.find((r) => r.id === "rec-rooftop");
    expect(clip).toBeDefined();
    expect(clip?.restoredAt).toBe(NOW.toISOString());
    const batch = restored.importBatches.find(
      (b) => b.id === "batch-winter-pilot",
    );
    expect(batch?.status).toBe("open");
    expect(batch?.restoredAt).toBeDefined();
    expect(pendingRequalification(restored).recordings.map((r) => r.id)).toContain(
      "rec-rooftop",
    );
  });

  it("a restored publication does not republish automatically", () => {
    const state = seedAt();
    const { state: swept } = sweepExpired(state, NOW);
    const entry = swept.archive.find(
      (candidate) => candidate.kind === "release",
    )!;
    const { state: restored } = restoreArchived(swept, entry.id, NOW);
    const returned = restored.releaseHistory.find(
      (release) => release.id === "release-2025-summer",
    );
    expect(returned?.status).toBe("stale");
    // The head release is unaffected: nothing is re-published.
    expect(restored.release).toBeNull();
  });

  it("release gate surfaces restored items and a passing check re-qualifies covered ones", () => {
    const state = seedAt();
    const { state: restored } = restoreArchived(
      state,
      "archive-winter-pilot",
      NOW,
    );
    const withCleanRoute: StudyState = {
      ...restored,
      issues: [],
    };
    const cleanAnalysis = analyzeRoute(
      withCleanRoute.recordings,
      withCleanRoute.sites,
    );
    const evaluated = evaluateRelease(withCleanRoute, cleanAnalysis, NOW);
    // Restored material is flagged as a caution, not an un-clearable blocker.
    expect(evaluated.blockers.join(" ")).not.toMatch(
      /re-earn publication eligibility/,
    );
    expect(evaluated.cautions.join(" ")).toMatch(/re-qualification/);

    // Simulate the passing readiness command: the restored clip placed on the
    // route is covered by the release and loses its restored marker.
    const passing: ReleaseResult = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: NOW.toISOString(),
    };
    const release = createReleaseRecord(
      withCleanRoute,
      cleanAnalysis,
      passing,
    );
    const checked = workspaceReducer(withCleanRoute, {
      type: "project/readiness",
      release,
    });
    const rooftop = checked.recordings.find((r) => r.id === "rec-rooftop");
    expect(rooftop?.restoredAt).toBeUndefined();
    const batch = checked.importBatches.find(
      (b) => b.id === "batch-winter-pilot",
    );
    expect(batch?.restoredAt).toBeUndefined();
  });
});

describe("retention reducer commands", () => {
  it("archives expired material through the sweep command and bumps revision", () => {
    const state = seedAt();
    const next = workspaceReducer(state, { type: "retention/sweep" });
    expect(next.revision).toBe(state.revision + 1);
    expect(next.archive.length).toBeGreaterThan(state.archive.length);
    expect(next.auditLog.at(-1)?.action).toBe("retention/sweep");
  });

  it("restoring an archived import regresses a ready project", () => {
    const state = seedAt();
    const restored = workspaceReducer(state, {
      type: "retention/restore",
      archiveId: "archive-winter-pilot",
    });
    expect(restored.revision).toBe(1);
    expect(restored.project.stage).not.toBe("ready");
    expect(restored.auditLog.at(-1)?.action).toBe("retention/restore");
  });

  it("a sweep that archives only historical releases keeps the current release current", () => {
    const state = seedAt();
    // Remove import/site expirations so only the historical release is swept.
    const recent = "2026-09-10T00:00:00.000Z";
    const narrowed: StudyState = {
      ...state,
      importBatches: state.importBatches
        .filter((batch) => batch.id !== "batch-spring-leftovers")
        .map((batch) =>
          batch.id === "batch-summer-2026"
            ? { ...batch, completedAt: recent, updatedAt: recent }
            : batch,
        ),
      recordings: state.recordings.filter(
        (recording) => recording.importBatchId !== "batch-spring-leftovers",
      ),
      sites: state.sites
        .filter((site) => site.id !== "site-civic-hall")
        .map((site) =>
          site.id === "site-return"
            ? { ...site, recordingIds: ["rec-bus"], updatedAt: recent }
            : site,
        ),
      archive: [],
      issues: state.issues.filter((issue) => issue.id !== "issue-rooftop-note"),
    };
    const next = workspaceReducer(narrowed, { type: "retention/sweep" });
    expect(next.releaseHistory).toHaveLength(0);
    expect(next.archive.some((entry) => entry.kind === "release")).toBe(true);
  });
});
