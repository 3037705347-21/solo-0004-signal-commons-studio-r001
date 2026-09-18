import { createId } from "./ids";
import type {
  ArchiveEntry,
  ImportBatch,
  Recording,
  ReleaseRecord,
  RetentionItem,
  RetentionKind,
  RetentionStatus,
  Site,
  StudyState,
} from "./models";

const DAY_MS = 86_400_000;

/**
 * Executable retention rules per business category.
 *
 * - superseded publications are retained after release, then expire;
 * - completed imports retain the clips they brought in, unfinished imports
 *   (the "未完成导入") expire on a shorter clock;
 * - sites still carrying the route are protected; disused sites expire.
 */
export interface RetentionRule {
  kind: RetentionKind;
  categoryLabel: string;
  /** Retention window in days before active material is considered expired. */
  retainDays: number;
  description: string;
}

export const RETENTION_RULES: RetentionRule[] = [
  {
    kind: "release",
    categoryLabel: "Superseded publication",
    retainDays: 365,
    description:
      "A published version is kept for 365 days after it is superseded so its snapshot and lineage keep resolving, then it can be archived.",
  },
  {
    kind: "import",
    categoryLabel: "Completed import",
    retainDays: 180,
    description:
      "A completed import batch and the clips it brought in are retained 180 days after completion.",
  },
  {
    kind: "import",
    categoryLabel: "Unfinished import",
    retainDays: 90,
    description:
      "An import batch that never completed is kept open for 90 days after its last change before it is treated as expired.",
  },
  {
    kind: "site",
    categoryLabel: "Disused listening site",
    retainDays: 120,
    description:
      "A site with no clips is retained 120 days after its last change; any site still carrying route clips is protected indefinitely.",
  },
];

export function retentionRule(
  kind: RetentionKind,
  openImport = false,
): RetentionRule {
  if (kind === "import") {
    return RETENTION_RULES.find(
      (rule) =>
        rule.kind === "import" &&
        rule.categoryLabel ===
          (openImport ? "Unfinished import" : "Completed import"),
    ) as RetentionRule;
  }
  return RETENTION_RULES.find((rule) => rule.kind === kind) as RetentionRule;
}

function ageDays(timestamp: string | undefined, at: Date): number {
  if (!timestamp) return 0;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return 0;
  return Math.floor((at.getTime() - time) / DAY_MS);
}

export interface ClassifiedRelease {
  record: ReleaseRecord;
  status: RetentionStatus;
  expiresAt?: string;
}

/**
 * Classify a historical (superseded) release. The current head release is
 * never expired — only publications kept only for lineage age out.
 */
export function classifyRelease(
  record: ReleaseRecord,
  at = new Date(),
): ClassifiedRelease {
  const rule = retentionRule("release");
  const expiresAt = new Date(
    Date.parse(record.createdAt) + rule.retainDays * DAY_MS,
  ).toISOString();
  const status: RetentionStatus =
    ageDays(record.createdAt, at) >= rule.retainDays ? "expired" : "active";
  return { record, status, expiresAt };
}

export interface ClassifiedImport {
  batch: ImportBatch;
  status: RetentionStatus;
  expiresAt?: string;
  recordingIds: string[];
}

export function classifyImport(
  batch: ImportBatch,
  recordings: Recording[],
  at = new Date(),
): ClassifiedImport {
  const open = batch.status === "open";
  const rule = retentionRule("import", open);
  const anchor = open ? batch.updatedAt : (batch.completedAt ?? batch.updatedAt);
  const expiresAt = new Date(
    Date.parse(anchor) + rule.retainDays * DAY_MS,
  ).toISOString();
  const status: RetentionStatus =
    ageDays(anchor, at) >= rule.retainDays ? "expired" : "active";
  return {
    batch,
    status,
    expiresAt,
    recordingIds: recordings
      .filter((recording) => recording.importBatchId === batch.id)
      .map((recording) => recording.id),
  };
}

export interface ClassifiedSite {
  site: Site;
  status: RetentionStatus;
  expiresAt?: string;
}

export function classifySite(site: Site, at = new Date()): ClassifiedSite {
  if (site.recordingIds.length > 0) {
    return { site, status: "active" };
  }
  const rule = retentionRule("site");
  const anchor = site.updatedAt;
  const expiresAt = new Date(
    Date.parse(anchor) + rule.retainDays * DAY_MS,
  ).toISOString();
  const status: RetentionStatus =
    ageDays(anchor, at) >= rule.retainDays ? "expired" : "active";
  return { site, status, expiresAt };
}

