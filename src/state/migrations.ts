import type {
  AudioSpec,
  ArchivedImportBatch,
  ArchivedRecording,
  ArchivedRelease,
  ArchivedSite,
  CommandLogEntry,
  ImportBatch,
  QualityIssue,
  Recording,
  ReleaseRecord,
  ReleaseResult,
  RetentionPolicy,
  RoutePreferences,
  Site,
  Snapshot,
  StudyState,
  TombstoneIndex,
} from "../domain/models";
import { releaseFingerprint } from "../domain/releaseIdentity";
import { DEFAULT_RETENTION_POLICY, emptyTombstones } from "../domain/retention";

const PROJECT_STAGES = new Set(["draft", "review", "ready"]);
const SIGNAL_ROLES = new Set(["arrival", "texture", "voice", "departure"]);
const SENSITIVITIES = new Set(["public", "restricted", "sensitive"]);
const TRANSCRIPT_STATUSES = new Set(["missing", "draft", "verified"]);
const CONSENT_STATUSES = new Set(["pending", "confirmed", "restricted"]);
const ISSUE_SEVERITIES = new Set(["note", "warning", "critical"]);
const ISSUE_STATUSES = new Set(["open", "in-progress", "resolved"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isAudioSpec(value: unknown): value is AudioSpec {
  if (!isRecord(value)) return false;
  return (
    isPositiveNumber(value.sampleRate) &&
    (value.channels === 1 || value.channels === 2) &&
    (value.bitDepth === 16 ||
      value.bitDepth === 24 ||
      value.bitDepth === 32) &&
    isPositiveNumber(value.durationSeconds)
  );
}

function isRecording(value: unknown): value is Recording {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.catalogId) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.recordedOn) &&
    isNonEmptyString(value.format) &&
    isNonEmptyString(value.location) &&
    isNonEmptyString(value.summary) &&
    isAudioSpec(value.audioSpec) &&
    typeof value.signalRole === "string" &&
    SIGNAL_ROLES.has(value.signalRole) &&
    typeof value.sensitivity === "string" &&
    SENSITIVITIES.has(value.sensitivity) &&
    typeof value.transcriptStatus === "string" &&
    TRANSCRIPT_STATUSES.has(value.transcriptStatus) &&
    typeof value.consentStatus === "string" &&
    CONSENT_STATUSES.has(value.consentStatus) &&
    typeof value.isFeatured === "boolean" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.color === "string" &&
    isOptionalNonEmptyString(value.importBatchId) &&
    isOptionalNonEmptyString(value.archivedAt) &&
    isOptionalNonEmptyString(value.restoredAt) &&
    isOptionalNonEmptyString(value.requalifiedAt) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

function isSite(value: unknown): value is Site {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.shortLabel) &&
    isNonEmptyString(value.prompt) &&
    isPositiveNumber(value.maxDurationSeconds) &&
    Number.isInteger(value.maxClips) &&
    Number(value.maxClips) > 0 &&
    typeof value.quietSpace === "boolean" &&
    typeof value.hasSeating === "boolean" &&
    typeof value.color === "string" &&
    Number.isInteger(value.sequence) &&
    Array.isArray(value.recordingIds) &&
    value.recordingIds.every((id) => typeof id === "string") &&
    isOptionalNonEmptyString(value.updatedAt) &&
    isOptionalNonEmptyString(value.archivedAt) &&
    isOptionalNonEmptyString(value.restoredAt) &&
    isOptionalNonEmptyString(value.requalifiedAt)
  );
}

function isIssue(value: unknown): value is QualityIssue {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.description) &&
    typeof value.severity === "string" &&
    ISSUE_SEVERITIES.has(value.severity) &&
    typeof value.status === "string" &&
    ISSUE_STATUSES.has(value.status) &&
    isNonEmptyString(value.owner) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

function isPreferences(value: unknown): value is RoutePreferences {
  if (!isRecord(value)) return false;
  return (
    (value.pace === "brief" ||
      value.pace === "steady" ||
      value.pace === "deep") &&
    typeof value.accessPriority === "number" &&
    Number.isFinite(value.accessPriority) &&
    typeof value.listenerCount === "number" &&
    Number.isFinite(value.listenerCount)
  );
}

