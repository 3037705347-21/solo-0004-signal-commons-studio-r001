import { createId } from "../domain/ids";
import { canPlaceRecording } from "../domain/routeAnalysis";
import {
  archiveRetained,
  completeImportBatch,
  requalifyRetained,
  restoreRetained,
} from "../domain/retentionLifecycle";
import { compactLog, makeLogEntry } from "../domain/studyLog";
import {
  regressReadyProject,
  transitionIssue,
  transitionProject,
} from "../domain/transitions";
import type {
  RetentionCategory,
  StudyState,
} from "../domain/models";
import type { StudyAction } from "./actions";

const AUDIT_LOG_LIMIT = 80;

function commandDisposition(
  state: StudyState,
  action: StudyAction,
): "apply" | "duplicate" | "conflict" {
  const meta = action.meta;
  if (!meta) return "apply";
  if (
    state.auditLog.some(
      (entry) => entry.commandId === meta.commandId,
    )
  )
    return "duplicate";
  return meta.expectedRevision === state.revision ? "apply" : "conflict";
}

function finalizeAction(
  state: StudyState,
  action: StudyAction,
  revision: number,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  const entry = makeLogEntry(
    action,
    createId("event"),
    revision,
    at,
  );
  return {
    ...state,
    revision,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
    auditLog: compactLog([...state.auditLog, entry], AUDIT_LOG_LIMIT),
  };
}

function rejectCommand(
  state: StudyState,
  action: StudyAction,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  return {
    ...state,
    lastSavedAt: timestamp,
    auditLog: compactLog(
      [
        ...state.auditLog,
        makeLogEntry(
          action,
          action.meta?.commandId ?? createId("event"),
          state.revision,
          at,
          "system",
          "rejected",
        ),
      ],
      AUDIT_LOG_LIMIT,
    ),
  };
}

function invalidateRelease(state: StudyState): StudyState {
  if (!state.release || state.release.status === "stale") return state;
  return {
    ...state,
    release: { ...state.release, status: "stale" },
  };
}

function mutate(
  state: StudyState,
  action: StudyAction,
  next: StudyState,
  options: { invalidate?: boolean } = {},
): StudyState {
  if (next === state) return state;
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  const finalized = finalizeAction(next, action, state.revision + 1);
  return options.invalidate === false ? finalized : invalidateRelease(finalized);
}

function applyReadinessStage(
  state: StudyState,
  ready: boolean,
): StudyState {
  if (!ready) {
    return state.project.stage === "ready"
      ? transitionProject(state, "review")
      : state;
  }
  const reviewState =
    state.project.stage === "draft"
      ? transitionProject(state, "review")
      : state;
  return reviewState.project.stage === "review"
    ? transitionProject(reviewState, "ready")
    : reviewState;
}

function removeRecordingFromSites(
  state: StudyState,
  recordingId: string,
): StudyState {
  const timestamp = new Date().toISOString();
  return {
    ...state,
    sites: state.sites.map((site) =>
      site.recordingIds.includes(recordingId)
        ? {
            ...site,
            recordingIds: site.recordingIds.filter((id) => id !== recordingId),
            updatedAt: timestamp,
          }
        : site,
    ),
  };
}

function assignRecording(
  state: StudyState,
  recordingId: string,
  siteId: string,
  index?: number,
  at = new Date(),
): StudyState {
  if (!state.recordings.some((recording) => recording.id === recordingId)) {
    throw new Error("Cannot place a clip that is not in the library.");
  }
  const targetSite = state.sites.find((site) => site.id === siteId);
  if (!targetSite) {
    throw new Error("Cannot place a recording in an unknown site.");
  }
  const recording = state.recordings.find(
    (candidate) => candidate.id === recordingId,
  );
  if (!recording) {
    throw new Error("Cannot place a clip that is not in the library.");
  }
  const recordingById = new Map(
    state.recordings.map((candidate) => [candidate.id, candidate]),
  );
  const currentClips = targetSite.recordingIds
    .filter((id) => id !== recordingId)
    .map((id) => recordingById.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );
  const [blocking] = canPlaceRecording(recording, targetSite, currentClips).filter(
    (finding) => finding.type === "error",
  );
  if (blocking) {
    throw new Error(blocking.detail);
  }
  const timestamp = at.toISOString();
  const removed = removeRecordingFromSites(state, recordingId);
  return {
    ...removed,
    sites: removed.sites.map((site) => {
      if (site.id !== siteId) return site;
      const targetIndex =
        index === undefined
          ? site.recordingIds.length
          : Math.max(0, Math.min(index, site.recordingIds.length));
      const recordingIds = [...site.recordingIds];
      recordingIds.splice(targetIndex, 0, recordingId);
      return { ...site, recordingIds, updatedAt: timestamp };
    }),
  };
}

function reorderRecording(
  state: StudyState,
  siteId: string,
  recordingId: string,
  direction: -1 | 1,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  return {
    ...state,
    sites: state.sites.map((site) => {
      if (site.id !== siteId) return site;
      const currentIndex = site.recordingIds.indexOf(recordingId);
      if (currentIndex === -1)
        throw new Error("The recording is not placed in this site.");
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= site.recordingIds.length)
        return site;
      const recordingIds = [...site.recordingIds];
      [recordingIds[currentIndex], recordingIds[targetIndex]] = [
        recordingIds[targetIndex],
        recordingIds[currentIndex],
      ];
      return { ...site, recordingIds, updatedAt: timestamp };
    }),
  };
}