function releaseReferenceCount(record: ReleaseRecord): number {
  return record.snapshot
    ? record.snapshot.sites.reduce(
        (total, site) => total + site.recordings.length,
        record.snapshot.sites.length,
      )
    : 0;
}

/** Flatten every active material record into policy-classified items. */
export function classifyRetention(
  state: StudyState,
  at = new Date(),
): RetentionItem[] {
  const releases = state.releaseHistory.map((record) => {
    const classified = classifyRelease(record, at);
    return {
      kind: "release" as const,
      id: record.id,
      label: `Release #${record.sequence}`,
      status: classified.status,
      categoryLabel: retentionRule("release").categoryLabel,
      updatedAt: record.createdAt,
      expiresAt: classified.expiresAt,
      referenceCount: releaseReferenceCount(record),
      detail: record.snapshot
        ? `${record.snapshot.summary.recordingCount} clips frozen across ${record.snapshot.summary.siteCount} sites`
        : "No frozen snapshot",
    };
  });

  const imports = state.importBatches.map((batch) => {
    const classified = classifyImport(batch, state.recordings, at);
    const open = batch.status === "open";
    return {
      kind: "import" as const,
      id: batch.id,
      label: batch.label,
      status: classified.status,
      categoryLabel: retentionRule("import", open).categoryLabel,
      updatedAt: batch.updatedAt,
      expiresAt: classified.expiresAt,
      referenceCount: classified.recordingIds.filter((id) =>
        state.sites.some((site) => site.recordingIds.includes(id)),
      ).length,
      detail: `${classified.recordingIds.length} clip${
        classified.recordingIds.length === 1 ? "" : "s"
      } · ${open ? "never completed" : "completed import"}`,
    };
  });

  const sites = state.sites.map((site) => {
    const classified = classifySite(site, at);
    return {
      kind: "site" as const,
      id: site.id,
      label: site.name,
      status: classified.status,
      categoryLabel:
        site.recordingIds.length > 0
          ? "Route site (protected)"
          : retentionRule("site").categoryLabel,
      updatedAt: site.updatedAt,
      expiresAt: classified.expiresAt,
      referenceCount: site.recordingIds.length,
      detail: site.recordingIds.length
        ? `${site.recordingIds.length} placed clip${
            site.recordingIds.length === 1 ? "" : "s"
          }`
        : "No clips placed",
    };
  });

  return [...releases, ...imports, ...sites];
}

export function retentionCounts(items: RetentionItem[]) {
  return {
    active: items.filter((item) => item.status === "active").length,
    expired: items.filter((item) => item.status === "expired").length,
    archived: 0,
  };
}

export function isExpired(state: StudyState, at = new Date()): boolean {
  return classifyRetention(state, at).some(
    (item) => item.status === "expired",
  );
}

// ---------------------------------------------------------------------------
// Reference resolution: archived objects are tombstones that keep resolving.
// ---------------------------------------------------------------------------

export interface ResolvedRecording {
  recording: Recording;
  archived: boolean;
  archivedAt?: string;
}

export interface ResolvedSite {
  site: Site;
  archived: boolean;
  archivedAt?: string;
}

export interface ReferenceIssue {
  ownerId: string;
  ownerLabel: string;
  kind: "recording" | "site" | "batch";
  targetId: string;
  targetLabel: string;
  state: "archived" | "missing";
}

export function resolveRecording(
  state: StudyState,
  id: string,
): ResolvedRecording | null {
  const active = state.recordings.find((recording) => recording.id === id);
  if (active) return { recording: active, archived: false };
  for (const entry of state.archive) {
    const archived = entry.recordings.find((recording) => recording.id === id);
    if (archived)
      return {
        recording: archived,
        archived: true,
        archivedAt: entry.archivedAt,
      };
  }
  return null;
}

export function resolveSite(state: StudyState, id: string): ResolvedSite | null {
  const active = state.sites.find((site) => site.id === id);
  if (active) return { site: active, archived: false };
  const archivedEntry = state.archive.find(
    (entry) => entry.kind === "site" && entry.site?.id === id,
  );
  if (archivedEntry?.site)
    return {
      site: archivedEntry.site,
      archived: true,
      archivedAt: archivedEntry.archivedAt,
    };
  return null;
}