function isProject(value: unknown): value is StudyState["project"] {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.fieldArea) &&
    isNonEmptyString(value.listeningQuestion) &&
    isNonEmptyString(value.publicationDate) &&
    typeof value.stage === "string" &&
    PROJECT_STAGES.has(value.stage)
  );
}

function migrateAuditEntry(value: unknown): CommandLogEntry | null {
  if (!isRecord(value)) return null;
  if (
    isNonEmptyString(value.id) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isNonEmptyString(value.action) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.timestamp) &&
    (value.actor === "local-user" || value.actor === "system")
  ) {
    return {
      id: value.id,
      commandId: isNonEmptyString(value.commandId) ? value.commandId : value.id,
      originId: isNonEmptyString(value.originId) ? value.originId : "legacy",
      revision: Number(value.revision),
      expectedRevision: Number.isInteger(value.expectedRevision)
        ? Number(value.expectedRevision)
        : null,
      status: value.status === "rejected" ? "rejected" : "applied",
      action: value.action,
      summary: value.summary,
      timestamp: value.timestamp,
      actor: value.actor,
    };
  }
  return null;
}

function isReleaseResult(value: unknown): value is ReleaseResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.ready === "boolean" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    Array.isArray(value.blockers) &&
    value.blockers.every((blocker) => typeof blocker === "string") &&
    Array.isArray(value.cautions) &&
    value.cautions.every((caution) => typeof caution === "string") &&
    isNonEmptyString(value.checkedAt)
  );
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== 2 ||
    !isNonEmptyString(value.generatedAt) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isNonEmptyString(value.fingerprint) ||
    !isProject(value.project) ||
    !isPreferences(value.preferences) ||
    !isRecord(value.summary) ||
    !Array.isArray(value.sites) ||
    !Array.isArray(value.unresolvedIssues)
  )
    return false;
  return (
    typeof value.summary.recordingCount === "number" &&
    typeof value.summary.siteCount === "number" &&
    typeof value.summary.routeSeconds === "number" &&
    typeof value.summary.readinessScore === "number"
  );
}

function migrateRelease(value: unknown): ReleaseRecord | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== "ready" &&
    value.status !== "blocked" &&
    value.status !== "stale"
  )
    return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0)
    return null;
  if (typeof value.fingerprint !== "string" || !value.fingerprint) return null;
  if (!isReleaseResult(value.readiness)) return null;
  const releaseId = isNonEmptyString(value.id)
    ? value.id
    : `release-legacy-${Number(value.revision)}`;
  const sequence =
    Number.isInteger(value.sequence) && Number(value.sequence) > 0
      ? Number(value.sequence)
      : 1;
  const snapshot = isSnapshot(value.snapshot)
    ? {
        ...value.snapshot,
        releaseId: isNonEmptyString(value.snapshot.releaseId)
          ? value.snapshot.releaseId
          : releaseId,
        releaseSequence:
          Number.isInteger(value.snapshot.releaseSequence) &&
          Number(value.snapshot.releaseSequence) > 0
            ? Number(value.snapshot.releaseSequence)
            : sequence,
      }
    : value.snapshot === undefined
      ? undefined
      : null;
  if (snapshot === null || (value.status === "ready" && !snapshot)) return null;
  return {
    id: releaseId,
    sequence,
    createdAt: isNonEmptyString(value.createdAt)
      ? value.createdAt
      : value.readiness.checkedAt,
    status: value.status,
    revision: Number(value.revision),
    fingerprint: value.fingerprint,
    supersedes: isNonEmptyString(value.supersedes)
      ? value.supersedes
      : undefined,
    readiness: value.readiness,
    snapshot,
    archivedAt: isNonEmptyString(value.archivedAt)
      ? value.archivedAt
      : undefined,
    restoredAt: isNonEmptyString(value.restoredAt)
      ? value.restoredAt
      : undefined,
    requalifiedAt: isNonEmptyString(value.requalifiedAt)
      ? value.requalifiedAt
      : undefined,
  };
}

