import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  recordingFromDraft,
  validateRecordingDraft,
} from "../domain/recordingValidation";
import { createId } from "../domain/ids";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
  isReleaseCurrent,
} from "../domain/releaseRules";
import {
  retentionOverview,
  type RetentionOverview,
} from "../domain/retention";
import type {
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RetentionCategory,
  RetentionPolicy,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
} from "../domain/models";
import { workspaceReducer } from "./reducer";
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

export interface ImportBatchDraft {
  label: string;
  source: string;
  note: string;
  recordingIds: string[];
}

interface StudyContextValue {
  state: StudyState;
  storageHealthy: boolean;
  retention: RetentionOverview;
  upsertRecording: (
    draft: RecordingDraft,
    existing?: Recording,
  ) => CommandResult<Recording>;
  removeRecording: (recordingId: string) => CommandResult;
  assignRecording: (recordingId: string, siteId: string) => CommandResult;
  removePlacement: (recordingId: string) => void;
  reorderRecording: (
    siteId: string,
    recordingId: string,
    direction: -1 | 1,
  ) => CommandResult;
  addIssue: (draft: IssueDraft) => CommandResult;
  transitionQualityIssue: (
    issueId: string,
    status: IssueStatus,
  ) => CommandResult;
  updatePreferences: (preferences: RoutePreferences) => void;
  checkReadiness: () => ReleaseResult;
  createSnapshot: () => CommandResult<Snapshot>;
  createImportBatch: (draft: ImportBatchDraft) => CommandResult;
  completeImportBatch: (batchId: string) => CommandResult;
  updateRetentionPolicy: (policy: RetentionPolicy) => CommandResult;
  archiveMaterial: (category: RetentionCategory, id: string) => CommandResult;
  restoreMaterial: (category: RetentionCategory, id: string) => CommandResult;
  requalifyMaterial: (
    category: RetentionCategory,
    id: string,
  ) => CommandResult;
  resetStudy: () => void;
}

const StudyContext = createContext<StudyContextValue | null>(null);