/**
 * Walk every reference that must keep resolving after cleanup: route
 * placements, findings, recording→batch links, and frozen release snapshots.
 * Archived targets resolve (reported as archived); truly unknown targets are
 * reported as missing.
 */
export function scanReferences(state: StudyState): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();
  const note = (issue: ReferenceIssue) => {
    const key = `${issue.ownerId}:${issue.kind}:${issue.targetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  state.sites.forEach((site) => {
    site.recordingIds.forEach((id) => {
      const resolved = resolveRecording(state, id);
      if (resolved?.archived)
        note({
          ownerId: site.id,
          ownerLabel: site.name,
          kind: "recording",
          targetId: id,
          targetLabel: resolved.recording.title,
          state: "archived",
        });
      else if (!resolved)
        note({
          ownerId: site.id,
          ownerLabel: site.name,
          kind: "recording",
          targetId: id,
          targetLabel: id,
          state: "missing",
        });
    });
  });

  state.issues.forEach((issue) => {
    if (issue.recordingId) {
      const resolved = resolveRecording(state, issue.recordingId);
      if (resolved?.archived)
        note({
          ownerId: issue.id,
          ownerLabel: issue.title,
          kind: "recording",
          targetId: issue.recordingId,
          targetLabel: resolved.recording.title,
          state: "archived",
        });
      else if (!resolved)
        note({
          ownerId: issue.id,
          ownerLabel: issue.title,
          kind: "recording",
          targetId: issue.recordingId,
          targetLabel: issue.recordingId,
          state: "missing",
        });
    }
    if (issue.siteId) {
      const resolved = resolveSite(state, issue.siteId);
      if (resolved?.archived)
        note({
          ownerId: issue.id,
          ownerLabel: issue.title,
          kind: "site",
          targetId: issue.siteId,
          targetLabel: resolved.site.name,
          state: "archived",
        });
      else if (!resolved)
        note({
          ownerId: issue.id,
          ownerLabel: issue.title,
          kind: "site",
          targetId: issue.siteId,
          targetLabel: issue.siteId,
          state: "missing",
        });
    }
  });

  state.recordings.forEach((recording) => {
    const batch = state.importBatches.find(
      (candidate) => candidate.id === recording.importBatchId,
    );
    if (!batch) {
      const archived = state.archive.find(
        (entry) =>
          entry.kind === "import" && entry.importBatch?.id === recording.importBatchId,
      );
      if (archived?.importBatch)
        note({
          ownerId: recording.id,
          ownerLabel: recording.title,
          kind: "batch",
          targetId: archived.importBatch.id,
          targetLabel: archived.importBatch.label,
          state: "archived",
        });
      else
        note({
          ownerId: recording.id,
          ownerLabel: recording.title,
          kind: "batch",
          targetId: recording.importBatchId,
          targetLabel: recording.importBatchId,
          state: "missing",
        });
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Sweep (archive expired material) and restore.
// ---------------------------------------------------------------------------

function makeArchiveEntry(
  partial: Omit<ArchiveEntry, "id" | "recordings" | "archivedAt"> & {
    recordings?: Recording[];
  },
  at: Date,
): ArchiveEntry {
  return {
    id: createId("archive"),
    recordings: [],
    archivedAt: at.toISOString(),
    ...partial,
  };
}

export interface SweepResult {
  state: StudyState;
  archived: ArchiveEntry[];
}

/**
 * Archive every expired record. Import batches move their clips into the
 * archive entry with them, so placed clips keep resolving through
 * resolveRecording and nothing hard-deletes.
 */
export function sweepExpired(state: StudyState, at = new Date()): SweepResult {
  const expired = classifyRetention(state, at).filter(
    (item) => item.status === "expired",
  );
  if (expired.length === 0) return { state, archived: [] };

  let next: StudyState = { ...state };
  const archived: ArchiveEntry[] = [];

  for (const item of expired) {
    if (item.kind === "release") {
      const record = next.releaseHistory.find(
        (candidate) => candidate.id === item.id,
      );
      if (!record) continue;
      next = {
        ...next,
        releaseHistory: next.releaseHistory.filter(
          (candidate) => candidate.id !== item.id,
        ),
      };
      archived.push(
        makeArchiveEntry(
          {
            kind: "release",
            reason: "Retention period ended for superseded publication",
            retentionLabel: item.categoryLabel,
            release: record,
          },
          at,
        ),
      );
    } else if (item.kind === "import") {
      const batch = next.importBatches.find(
        (candidate) => candidate.id === item.id,
      );
      if (!batch) continue;
      const clips = next.recordings.filter(
        (recording) => recording.importBatchId === batch.id,
      );
      const clipIds = new Set(clips.map((clip) => clip.id));
      next = {
        ...next,
        importBatches: next.importBatches.filter(
          (candidate) => candidate.id !== batch.id,
        ),
        recordings: next.recordings.filter(
          (recording) => !clipIds.has(recording.id),
        ),
      };
      archived.push(
        makeArchiveEntry(
          {
            kind: "import",
            reason:
              batch.status === "open"
                ? "Unfinished import passed its 90 day window"
                : "Completed import passed its 180 day window",
            retentionLabel: item.categoryLabel,
            importBatch: batch,
            recordings: clips,
          },
          at,
        ),
      );
    } else {
      const site = next.sites.find((candidate) => candidate.id === item.id);
      if (!site) continue;
      next = {
        ...next,
        sites: next.sites.filter((candidate) => candidate.id !== site.id),
      };
      archived.push(
        makeArchiveEntry(
          {
            kind: "site",
            reason: "Disused listening site passed its 120 day window",
            retentionLabel: item.categoryLabel,
            site,
          },
          at,
        ),
      );
    }
  }

  return { state: { ...next, archive: [...next.archive, ...archived] }, archived };
}

/** Archive one specific record; no-op unless the policy currently allows it. */
export function archiveRecord(
  state: StudyState,
  kind: RetentionKind,
  id: string,
  at = new Date(),
): SweepResult {
  const item = classifyRetention(state, at).find(
    (candidate) => candidate.kind === kind && candidate.id === id,
  );
  if (!item || item.status !== "expired") return { state, archived: [] };
  return sweepOne(state, kind, id, item.categoryLabel, at);
}

function sweepOne(
  state: StudyState,
  kind: RetentionKind,
  id: string,
  categoryLabel: string,
  at: Date,
): SweepResult {
  let next = { ...state };
  const entry = (() => {
    if (kind === "release") {
      const record = next.releaseHistory.find((candidate) => candidate.id === id);
      if (!record) return null;
      next = {
        ...next,
        releaseHistory: next.releaseHistory.filter(
          (candidate) => candidate.id !== id,
        ),
      };
      return makeArchiveEntry(
        {
          kind,
          reason: "Retention period ended for superseded publication",
          retentionLabel: categoryLabel,
          release: record,
        },
        at,
      );
    }
    if (kind === "import") {
      const batch = next.importBatches.find((candidate) => candidate.id === id);
      if (!batch) return null;
      const clips = next.recordings.filter(
        (recording) => recording.importBatchId === batch.id,
      );
      const clipIds = new Set(clips.map((clip) => clip.id));
      next = {
        ...next,
        importBatches: next.importBatches.filter(
          (candidate) => candidate.id !== id,
        ),
        recordings: next.recordings.filter(
          (recording) => !clipIds.has(recording.id),
        ),
      };
      return makeArchiveEntry(
        {
          kind,
          reason:
            batch.status === "open"
              ? "Unfinished import passed its 90 day window"
              : "Completed import passed its 180 day window",
          retentionLabel: categoryLabel,
          importBatch: batch,
          recordings: clips,
        },
        at,
      );
    }
    const site = next.sites.find((candidate) => candidate.id === id);
    if (!site) return null;
    next = {
      ...next,
      sites: next.sites.filter((candidate) => candidate.id !== id),
    };
    return makeArchiveEntry(
      {
        kind,
        reason: "Disused listening site passed its 120 day window",
        retentionLabel: categoryLabel,
        site,
      },
      at,
    );
  })();
  if (!entry) return { state, archived: [] };
  return {
    state: { ...next, archive: [...next.archive, entry] },
    archived: [entry],
  };
}

export interface RestoreResult {
  state: StudyState;
  restored: Array<{ kind: RetentionKind; id: string; label: string }>;
}

/**
 * Restore an archived record. Content comes back marked with restoredAt and
 * must pass a fresh readiness check (re-earn publication eligibility) before
 * it can be part of a published version again. Restoring an import batch
 * brings its clips back with it.
 */
export function restoreArchived(
  state: StudyState,
  archiveId: string,
  at = new Date(),
): RestoreResult {
  const entry = state.archive.find((candidate) => candidate.id === archiveId);
  if (!entry) return { state, restored: [] };
  const timestamp = at.toISOString();
  const restored: RestoreResult["restored"] = [];
  let next = { ...state, archive: state.archive.filter((item) => item.id !== archiveId) };

  if (entry.kind === "release" && entry.release) {
    const record = entry.release;
    // A restored publication is not re-published automatically: it returns as
    // historical lineage marked for re-qualification. The current head stays
    // untouched, and a readiness check is required to publish again.
    next = {
      ...next,
      releaseHistory: [
        ...next.releaseHistory,
        {
          ...record,
          status: record.status === "ready" ? "stale" : record.status,
        },
      ],
    };
    restored.push({ kind: "release", id: record.id, label: `Release #${record.sequence}` });
  } else if (entry.kind === "import" && entry.importBatch) {
    const batch: ImportBatch = {
      ...entry.importBatch,
      status: "open",
      completedAt: undefined,
      restoredAt: timestamp,
      updatedAt: timestamp,
    };
    const clips = entry.recordings.map((recording) => ({
      ...recording,
      restoredAt: timestamp,
    }));
    next = {
      ...next,
      importBatches: [...next.importBatches, batch],
      recordings: [...next.recordings, ...clips],
    };
    restored.push({ kind: "import", id: batch.id, label: batch.label });
  } else if (entry.kind === "site" && entry.site) {
    const site: Site = {
      ...entry.site,
      restoredAt: timestamp,
      updatedAt: timestamp,
    };
    next = { ...next, sites: [...next.sites, site] };
    restored.push({ kind: "site", id: site.id, label: site.name });
  }

  return { state: next, restored };
}

