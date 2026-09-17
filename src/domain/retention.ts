import { addDays, isoToday } from "./dateMath";
import type {
  ArchivedImportBatch,
  ArchivedRecording,
  ArchivedRelease,
  ArchivedSite,
  ImportBatch,
  Recording,
  ReleaseRecord,
  RetentionCategory,
  RetentionEntry,
  RetentionPolicy,
  RetentionStatus,
  Site,
  StudyState,
  TombstoneIndex,
} from "./models";

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  releaseDays: 365,
  importOpenDays: 90,
  importCompletedDays: 180,
  siteDays: 240,
  restoreGraceDays: 30,
};

export const RETENTION_CATEGORIES: RetentionCategory[] = [
  "release",
  "import",
  "site",
];

export const releaseRetentionKey = (id: string): string => `release:${id}`;
export const importRetentionKey = (id: string): string => `import:${id}`;
export const siteRetentionKey = (id: string): string => `site:${id}`;

export function emptyTombstones(): TombstoneIndex {
  return { recordings: {}, sites: {}, importBatches: {}, releases: {} };
}

export function allReleases(state: StudyState): ReleaseRecord[] {
  return [...(state.release ? [state.release] : []), ...state.releaseLineage];
}

function policyDaysFor(
  policy: RetentionPolicy,
  category: RetentionCategory,
  status?: ImportBatch["status"],
): number {
  if (category === "release") return policy.releaseDays;
  if (category === "site") return policy.siteDays;
  return status === "completed"
    ? policy.importCompletedDays
    : policy.importOpenDays;
}

/**
 * A restored record keeps a renewed retention window from its restore date;
 * after explicit requalification the window restarts and the publication hold
 * is lifted.
 */
function retentionAnchor(
  origin: string,
  restoredAt?: string,
  requalifiedAt?: string,
): string {
  return (requalifiedAt ?? restoredAt ?? origin).slice(0, 10);
}

export function needsRequalification(
  restoredAt?: string,
  requalifiedAt?: string,
): boolean {
  if (!restoredAt) return false;
  if (!requalifiedAt) return true;
  // A same-day re-approval satisfies the hold; timestamps are compared at day
  // granularity because the restored window itself is day-based.
  return requalifiedAt.slice(0, 10) < restoredAt.slice(0, 10);
}

interface RetentionSubject {
  id: string;
  label: string;
  origin: string;
  restoredAt?: string;
  requalifiedAt?: string;
  archivedAt?: string;
  importStatus?: ImportBatch["status"];
}

function buildEntry(
  category: RetentionCategory,
  keyFor: (id: string) => string,
  policy: RetentionPolicy,
  subject: RetentionSubject,
  now: Date,
): RetentionEntry {
  const policyDays = policyDaysFor(policy, category, subject.importStatus);
  const anchor = retentionAnchor(
    subject.origin,
    subject.restoredAt,
    subject.requalifiedAt,
  );
  const retainedUntil = addDays(anchor, policyDays);
  const status: RetentionStatus = subject.archivedAt
    ? "archived"
    : retainedUntil < isoToday(now)
      ? "expired"
      : "active";
  return {
    key: keyFor(subject.id),
    category,
    id: subject.id,
    label: subject.label,
    retainedFrom: subject.origin.slice(0, 10),
    retainedUntil,
    status,
    archivedAt: subject.archivedAt,
    restoredAt: subject.restoredAt,
    requalifiedAt: subject.requalifiedAt,
    requalificationRequired: needsRequalification(
      subject.restoredAt,
      subject.requalifiedAt,
    ),
    policyDays,
  };
}

/**
 * Retention standing is fully derived: live records from their origin (or last
 * restore / requalification) and the current policy, archived records from
 * their tombstone snapshots. Nothing is duplicated into a mutable index.
 */
export function deriveRetention(
  state: StudyState,
  now = new Date(),
): Record<string, RetentionEntry> {
  const result: Record<string, RetentionEntry> = {};
  const policy = state.retentionPolicies;

  const addRelease = (release: ReleaseRecord, archivedAt?: string) => {
    const entry = buildEntry(
      "release",
      releaseRetentionKey,
      policy,
      {
        id: release.id,
        label: `Release #${release.sequence}`,
        origin: release.createdAt,
        restoredAt: release.restoredAt,
        requalifiedAt: release.requalifiedAt,
        archivedAt: archivedAt ?? release.archivedAt,
      },
      now,
    );
    result[entry.key] = entry;
  };
  allReleases(state).forEach((release) => addRelease(release));
  Object.values(state.tombstoneIndex.releases).forEach((archived) =>
    addRelease(archived.release, archived.archivedAt),
  );

  const addBatch = (batch: ImportBatch, archivedAt?: string) => {
    const entry = buildEntry(
      "import",
      importRetentionKey,
      policy,
      {
        id: batch.id,
        label: batch.label,
        origin:
          batch.status === "completed" && batch.completedAt
            ? batch.completedAt
            : batch.createdAt,
        restoredAt: batch.restoredAt,
        requalifiedAt: batch.requalifiedAt,
        archivedAt: archivedAt ?? batch.archivedAt,
        importStatus: batch.status,
      },
      now,
    );
    result[entry.key] = entry;
  };
  state.importBatches.forEach((batch) => addBatch(batch));
  Object.values(state.tombstoneIndex.importBatches).forEach((archived) =>
    addBatch(archived.batch, archived.archivedAt),
  );

  const addSite = (site: Site, archivedAt?: string) => {
    const entry = buildEntry(
      "site",
      siteRetentionKey,
      policy,
      {
        id: site.id,
        label: site.name,
        origin: site.updatedAt ?? state.updatedAt,
        restoredAt: site.restoredAt,
        requalifiedAt: site.requalifiedAt,
        archivedAt: archivedAt ?? site.archivedAt,
      },
      now,
    );
    result[entry.key] = entry;
  };
  state.sites.forEach((site) => addSite(site));
  Object.values(state.tombstoneIndex.sites).forEach((archived) =>
    addSite(archived.site, archived.archivedAt),
  );

  return result;
}