function migratedUpdatedAt(state: {
  project: StudyState["project"];
  recordings: Recording[];
  issues: QualityIssue[];
}): string {
  const timestamps = [
    state.project.lastReadinessCheck,
    ...state.recordings.map((recording) => recording.updatedAt),
    ...state.issues.map((issue) => issue.updatedAt),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : "1970-01-01T00:00:00.000Z";
}

function isImportBatch(value: unknown): value is ImportBatch {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    typeof value.source === "string" &&
    typeof value.note === "string" &&
    (value.status === "open" || value.status === "completed") &&
    Array.isArray(value.recordingIds) &&
    value.recordingIds.every((id) => typeof id === "string") &&
    isNonEmptyString(value.createdAt) &&
    isOptionalNonEmptyString(value.completedAt) &&
    isOptionalNonEmptyString(value.archivedAt) &&
    isOptionalNonEmptyString(value.restoredAt) &&
    isOptionalNonEmptyString(value.requalifiedAt)
  );
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function isRetentionPolicy(value: unknown): value is RetentionPolicy {
  if (!isRecord(value)) return false;
  return (
    isPositiveInteger(value.releaseDays) &&
    isPositiveInteger(value.importOpenDays) &&
    isPositiveInteger(value.importCompletedDays) &&
    isPositiveInteger(value.siteDays) &&
    isPositiveInteger(value.restoreGraceDays)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((id) => typeof id === "string")
  );
}

function isArchivedRecording(value: unknown): value is ArchivedRecording {
  if (!isRecord(value)) return false;
  return (
    isRecording(value.recording) &&
    isStringArray(value.siteIds) &&
    isStringArray(value.issueIds) &&
    isNonEmptyString(value.archivedAt)
  );
}

function isArchivedSite(value: unknown): value is ArchivedSite {
  if (!isRecord(value)) return false;
  return (
    isSite(value.site) &&
    isStringArray(value.recordingIds) &&
    isStringArray(value.issueIds) &&
    isNonEmptyString(value.archivedAt)
  );
}

function isArchivedImportBatch(value: unknown): value is ArchivedImportBatch {
  if (!isRecord(value)) return false;
  return (
    isImportBatch(value.batch) &&
    isStringArray(value.recordingIds) &&
    isNonEmptyString(value.archivedAt)
  );
}

function isArchivedRelease(value: unknown): value is ArchivedRelease {
  if (!isRecord(value)) return false;
  return (
    migrateRelease(value.release) !== null &&
    isNonEmptyString(value.archivedAt)
  );
}

function isBucket<T>(
  value: unknown,
  validate: (entry: unknown) => entry is T,
): value is Record<string, T> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(validate);
}

function isTombstoneIndex(value: unknown): value is TombstoneIndex {
  if (!isRecord(value)) return false;
  return (
    isBucket(value.recordings, isArchivedRecording) &&
    isBucket(value.sites, isArchivedSite) &&
    isBucket(value.importBatches, isArchivedImportBatch) &&
    isBucket(value.releases, isArchivedRelease)
  );
}

interface LegacyShape {
  project: StudyState["project"];
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  release: ReleaseRecord | null;
}

function migrateLegacy(value: UnknownRecord, fromVersion: 1 | 2): StudyState | null {
  const auditLog =
    fromVersion === 2 && Array.isArray(value.auditLog)
      ? value.auditLog
          .map(migrateAuditEntry)
          .filter((entry): entry is CommandLogEntry => Boolean(entry))
      : [];
  const legacy: LegacyShape = {
    project: value.project as StudyState["project"],
    recordings: value.recordings as Recording[],
    sites: value.sites as Site[],
    issues: value.issues as QualityIssue[],
    preferences: value.preferences as RoutePreferences,
    auditLog,
    release: migrateRelease(value.release ?? null),
  };
  return {
    version: 3,
    revision: fromVersion === 2 ? Number(value.revision) : 0,
    updatedAt:
      fromVersion === 2 && isNonEmptyString(value.updatedAt)
        ? value.updatedAt
        : migratedUpdatedAt(legacy),
    project: legacy.project,
    recordings: legacy.recordings,
    sites: legacy.sites,
    issues: legacy.issues,
    importBatches: [],
    retentionPolicies: DEFAULT_RETENTION_POLICY,
    tombstoneIndex: emptyTombstones(),
    preferences: legacy.preferences,
    auditLog: legacy.auditLog,
    release: legacy.release,
    releaseLineage: [],
    lastSavedAt:
      fromVersion === 2 && isNonEmptyString(value.lastSavedAt)
        ? value.lastSavedAt
        : undefined,
  };
}