/** Clips currently waiting to re-earn publication eligibility. */
export function pendingRequalification(state: StudyState): {
  recordings: Recording[];
  sites: Site[];
  batches: ImportBatch[];
} {
  return {
    recordings: state.recordings.filter((recording) => recording.restoredAt),
    sites: state.sites.filter((site) => site.restoredAt),
    batches: state.importBatches.filter((batch) => batch.restoredAt),
  };
}

/**
 * Restored material actually covered by the current release: restored sites
 * (all of them frame the route), and restored clips / import batches whose
 * clips are placed on the route. Restored clips left out of the route keep
 * their marker until they are placed and a later check passes.
 */
export function requalificationCandidates(state: StudyState): {
  recordings: Set<string>;
  sites: Set<string>;
  batches: Set<string>;
} {
  const placedRecordingIds = new Set(
    state.sites.flatMap((site) => site.recordingIds),
  );
  const recordings = new Set<string>();
  const batches = new Set<string>();
  state.recordings.forEach((recording) => {
    if (recording.restoredAt && placedRecordingIds.has(recording.id)) {
      recordings.add(recording.id);
      if (recording.importBatchId) batches.add(recording.importBatchId);
    }
  });
  const sites = new Set(
    state.sites.map((site) => site.id),
  );
  return { recordings, sites, batches };
}

