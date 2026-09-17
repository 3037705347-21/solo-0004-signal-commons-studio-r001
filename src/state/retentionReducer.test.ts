import { describe, expect, it } from "vitest";
import { archiveRetained } from "../domain/retentionLifecycle";
import { findRetentionEntry } from "../domain/retention";
import type { RetentionPolicy, StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function expiredSeed(): StudyState {
  return {
    ...createSeedStudy(),
    retentionPolicies: {
      ...createSeedStudy().retentionPolicies,
      importCompletedDays: 5,
    },
  };
}

describe("retention reducer commands", () => {
  it("archives an expired import batch as a committed command", () => {
    const state = expiredSeed();
    const next = workspaceReducer(state, {
      type: "retention/archive",
      category: "import",
      id: "batch-summer",
    });
    expect(next.revision).toBe(state.revision + 1);
    expect(next.importBatches.map((batch) => batch.id)).not.toContain(
      "batch-summer",
    );
    expect(next.auditLog.at(-1)).toMatchObject({
      action: "retention/archive",
      revision: next.revision,
    });
  });

  it("restores and requalifies through committed commands", () => {
    const state = expiredSeed();
    const archived = archiveRetained(state, "import", "batch-summer", NOW);
    const restored = workspaceReducer(archived, {
      type: "retention/restore",
      category: "import",
      id: "batch-summer",
    });
    expect(restored.importBatches.map((batch) => batch.id)).toContain(
      "batch-summer",
    );
    expect(
      findRetentionEntry(restored, "import", "batch-summer", NOW)
        ?.requalificationRequired,
    ).toBe(true);

    const requalified = workspaceReducer(restored, {
      type: "retention/requalify",
      category: "import",
      id: "batch-summer",
    });
    expect(
      findRetentionEntry(requalified, "import", "batch-summer", NOW)
        ?.requalificationRequired,
    ).toBe(false);
  });

  it("stores policy updates without invalidating a frozen release", () => {
    const state = createSeedStudy();
    const frozen = {
      ...state,
      release: {
        id: "release-frozen",
        sequence: 1,
        createdAt: "2026-09-10T10:00:00.000Z",
        status: "ready" as const,
        revision: state.revision,
        fingerprint: "frozen",
        readiness: {
          ready: true,
          score: 100,
          blockers: [],
          cautions: [],
          checkedAt: "2026-09-10T10:00:00.000Z",
        },
      },
    };
    const policy: RetentionPolicy = {
      ...frozen.retentionPolicies,
      siteDays: 999,
    };
    const next = workspaceReducer(frozen, {
      type: "retention/policy",
      policy,
    });
    expect(next.release?.status).toBe("ready");
    expect(next.retentionPolicies.siteDays).toBe(999);
  });

  it("moves the current release into lineage when a new check lands", () => {
    const state = createSeedStudy();
    const first = {
      id: "release-first",
      sequence: 1,
      createdAt: "2026-09-10T10:00:00.000Z",
      status: "ready" as const,
      revision: 0,
      fingerprint: "first",
      readiness: {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-09-10T10:00:00.000Z",
      },
    };
    const withFirst: StudyState = { ...state, release: first };
    const second = {
      ...first,
      id: "release-second",
      sequence: 2,
      supersedes: "release-first",
    };
    const next = workspaceReducer(withFirst, {
      type: "project/readiness",
      release: second,
    });
    expect(next.release?.id).toBe("release-second");
    expect(next.releaseLineage.map((release) => release.id)).toContain(
      "release-first",
    );
  });

  it("keeps a restored material idempotent against duplicate command ids", () => {
    const state = expiredSeed();
    const archived = archiveRetained(state, "import", "batch-summer", NOW);
    const command = {
      type: "retention/restore" as const,
      category: "import" as const,
      id: "batch-summer",
      meta: {
        commandId: "restore-once",
        expectedRevision: archived.revision,
        originId: "tab-a",
        issuedAt: NOW.toISOString(),
      },
    };
    const once = workspaceReducer(archived, command);
    // A resent command keeps its original command id and revision guard; the
    // reducer recognizes it and returns state unchanged.
    const twice = workspaceReducer(once, command);
    expect(twice).toBe(once);
    expect(
      twice.importBatches.filter((batch) => batch.id === "batch-summer"),
    ).toHaveLength(1);
  });
});