function applyRetentionCommand(
  state: StudyState,
  action: StudyAction,
  kind: "archive" | "restore" | "requalify",
): StudyState {
  if (
    action.type !== "retention/archive" &&
    action.type !== "retention/restore" &&
    action.type !== "retention/requalify"
  )
    return state;
  // Idempotency and revision guards are enforced before touching content.
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  const { category, id } = action as {
    category: RetentionCategory;
    id: string;
  };
  let next: StudyState;
  try {
    next =
      kind === "archive"
        ? archiveRetained(state, category, id)
        : kind === "restore"
          ? restoreRetained(state, category, id)
          : requalifyRetained(state, category, id);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Retention action failed.");
  }
  // Restoring and requalifying are custodial actions; archiving changes the
  // content the last release was frozen against, except when only an old
  // lineage release is being moved to the vault.
  const invalidate =
    kind !== "archive"
      ? false
      : !(
          action.type === "retention/archive" &&
          action.category === "release" &&
          state.release?.id !== action.id
        );
  return finalizeAction(
    invalidate ? invalidateRelease(next) : next,
    action,
    state.revision + 1,
  );
}

export function workspaceReducer(
  state: StudyState,
  action: StudyAction,
): StudyState {
  switch (action.type) {
    case "recording/upsert": {
      const exists = state.recordings.some(
        (recording) => recording.id === action.recording.id,
      );
      const recordings = exists
        ? state.recordings.map((recording) =>
            recording.id === action.recording.id ? action.recording : recording,
          )
        : [...state.recordings, action.recording];
      return mutate(
        state,
        action,
        regressReadyProject({ ...state, recordings }),
      );
    }
    case "recording/remove": {
      const withoutPlacement = removeRecordingFromSites(
        state,
        action.recordingId,
      );
      return mutate(
        state,
        action,
        regressReadyProject({
          ...withoutPlacement,
          recordings: withoutPlacement.recordings.filter(
            (recording) => recording.id !== action.recordingId,
          ),
          issues: withoutPlacement.issues.filter(
            (issue) => issue.recordingId !== action.recordingId,
          ),
          importBatches: withoutPlacement.importBatches.map((batch) => ({
            ...batch,
            recordingIds: batch.recordingIds.filter(
              (id) => id !== action.recordingId,
            ),
          })),
        }),
      );
    }
    case "placement/assign":
      return mutate(
        state,
        action,
        regressReadyProject(
          assignRecording(
            state,
            action.recordingId,
            action.siteId,
            action.index,
          ),
        ),
      );
    case "placement/remove":
      return mutate(
        state,
        action,
        regressReadyProject(
          removeRecordingFromSites(state, action.recordingId),
        ),
      );
    case "placement/reorder":
      return mutate(
        state,
        action,
        regressReadyProject(
          reorderRecording(
            state,
            action.siteId,
            action.recordingId,
            action.direction,
          ),
        ),
      );
    case "issue/add":
      return mutate(
        state,
        action,
        regressReadyProject({
          ...state,
          issues: [action.issue, ...state.issues],
        }),
      );
    case "issue/transition":
      return mutate(
        state,
        action,
        regressReadyProject({
          ...state,
          issues: state.issues.map((issue) =>
            issue.id === action.issueId
              ? transitionIssue(issue, action.status, action.at)
              : issue,
          ),
        }),
      );
    case "preferences/update":
      return mutate(
        state,
        action,
        regressReadyProject({ ...state, preferences: action.preferences }),
      );
    case "project/readiness": {
      const disposition = commandDisposition(state, action);
      if (disposition === "duplicate") return state;
      if (disposition === "conflict") return rejectCommand(state, action);
      // The record the new check supersedes moves from "current" into the
      // local release lineage, keeping published versions resolvable.
      const releaseLineage = [
        ...state.releaseLineage,
        ...(state.release ? [state.release] : []),
      ];
      const staged = applyReadinessStage(
        state,
        action.release.readiness.ready,
      );
      return finalizeAction(
        {
          ...staged,
          project: {
            ...staged.project,
            lastReadinessCheck: action.release.readiness.checkedAt,
          },
          release: action.release,
          releaseLineage,
        },
        action,
        state.revision,
      );
    }
    case "import/create": {
      const batch = action.batch;
      if (state.importBatches.some((item) => item.id === batch.id))
        return state;
      const unknownIds = batch.recordingIds.filter(
        (id) => !state.recordings.some((recording) => recording.id === id),
      );
      if (unknownIds.length)
        throw new Error("An import batch cannot reference unknown clips.");
      const recordings = state.recordings.map((recording) =>
        batch.recordingIds.includes(recording.id)
          ? { ...recording, importBatchId: batch.id }
          : recording,
      );
      // Intake metadata is custodial; it does not invalidate a frozen release.
      return mutate(
        state,
        action,
        {
          ...state,
          importBatches: [...state.importBatches, batch],
          recordings,
        },
        { invalidate: false },
      );
    }
    case "import/complete":
      return mutate(
        state,
        action,
        completeImportBatch(state, action.batchId),
        { invalidate: false },
      );
    case "retention/policy":
      return mutate(state, action, {
        ...state,
        retentionPolicies: action.policy,
      }, { invalidate: false });
    case "retention/archive":
      return applyRetentionCommand(state, action, "archive");
    case "retention/restore":
      return applyRetentionCommand(state, action, "restore");
    case "retention/requalify":
      return applyRetentionCommand(state, action, "requalify");
    case "workspace/reset":
      return action.state;
    case "workspace/sync":
      return action.state;
    default:
      return state;
  }
}