/**
 * Clear requalification markers for restored material covered by a passing
 * release check. Restored clips not part of the route keep their marker.
 */
export function requalifyForRelease(state: StudyState): StudyState {
  const candidates = requalificationCandidates(state);
  return {
    ...state,
    recordings: state.recordings.map((recording) =>
      recording.restoredAt && candidates.recordings.has(recording.id)
        ? { ...recording, restoredAt: undefined }
        : recording,
    ),
    sites: state.sites.map((site) =>
      site.restoredAt && candidates.sites.has(site.id)
        ? { ...site, restoredAt: undefined }
        : site,
    ),
    importBatches: state.importBatches.map((batch) =>
      batch.restoredAt && candidates.batches.has(batch.id)
        ? { ...batch, restoredAt: undefined }
        : batch,
    ),
  };
}

/** Clear requalification markers once a release check passes. */
export function clearRequalification(state: StudyState): StudyState {
  return {
    ...state,
    recordings: state.recordings.map((recording) =>
      recording.restoredAt ? { ...recording, restoredAt: undefined } : recording,
    ),
    sites: state.sites.map((site) =>
      site.restoredAt ? { ...site, restoredAt: undefined } : site,
    ),
    importBatches: state.importBatches.map((batch) =>
      batch.restoredAt ? { ...batch, restoredAt: undefined } : batch,
    ),
  };
}
