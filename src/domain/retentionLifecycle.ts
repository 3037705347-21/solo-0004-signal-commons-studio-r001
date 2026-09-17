import {
  findRetentionEntry,
  resolveImportBatch,
  resolveRelease,
  resolveSite,
} from "./retention";
import type { RetentionCategory, StudyState } from "./models";

function cloneTombstones(state: StudyState): StudyState["tombstoneIndex"] {
  return {
    recordings: { ...state.tombstoneIndex.recordings },
    sites: { ...state.tombstoneIndex.sites },
    importBatches: { ...state.tombstoneIndex.importBatches },
    releases: { ...state.tombstoneIndex.releases },
  };
}

function requireExpiredLive(
  state: StudyState,
  category: RetentionCategory,
  id: string,
  at: Date,
) {
  const entry = findRetentionEntry(state, category, id, at);
  if (!entry) throw new Error("The material has no retention record.");
  if (entry.status === "archived")
    throw new Error("The material is already archived.");
  if (entry.status !== "expired")
    throw new Error("Only expired material can be archived.");
  return entry;
}

/* -------------------------------- archive ------------------------------- */

export function archiveImportBatch(
  state: StudyState,
  batchId: string,
  at = new Date(),
): StudyState {
  requireExpiredLive(state, "import", batchId, at);
  const resolved = resolveImportBatch(state, batchId);
  if (!resolved || resolved.archived)
    throw new Error("The import batch is not available to archive.");
  const batch = resolved.batch;
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);

  state.recordings
    .filter((recording) => recording.importBatchId === batchId)
    .forEach((recording) => {
      tombstones.recordings[recording.id] = {
        recording: { ...recording, archivedAt: timestamp },
        siteIds: state.sites
          .filter((site) => site.recordingIds.includes(recording.id))
          .map((site) => site.id),
        issueIds: state.issues
          .filter((issue) => issue.recordingId === recording.id)
          .map((issue) => issue.id),
        archivedAt: timestamp,
      };
    });

  tombstones.importBatches[batchId] = {
    batch: { ...batch, archivedAt: timestamp },
    recordingIds: state.recordings
      .filter((recording) => recording.importBatchId === batchId)
      .map((recording) => recording.id),
    archivedAt: timestamp,
  };

  // Cleaned recordings leave the live library and their batch leaves the intake
  // list, but site references and findings keep resolving via the tombstones.
  return {
    ...state,
    recordings: state.recordings.filter(
      (recording) => recording.importBatchId !== batchId,
    ),
    importBatches: state.importBatches.filter((item) => item.id !== batchId),
    tombstoneIndex: tombstones,
  };
}

export function archiveSite(
  state: StudyState,
  siteId: string,
  at = new Date(),
): StudyState {
  requireExpiredLive(state, "site", siteId, at);
  const resolved = resolveSite(state, siteId);
  if (!resolved || resolved.archived)
    throw new Error("The site is not available to archive.");
  const site = resolved.site;
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);
  tombstones.sites[siteId] = {
    site: { ...site, archivedAt: timestamp },
    recordingIds: [...site.recordingIds],
    issueIds: state.issues
      .filter((issue) => issue.siteId === siteId)
      .map((issue) => issue.id),
    archivedAt: timestamp,
  };
  return {
    ...state,
    sites: state.sites.filter((item) => item.id !== siteId),
    tombstoneIndex: tombstones,
  };
}

export function archiveRelease(
  state: StudyState,
  releaseId: string,
  at = new Date(),
): StudyState {
  requireExpiredLive(state, "release", releaseId, at);
  const resolved = resolveRelease(state, releaseId);
  if (!resolved || resolved.archived)
    throw new Error("The release is not available to archive.");
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);
  tombstones.releases[releaseId] = {
    release: { ...resolved.release, archivedAt: timestamp },
    archivedAt: timestamp,
  };
  const isCurrent = state.release?.id === releaseId;
  return {
    ...state,
    // Removing the current publication withdraws the ready standing.
    project: isCurrent
      ? { ...state.project, stage: state.project.stage === "ready" ? "review" : state.project.stage }
      : state.project,
    release: isCurrent ? null : state.release,
    releaseLineage: state.releaseLineage.filter((item) => item.id !== releaseId),
    tombstoneIndex: tombstones,
  };
}

export function archiveRetained(
  state: StudyState,
  category: RetentionCategory,
  id: string,
  at = new Date(),
): StudyState {
  if (category === "import") return archiveImportBatch(state, id, at);
  if (category === "site") return archiveSite(state, id, at);
  return archiveRelease(state, id, at);
}

/* -------------------------------- restore ------------------------------- */