export function findRetentionEntry(
  state: StudyState,
  category: RetentionCategory,
  id: string,
  now = new Date(),
): RetentionEntry | undefined {
  const key =
    category === "release"
      ? releaseRetentionKey(id)
      : category === "import"
        ? importRetentionKey(id)
        : siteRetentionKey(id);
  return deriveRetention(state, now)[key];
}

export interface RetentionOverview {
  entries: RetentionEntry[];
  activeCount: number;
  expiredCount: number;
  archivedCount: number;
  archived: {
    recordings: ArchivedRecording[];
    sites: ArchivedSite[];
    importBatches: ArchivedImportBatch[];
    releases: ArchivedRelease[];
  };
}

export function retentionOverview(
  state: StudyState,
  now = new Date(),
): RetentionOverview {
  const entries = Object.values(deriveRetention(state, now)).sort((left, right) =>
    left.retainedUntil.localeCompare(right.retainedUntil),
  );
  const { tombstoneIndex } = state;
  const archived = {
    recordings: Object.values(tombstoneIndex.recordings),
    sites: Object.values(tombstoneIndex.sites),
    importBatches: Object.values(tombstoneIndex.importBatches),
    releases: Object.values(tombstoneIndex.releases),
  };
  return {
    entries,
    activeCount: entries.filter((entry) => entry.status === "active").length,
    expiredCount: entries.filter((entry) => entry.status === "expired").length,
    archivedCount:
      archived.recordings.length +
      archived.sites.length +
      archived.importBatches.length +
      archived.releases.length,
    archived,
  };
}

/* ------------------------- publication qualification -------------------- */

/** A restored recording (including one restored with its import batch). */
export function unqualifiedRecordingIds(state: StudyState): string[] {
  return state.recordings
    .filter((recording) =>
      needsRequalification(recording.restoredAt, recording.requalifiedAt),
    )
    .map((recording) => recording.id);
}

/** Restored sites that have not been re-approved for publication. */
export function unqualifiedSiteIds(state: StudyState): string[] {
  return state.sites
    .filter((site) => needsRequalification(site.restoredAt, site.requalifiedAt))
    .map((site) => site.id);
}

export function unqualifiedRestoreCount(state: StudyState): number {
  return (
    unqualifiedRecordingIds(state).length + unqualifiedSiteIds(state).length
  );
}

/* ------------------------- reference resolution ------------------------- */

export function resolveRecording(
  state: StudyState,
  recordingId: string,
): Recording | undefined {
  return (
    state.recordings.find((recording) => recording.id === recordingId) ??
    state.tombstoneIndex.recordings[recordingId]?.recording
  );
}

export function isRecordingArchived(state: StudyState, recordingId: string): boolean {
  return Boolean(state.tombstoneIndex.recordings[recordingId]);
}

export function resolveSite(
  state: StudyState,
  siteId: string,
): { site: Site; archived: boolean } | undefined {
  const live = state.sites.find((site) => site.id === siteId);
  if (live) return { site: live, archived: false };
  const archived = state.tombstoneIndex.sites[siteId];
  return archived ? { site: archived.site, archived: true } : undefined;
}

export function resolveImportBatch(
  state: StudyState,
  batchId: string,
): { batch: ImportBatch; archived: boolean } | undefined {
  const live = state.importBatches.find((batch) => batch.id === batchId);
  if (live) return { batch: live, archived: false };
  const archived = state.tombstoneIndex.importBatches[batchId];
  return archived ? { batch: archived.batch, archived: true } : undefined;
}

export function resolveRelease(
  state: StudyState,
  releaseId: string,
): { release: ReleaseRecord; archived: boolean } | undefined {
  const live = allReleases(state).find((release) => release.id === releaseId);
  if (live) return { release: live, archived: false };
  const archived = state.tombstoneIndex.releases[releaseId];
  return archived ? { release: archived.release, archived: true } : undefined;
}

/** Live site references that now resolve only through a tombstone. */
export function danglingArchivedReferenceIds(state: StudyState): string[] {
  const referenced = new Set(state.sites.flatMap((site) => site.recordingIds));
  return [...referenced].filter((id) =>
    Boolean(state.tombstoneIndex.recordings[id]),
  );
}
