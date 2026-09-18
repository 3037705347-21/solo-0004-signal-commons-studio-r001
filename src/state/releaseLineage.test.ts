import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import type { ReleaseResult, StudyState } from "../domain/models";
import { createReleaseRecord } from "../domain/releaseRules";
import { clearRequalification, sweepExpired } from "../domain/retention";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";

function passingState(): StudyState {
  // Build a releasable state: every featured clip placed, all roles, no
  // critical findings, no archived references.
  const seed = createSeedStudy();
  const issues = seed.issues
    .filter((issue) => issue.severity !== "critical")
    .filter((issue) => issue.id !== "issue-rooftop-note")
    .map((issue) => ({ ...issue, status: "resolved" as const }));
  return {
    ...seed,
    issues,
    sites: seed.sites
      .filter((site) => site.id !== "site-civic-hall")
      .map((site) =>
        site.id === "site-return"
          ? { ...site, recordingIds: ["rec-bus", "rec-drain"] }
          : site,
      ),
    archive: [],
  };
}

describe("release lineage with retention", () => {
  it("moves a frozen publication into retained lineage when the next one passes", () => {
    const state = passingState();
    const analysis = analyzeRoute(state.recordings, state.sites);
    const readiness: ReleaseResult = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2026-09-17T10:00:00.000Z",
    };
    const first = createReleaseRecord(state, analysis, readiness);
    const withFirst: StudyState = { ...state, release: first, releaseHistory: [] };
    const second = createReleaseRecord(
      { ...withFirst },
      analysis,
      { ...readiness, checkedAt: "2026-09-18T10:00:00.000Z" },
    );
    const withSecond = workspaceReducer(withFirst, {
      type: "project/readiness",
      release: second,
    });
    expect(withSecond.release?.id).toBe(second.id);
    expect(withSecond.releaseHistory.map((release) => release.id)).toContain(
      first.id,
    );
    expect(second.supersedes).toBe(first.id);
  });

  it("end to end: publish, expire, archive, restore, and re-qualify", () => {
    const state = passingState();
    const analysis = analyzeRoute(state.recordings, state.sites);
    const release = createReleaseRecord(state, analysis, {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2025-01-01T00:00:00.000Z",
    });
    const published: StudyState = {
      ...state,
      release,
      releaseHistory: [],
      project: { ...state.project, stage: "ready" },
    };

    // A new readiness check supersedes the 2025 release into lineage.
    const next = createReleaseRecord(published, analysis, {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2026-09-17T00:00:00.000Z",
    });
    const superseded = workspaceReducer(published, {
      type: "project/readiness",
      release: next,
    });
    expect(superseded.releaseHistory).toHaveLength(1);

    // The old publication is expired (created 2025) and gets archived.
    const { state: swept, archived } = sweepExpired(superseded);
    expect(archived.some((entry) => entry.kind === "release")).toBe(true);
    const committed = workspaceReducer(superseded, {
      type: "retention/sweep",
    });
    expect(committed.archive.length).toBeGreaterThan(0);
    expect(swept).toBeDefined();

    // Restore the publication: it returns stale, not published.
    const releaseArchive = committed.archive.find(
      (entry) => entry.kind === "release" && entry.release?.id === release.id,
    )!;
    const restored = workspaceReducer(committed, {
      type: "retention/restore",
      archiveId: releaseArchive.id,
    });
    const returned = restored.releaseHistory.find((r) => r.id === release.id);
    expect(returned?.status).toBe("stale");

    // A fresh passing check re-qualifies and can publish again.
    const rechecked = createReleaseRecord(
      clearRequalification(restored),
      analyzeRoute(restored.recordings, restored.sites),
      {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-09-18T00:00:00.000Z",
      },
    );
    expect(rechecked.status).toBe("ready");
  });
});
