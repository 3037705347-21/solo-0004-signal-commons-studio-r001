import { describe, expect, it } from "vitest";
import {
  clearWorkspace,
  loadStudy,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import { archiveRetained } from "../domain/retentionLifecycle";
import { createSeedStudy } from "./seed";

describe("workspace persistence", () => {
  it("falls back to seed state for malformed storage", () => {
    const storage = { getItem: () => "{bad json" } as unknown as Storage;
    expect(loadStudy(storage).version).toBe(3);
  });
  it("round trips a workspace through storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage;
    const state = createSeedStudy();
    expect(saveStudy(state, storage)).toBe(true);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadStudy(storage).project.title).toBe(state.project.title);
    clearWorkspace(storage);
    expect(values.has(STORAGE_KEY)).toBe(false);
  });

  it("migrates a version 1 workspace into the version 3 state contract", () => {
    const legacy = createSeedStudy();
    const raw = JSON.stringify({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      auditLog: undefined,
      release: undefined,
      importBatches: undefined,
      retentionPolicies: undefined,
      tombstoneIndex: undefined,
      releaseLineage: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
    expect(migrated.importBatches).toEqual([]);
    expect(migrated.tombstoneIndex.recordings).toEqual({});
    expect(migrated.releaseLineage).toEqual([]);
  });

  it("rejects structurally valid JSON with invalid nested domain fields", () => {
    const malformed = createSeedStudy();
    malformed.recordings[0].audioSpec.durationSeconds = -1;
    const storage = {
      getItem: () => JSON.stringify(malformed),
    } as unknown as Storage;
    expect(loadStudy(storage).project.title).toBe(
      createSeedStudy().project.title,
    );
  });

  it("recovers the previous checksummed state when the primary record is damaged", () => {    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage;
    const first = {
      ...createSeedStudy(),
      project: { ...createSeedStudy().project, title: "Recovered baseline" },
    };
    const second = {
      ...first,
      project: { ...first.project, title: "Current baseline" },
    };

    expect(saveStudy(first, storage)).toBe(true);
    expect(saveStudy(second, storage)).toBe(true);
    expect(values.has(STORAGE_BACKUP_KEY)).toBe(true);
    expect(values.get(STORAGE_BACKUP_KEY)).toContain("Recovered baseline");
    values.set(STORAGE_KEY, "{broken primary");

    expect(loadStudy(storage).project.title).toBe("Recovered baseline");
  });

  it("keeps archived material resolvable through tombstones after a reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage;
    const now = new Date("2026-09-17T12:00:00.000Z");
    const state: ReturnType<typeof createSeedStudy> = {
      ...createSeedStudy(),
      retentionPolicies: {
        ...createSeedStudy().retentionPolicies,
        importCompletedDays: 5,
      },
    };
    const archived = archiveRetained(state, "import", "batch-summer", now);
    expect(saveStudy(archived, storage)).toBe(true);

    const reloaded = loadStudy(storage);
    expect(reloaded.recordings.map((recording) => recording.id)).not.toContain(
      "rec-underpass",
    );
    // The live site reference survives reload and resolves via the vault.
    expect(
      reloaded.sites
        .find((site) => site.id === "site-threshold")
        ?.recordingIds.includes("rec-underpass"),
    ).toBe(true);
    expect(
      reloaded.tombstoneIndex.recordings["rec-underpass"]?.recording.title,
    ).toBe("Underpass reverb at dawn");
  });
});