export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    loadStudy(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const originId = useRef(createId("tab")).current;
  const [storageHealthy, setStorageHealthy] = useState(true);

  useEffect(() => {
    setStorageHealthy(saveStudy(state));
  }, [state]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const incoming = loadStudy();
      const current = stateRef.current;
      if (
        incoming.revision < current.revision ||
        (incoming.revision === current.revision &&
          incoming.updatedAt === current.updatedAt)
      )
        return;
      dispatch({ type: "workspace/sync", state: incoming });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const withCommandMeta = useCallback(
    (action: StudyAction): StudyAction => {
      const meta: CommandMeta = {
        commandId: createId("command"),
        expectedRevision: state.revision,
        originId,
        issuedAt: new Date().toISOString(),
      };
      return { ...action, meta };
    },
    [originId, state.revision],
  );

  const runGuarded = useCallback(
    (build: () => StudyAction): CommandResult => {
      try {
        dispatch(withCommandMeta(build()));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "Action could not complete.",
        };
      }
    },
    [withCommandMeta],
  );

  const upsertRecording = useCallback(
    (draft: RecordingDraft, existing?: Recording): CommandResult<Recording> => {
      const validation = validateRecordingDraft(
        draft,
        state.recordings,
        existing?.id,
      );
      if (validation.length) {
        return {
          ok: false,
          errors: Object.fromEntries(
            validation.map((error) => [error.field, error.message]),
          ),
          message: "Review the highlighted fields before saving.",
        };
      }
      const recording = recordingFromDraft(draft, existing);
      dispatch(withCommandMeta({ type: "recording/upsert", recording }));
      return { ok: true, value: recording };
    },
    [state.recordings, withCommandMeta],
  );

  const removeRecording = useCallback(
    (recordingId: string): CommandResult => {
      const recording = state.recordings.find(
        (candidate) => candidate.id === recordingId,
      );
      if (!recording)
        return { ok: false, message: "The selected clip no longer exists." };
      dispatch(withCommandMeta({ type: "recording/remove", recordingId }));
      return { ok: true };
    },
    [state.recordings, withCommandMeta],
  );

  const assignRecording = useCallback(
    (recordingId: string, siteId: string): CommandResult => {
      try {
        dispatch(
          withCommandMeta({ type: "placement/assign", recordingId, siteId }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Placement could not be updated.",
        };
      }
    },
    [withCommandMeta],
  );

  const removePlacement = useCallback((recordingId: string) => {
    dispatch(withCommandMeta({ type: "placement/remove", recordingId }));
  }, [withCommandMeta]);

  const reorderRecording = useCallback(
    (siteId: string, recordingId: string, direction: -1 | 1): CommandResult => {
      try {
        dispatch(
          withCommandMeta({
            type: "placement/reorder",
            siteId,
            recordingId,
            direction,
          }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Clip sequence could not be changed.",
        };
      }
    },
    [withCommandMeta],
  );

  const addIssue = useCallback((draft: IssueDraft): CommandResult => {
    if (!draft.title.trim())
      return { ok: false, errors: { title: "A finding title is required." } };
    if (draft.description.trim().length < 16)
      return {
        ok: false,
        errors: { description: "Add at least 16 characters of context." },
      };
    if (!draft.owner.trim())
      return { ok: false, errors: { owner: "Assign an owner." } };
    const now = new Date().toISOString();
    dispatch(
      withCommandMeta({
        type: "issue/add",
        issue: {
          id: createId("issue"),
          title: draft.title.trim(),
          description: draft.description.trim(),
          severity: draft.severity,
          status: "open",
          owner: draft.owner.trim(),
          siteId: draft.siteId || undefined,
          recordingId: draft.recordingId || undefined,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    return { ok: true };
  }, [withCommandMeta]);

  const transitionQualityIssue = useCallback(
    (issueId: string, status: IssueStatus): CommandResult => {
      const issue = state.issues.find((candidate) => candidate.id === issueId);
      if (!issue)
        return {
          ok: false,
          message: "The selected review finding no longer exists.",
        };
      try {
        dispatch(
          withCommandMeta({ type: "issue/transition", issueId, status }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Status could not be changed.",
        };
      }
    },
    [state.issues, withCommandMeta],
  );

  const updatePreferences = useCallback((preferences: RoutePreferences) => {
    dispatch(withCommandMeta({ type: "preferences/update", preferences }));
  }, [withCommandMeta]);

  const checkReadiness = useCallback(() => {
    const analysis = analyzeRoute(state.recordings, state.sites);
    const result = evaluateRelease(state, analysis);
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(state, analysis, result),
      }),
    );
    return result;
  }, [state, withCommandMeta]);

  const createSnapshot = useCallback((): CommandResult<Snapshot> => {
    if (!isReleaseCurrent(state, state.release))
      return {
        ok: false,
        message:
          state.release?.readiness.blockers[0] ??
          "Run a current readiness check before exporting.",
      };
    return {
      ok: true,
      value: state.release.snapshot,
    };
  }, [state]);

  const createImportBatch = useCallback(
    (draft: ImportBatchDraft): CommandResult => {
      if (!draft.label.trim())
        return { ok: false, errors: { label: "A batch label is required." } };
      if (!draft.recordingIds.length)
        return {
          ok: false,
          message: "Select at least one clip for the import batch.",
        };
      const now = new Date().toISOString();
      return runGuarded(() => ({
        type: "import/create",
        batch: {
          id: createId("import"),
          label: draft.label.trim(),
          source: draft.source.trim(),
          note: draft.note.trim(),
          status: "open",
          recordingIds: draft.recordingIds,
          createdAt: now,
        },
      }));
    },
    [runGuarded],
  );

  const completeImportBatch = useCallback(
    (batchId: string) =>
      runGuarded(() => ({ type: "import/complete", batchId })),
    [runGuarded],
  );

  const updateRetentionPolicy = useCallback(
    (policy: RetentionPolicy): CommandResult =>
      runGuarded(() => ({ type: "retention/policy", policy })),
    [runGuarded],
  );

  const archiveMaterial = useCallback(
    (category: RetentionCategory, id: string) =>
      runGuarded(() => ({ type: "retention/archive", category, id })),
    [runGuarded],
  );

  const restoreMaterial = useCallback(
    (category: RetentionCategory, id: string) =>
      runGuarded(() => ({ type: "retention/restore", category, id })),
    [runGuarded],
  );

  const requalifyMaterial = useCallback(
    (category: RetentionCategory, id: string) =>
      runGuarded(() => ({ type: "retention/requalify", category, id })),
    [runGuarded],
  );

  const resetStudy = useCallback(
    () =>
      dispatch(
        withCommandMeta({
          type: "workspace/reset",
          state: createSeedStudy(),
        }),
      ),
    [withCommandMeta],
  );

  const retention = useMemo(() => retentionOverview(state), [state]);

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      storageHealthy,
      retention,
      upsertRecording,
      removeRecording,
      assignRecording,
      removePlacement,
      reorderRecording,
      addIssue,
      transitionQualityIssue,
      updatePreferences,
      checkReadiness,
      createSnapshot,
      createImportBatch,
      completeImportBatch,
      updateRetentionPolicy,
      archiveMaterial,
      restoreMaterial,
      requalifyMaterial,
      resetStudy,
    }),
    [
      state,
      storageHealthy,
      retention,
      upsertRecording,
      removeRecording,
      assignRecording,
      removePlacement,
      reorderRecording,
      addIssue,
      transitionQualityIssue,
      updatePreferences,
      checkReadiness,
      createSnapshot,
      createImportBatch,
      completeImportBatch,
      updateRetentionPolicy,
      archiveMaterial,
      restoreMaterial,
      requalifyMaterial,
      resetStudy,
    ],
  );

  return (
    <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
  );
}

export function useStudy(): StudyContextValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error("useStudy must be used inside StudyProvider.");
  return value;
}