export function migrateWorkspace(value: unknown): StudyState | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3)
    return null;
  if (!isProject(value.project)) return null;
  if (!Array.isArray(value.recordings) || !value.recordings.every(isRecording))
    return null;
  if (!Array.isArray(value.sites) || !value.sites.every(isSite)) return null;
  if (!Array.isArray(value.issues) || !value.issues.every(isIssue)) return null;
  if (!isPreferences(value.preferences)) return null;

  if (value.version === 1 || value.version === 2) {
    return migrateLegacy(value, value.version);
  }

  if (!Number.isInteger(value.revision) || Number(value.revision) < 0)
    return null;
  if (!Array.isArray(value.importBatches) || !value.importBatches.every(isImportBatch))
    return null;
  if (!isRetentionPolicy(value.retentionPolicies)) return null;
  if (!isTombstoneIndex(value.tombstoneIndex)) return null;
  if (
    !Array.isArray(value.releaseLineage) ||
    !value.releaseLineage.every((entry) => migrateRelease(entry) !== null)
  )
    return null;
  const auditLog = Array.isArray(value.auditLog)
    ? value.auditLog
        .map(migrateAuditEntry)
        .filter((entry): entry is CommandLogEntry => Boolean(entry))
    : [];
  return {
    version: 3,
    revision: Number(value.revision),
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt
      : new Date().toISOString(),
    project: value.project,
    recordings: value.recordings,
    sites: value.sites,
    issues: value.issues,
    importBatches: value.importBatches,
    retentionPolicies: value.retentionPolicies,
    tombstoneIndex: value.tombstoneIndex,
    releaseLineage: value.releaseLineage
      .map((entry) => migrateRelease(entry))
      .filter((entry): entry is ReleaseRecord => Boolean(entry)),
    preferences: value.preferences,
    auditLog,
    release: migrateRelease(value.release ?? null),
    lastSavedAt: isNonEmptyString(value.lastSavedAt)
      ? value.lastSavedAt
      : undefined,
  };
}

export function validateReferences(state: StudyState): StudyState {
  const archivedRecordingIds = new Set(
    Object.keys(state.tombstoneIndex.recordings),
  );
  const archivedSiteIds = new Set(Object.keys(state.tombstoneIndex.sites));
  const liveRecordingIds = new Set(
    state.recordings.map((recording) => recording.id),
  );
  const liveSiteIds = new Set(state.sites.map((site) => site.id));

  // References may point at live records or cleaned (archived) records; both
  // still resolve. Only truly unknown targets are repaired.
  const resolvableRecordingIds = new Set([
    ...liveRecordingIds,
    ...archivedRecordingIds,
  ]);
  const resolvableSiteIds = new Set([...liveSiteIds, ...archivedSiteIds]);

  const placedRecordingIds = new Set<string>();
  const sites = state.sites.map((site) => {
    const recordingIds = site.recordingIds.filter((id) => {
      if (!resolvableRecordingIds.has(id) || placedRecordingIds.has(id))
        return false;
      placedRecordingIds.add(id);
      return true;
    });
    return recordingIds.length === site.recordingIds.length
      ? site
      : { ...site, recordingIds };
  });
  const issues = state.issues.map((issue) => ({
    ...issue,
    siteId:
      issue.siteId && resolvableSiteIds.has(issue.siteId)
        ? issue.siteId
        : undefined,
    recordingId:
      issue.recordingId && resolvableRecordingIds.has(issue.recordingId)
        ? issue.recordingId
        : undefined,
  }));
  const normalized = { ...state, sites, issues };
  if (
    normalized.release?.status === "ready" &&
    normalized.release.fingerprint !== releaseFingerprint(normalized)
  ) {
    return {
      ...normalized,
      release: { ...normalized.release, status: "stale" },
    };
  }
  return normalized;
}