export function restoreImportBatch(
  state: StudyState,
  batchId: string,
  at = new Date(),
): StudyState {
  const archived = state.tombstoneIndex.importBatches[batchId];
  if (!archived) throw new Error("The import batch is not archived.");
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);

  const recordings = archived.recordingIds
    .map((id) => tombstones.recordings[id])
    .map((item) => {
      if (!item) return null;
      delete tombstones.recordings[item.recording.id];
      return {
        ...item.recording,
        archivedAt: undefined,
        restoredAt: timestamp,
        requalifiedAt: undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  delete tombstones.importBatches[batchId];

  return {
    ...state,
    recordings: [...state.recordings, ...recordings],
    importBatches: [
      ...state.importBatches,
      {
        ...archived.batch,
        archivedAt: undefined,
        restoredAt: timestamp,
        requalifiedAt: undefined,
      },
    ],
    tombstoneIndex: tombstones,
  };
}

export function restoreSite(
  state: StudyState,
  siteId: string,
  at = new Date(),
): StudyState {
  const archived = state.tombstoneIndex.sites[siteId];
  if (!archived) throw new Error("The site is not archived.");
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);
  delete tombstones.sites[siteId];
  return {
    ...state,
    sites: [
      ...state.sites,
      {
        ...archived.site,
        archivedAt: undefined,
        restoredAt: timestamp,
        requalifiedAt: undefined,
      },
    ],
    tombstoneIndex: tombstones,
  };
}

export function restoreRelease(
  state: StudyState,
  releaseId: string,
  at = new Date(),
): StudyState {
  const archived = state.tombstoneIndex.releases[releaseId];
  if (!archived) throw new Error("The release is not archived.");
  const timestamp = at.toISOString();
  const tombstones = cloneTombstones(state);
  delete tombstones.releases[releaseId];
  // A restored release returns as historical lineage, never as the current
  // publication, and needs re-approval before it can feed a new release.
  const release = {
    ...archived.release,
    archivedAt: undefined,
    restoredAt: timestamp,
    requalifiedAt: undefined,
  };
  return {
    ...state,
    releaseLineage: [...state.releaseLineage, release],
    tombstoneIndex: tombstones,
  };
}

export function restoreRetained(
  state: StudyState,
  category: RetentionCategory,
  id: string,
  at = new Date(),
): StudyState {
  if (category === "import") return restoreImportBatch(state, id, at);
  if (category === "site") return restoreSite(state, id, at);
  return restoreRelease(state, id, at);
}

/* ------------------------------ requalify ------------------------------- */

export function requalifyImportBatch(
  state: StudyState,
  batchId: string,
  at = new Date(),
): StudyState {
  const resolved = resolveImportBatch(state, batchId);
  if (!resolved || resolved.archived)
    throw new Error("The import batch is not available to requalify.");
  const entry = findRetentionEntry(state, "import", batchId, at);
  if (!entry || !entry.requalificationRequired)
    throw new Error("The import batch does not need requalification.");
  const timestamp = at.toISOString();
  return {
    ...state,
    importBatches: state.importBatches.map((batch) =>
      batch.id === batchId ? { ...batch, requalifiedAt: timestamp } : batch,
    ),
    recordings: state.recordings.map((recording) =>
      recording.importBatchId === batchId
        ? { ...recording, requalifiedAt: timestamp }
        : recording,
    ),
  };
}

export function requalifySite(
  state: StudyState,
  siteId: string,
  at = new Date(),
): StudyState {
  const resolved = resolveSite(state, siteId);
  if (!resolved || resolved.archived)
    throw new Error("The site is not available to requalify.");
  const entry = findRetentionEntry(state, "site", siteId, at);
  if (!entry || !entry.requalificationRequired)
    throw new Error("The site does not need requalification.");
  const timestamp = at.toISOString();
  return {
    ...state,
    sites: state.sites.map((site) =>
      site.id === siteId ? { ...site, requalifiedAt: timestamp } : site,
    ),
  };
}

export function requalifyRelease(
  state: StudyState,
  releaseId: string,
  at = new Date(),
): StudyState {
  const resolved = resolveRelease(state, releaseId);
  if (!resolved || resolved.archived)
    throw new Error("The release is not available to requalify.");
  const entry = findRetentionEntry(state, "release", releaseId, at);
  if (!entry || !entry.requalificationRequired)
    throw new Error("The release does not need requalification.");
  const timestamp = at.toISOString();
  const requalified = { ...resolved.release, requalifiedAt: timestamp };
  return {
    ...state,
    release:
      state.release?.id === releaseId ? requalified : state.release,
    releaseLineage: state.releaseLineage.map((item) =>
      item.id === releaseId ? requalified : item,
    ),
  };
}

export function requalifyRetained(
  state: StudyState,
  category: RetentionCategory,
  id: string,
  at = new Date(),
): StudyState {
  if (category === "import") return requalifyImportBatch(state, id, at);
  if (category === "site") return requalifySite(state, id, at);
  return requalifyRelease(state, id, at);
}

/* ------------------------------ batch intake ----------------------------- */

export function completeImportBatch(
  state: StudyState,
  batchId: string,
  at = new Date(),
): StudyState {
  const batch = state.importBatches.find((item) => item.id === batchId);
  if (!batch) throw new Error("The import batch does not exist.");
  if (batch.status === "completed") return state;
  return {
    ...state,
    importBatches: state.importBatches.map((item) =>
      item.id === batchId
        ? { ...item, status: "completed", completedAt: at.toISOString() }
        : item,
    ),
  };
}
