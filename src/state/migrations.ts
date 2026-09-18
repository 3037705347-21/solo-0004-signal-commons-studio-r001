import type {
  ArchiveEntry,
  AudioSpec,
  CommandLogEntry,
  ImportBatch,
  QualityIssue,
  Recording,
  ReleaseRecord,
  ReleaseResult,
  RetentionKind,
  RoutePreferences,
  Site,
  Snapshot,
  StudyState,
} from "../domain/models";
import { releaseFingerprint } from "../domain/releaseIdentity";

const PROJECT_STAGES = new Set(["draft", "review", "ready"]);
const SIGNAL_ROLES = new Set(["arrival", "texture", "voice", "departure"]);
const SENSITIVITIES = new Set(["public", "restricted", "sensitive"]);
const TRANSCRIPT_STATUSES = new Set(["missing", "draft", "verified"]);
const CONSENT_STATUSES = new Set(["pending", "confirmed", "restricted"]);
const ISSUE_SEVERITIES = new Set(["note", "warning", "critical"]);
const ISSUE_STATUSES = new Set(["open", "in-progress", "resolved"]);
const RETENTION_KINDS = new Set<RetentionKind>(["release", "import", "site"]);

const LEGACY_IMPORT_BATCH_ID = "batch-legacy-import";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
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

/**
 * Recordings carry an import batch from schema v3 onward. Legacy records are
 * accepted without it and assigned a synthetic completed import during
 * migration so every clip keeps a resolvable provenance link.
 */
function migrateRecording(value: unknown): Recording | null {
  if (!isRecord(value)) return null;
  if (
    !(
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
      isNonEmptyString(value.createdAt) &&
      isNonEmptyString(value.updatedAt)
    )
  )
    return null;
  return {
    id: value.id,
    catalogId: value.catalogId,
    title: value.title,
    source: value.source,
    recordedOn: value.recordedOn,
    format: value.format,
    location: value.location,
    summary: value.summary,
    audioSpec: value.audioSpec as AudioSpec,
    signalRole: value.signalRole as Recording["signalRole"],
    sensitivity: value.sensitivity as Recording["sensitivity"],
    transcriptStatus: value.transcriptStatus as Recording["transcriptStatus"],
    consentStatus: value.consentStatus as Recording["consentStatus"],
    isFeatured: value.isFeatured,
    tags: value.tags,
    color: value.color,
    importBatchId: isNonEmptyString(value.importBatchId)
      ? value.importBatchId
      : LEGACY_IMPORT_BATCH_ID,
    restoredAt: isOptionalTimestamp(value.restoredAt)
      ? value.restoredAt
      : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function migrateSite(value: unknown): Site | null {
  if (!isRecord(value)) return null;
  if (
    !(
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
      value.recordingIds.every((id) => typeof id === "string")
    )
  )
    return null;
  const fallbackTimestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: value.id,
    name: value.name,
    shortLabel: value.shortLabel,
    prompt: value.prompt,
    maxDurationSeconds: value.maxDurationSeconds as number,
    maxClips: value.maxClips as number,
    quietSpace: value.quietSpace,
    hasSeating: value.hasSeating,
    color: value.color,
    sequence: value.sequence as number,
    recordingIds: value.recordingIds,
    createdAt: isNonEmptyString(value.createdAt)
      ? value.createdAt
      : fallbackTimestamp,
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt
      : fallbackTimestamp,
    restoredAt: isOptionalTimestamp(value.restoredAt)
      ? value.restoredAt
      : undefined,
  };
}

function migrateIssue(value: unknown): QualityIssue | null {
  if (!isRecord(value)) return null;
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
  )
    ? ({
        id: value.id,
        title: value.title,
        description: value.description,
        severity: value.severity,
        status: value.status,
        siteId: isNonEmptyString(value.siteId) ? value.siteId : undefined,
        recordingId: isNonEmptyString(value.recordingId)
          ? value.recordingId
          : undefined,
        owner: value.owner,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        resolvedAt: isNonEmptyString(value.resolvedAt)
          ? value.resolvedAt
          : undefined,
      } as QualityIssue)
    : null;
}

function migrateImportBatch(value: unknown): ImportBatch | null {
  if (!isRecord(value)) return null;
  if (
    !(
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.label) &&
      (value.status === "open" || value.status === "completed") &&
      isNonEmptyString(value.createdAt) &&
      isNonEmptyString(value.updatedAt)
    )
  )
    return null;
  return {
    id: value.id,
    label: value.label,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: isNonEmptyString(value.completedAt)
      ? value.completedAt
      : undefined,
    restoredAt: isOptionalTimestamp(value.restoredAt)
      ? value.restoredAt
      : undefined,
  };
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
  };
}

function migrateArchiveEntry(value: unknown): ArchiveEntry | null {
  if (!isRecord(value)) return null;
  if (
    !(
      isNonEmptyString(value.id) &&
      typeof value.kind === "string" &&
      RETENTION_KINDS.has(value.kind as RetentionKind) &&
      isNonEmptyString(value.archivedAt)
    )
  )
    return null;
  const kind = value.kind as RetentionKind;
  const release =
    value.release !== undefined && value.release !== null
      ? migrateRelease(value.release)
      : undefined;
  const importBatch =
    value.importBatch !== undefined && value.importBatch !== null
      ? migrateImportBatch(value.importBatch)
      : undefined;
  const site =
    value.site !== undefined && value.site !== null
      ? migrateSite(value.site)
      : undefined;
  const recordings = Array.isArray(value.recordings)
    ? value.recordings
        .map(migrateRecording)
        .filter((item): item is Recording => Boolean(item))
    : [];
  if (kind === "release" && !release) return null;
  if (kind === "import" && !importBatch) return null;
  if (kind === "site" && !site) return null;
  const base = {
    id: value.id,
    archivedAt: value.archivedAt,
    reason: typeof value.reason === "string" ? value.reason : "Archived",
    retentionLabel: isNonEmptyString(value.retentionLabel)
      ? value.retentionLabel
      : "Retained material",
    recordings,
  };
  if (kind === "release") return { ...base, kind, release: release as ReleaseRecord };
  if (kind === "import")
    return { ...base, kind, importBatch: importBatch as ImportBatch };
  return { ...base, kind, site: site as Site };
}

function migratedUpdatedAt(state: StudyState): string {
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

/** Build the synthetic provenance batch used for pre-v3 recordings. */
function legacyImportBatch(recordings: Recording[]): ImportBatch {
  const stamps = recordings.map((recording) => Date.parse(recording.updatedAt));
  const anchor = new Date(
    stamps.length ? Math.max(...stamps.filter(Number.isFinite)) : Date.now(),
  ).toISOString();
  return {
    id: LEGACY_IMPORT_BATCH_ID,
    label: "Legacy library import",
    status: "completed",
    createdAt: anchor,
    updatedAt: anchor,
    completedAt: anchor,
  };
}

function withV3Defaults(value: UnknownRecord): StudyState | null {
  const rawRecordings = Array.isArray(value.recordings)
    ? value.recordings
    : [];
  const recordings = rawRecordings
    .map(migrateRecording)
    .filter((item): item is Recording => Boolean(item));
  if (recordings.length !== rawRecordings.length) return null;

  const rawSites = Array.isArray(value.sites) ? value.sites : [];
  const sites = rawSites
    .map(migrateSite)
    .filter((item): item is Site => Boolean(item));
  if (sites.length !== rawSites.length) return null;

  const rawIssues = Array.isArray(value.issues) ? value.issues : [];
  const issues = rawIssues
    .map(migrateIssue)
    .filter((item): item is QualityIssue => Boolean(item));
  if (issues.length !== rawIssues.length) return null;

  const explicitBatches = Array.isArray(value.importBatches)
    ? value.importBatches
        .map(migrateImportBatch)
        .filter((item): item is ImportBatch => Boolean(item))
    : null;

  const knownBatchIds = new Set(
    (explicitBatches ?? []).map((batch) => batch.id),
  );
  const needsLegacyBatch = recordings.some(
    (recording) => recording.importBatchId === LEGACY_IMPORT_BATCH_ID,
  );
  const danglingBatches = recordings.filter(
    (recording) =>
      recording.importBatchId !== LEGACY_IMPORT_BATCH_ID &&
      !knownBatchIds.has(recording.importBatchId),
  );
  const importBatches: ImportBatch[] = [
    ...(explicitBatches ?? []),
    ...(needsLegacyBatch ? [legacyImportBatch(recordings)] : []),
    ...danglingBatches.map((recording) => ({
      id: recording.importBatchId,
      label: "Recovered import",
      status: "open" as const,
      createdAt: recording.createdAt,
      updatedAt: recording.updatedAt,
    })),
  ];

  const releaseHistory = Array.isArray(value.releaseHistory)
    ? value.releaseHistory
        .map(migrateRelease)
        .filter((item): item is ReleaseRecord => Boolean(item))
    : [];
  const archive: ArchiveEntry[] = Array.isArray(value.archive)
    ? value.archive
        .map(migrateArchiveEntry)
        .filter((item): item is ArchiveEntry => Boolean(item))
    : [];

  return {
    version: 3,
    revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt
      : new Date().toISOString(),
    project: value.project as StudyState["project"],
    recordings,
    importBatches,
    sites,
    issues,
    preferences: value.preferences as RoutePreferences,
    auditLog: Array.isArray(value.auditLog)
      ? value.auditLog
          .map(migrateAuditEntry)
          .filter((entry): entry is CommandLogEntry => Boolean(entry))
      : [],
    release: value.release === null ? null : migrateRelease(value.release),
    releaseHistory,
    archive,
    lastSavedAt: isNonEmptyString(value.lastSavedAt)
      ? value.lastSavedAt
      : undefined,
  };
}

export function migrateWorkspace(value: unknown): StudyState | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3)
    return null;
  if (!isProject(value.project)) return null;
  if (!isPreferences(value.preferences)) return null;

  const migrated = withV3Defaults(value);
  if (!migrated) return null;

  if (value.version === 1) {
    return {
      ...migrated,
      revision: 0,
      updatedAt: migratedUpdatedAt(migrated),
      auditLog: [],
      release: null,
      releaseHistory: [],
      archive: [],
    };
  }

  if (value.version === 2) {
    return {
      ...migrated,
      releaseHistory: migrated.releaseHistory,
      archive: migrated.archive,
    };
  }

  if (!Number.isInteger(value.revision) || Number(value.revision) < 0)
    return null;
  return migrated;
}

export function validateReferences(state: StudyState): StudyState {
  // Route and finding references are intentionally preserved when they point
  // into the archive: archived material is a resolvable tombstone. Only
  // references to ids that exist nowhere (active or archive) are pruned.
  const activeRecordingIds = new Set(
    state.recordings.map((recording) => recording.id),
  );
  const archivedRecordingIds = new Set(
    state.archive.flatMap((entry) =>
      entry.recordings.map((recording) => recording.id),
    ),
  );
  const activeSiteIds = new Set(state.sites.map((site) => site.id));
  const archivedSiteIds = new Set(
    state.archive
      .filter((entry) => entry.site)
      .map((entry) => entry.site?.id as string),
  );
  const knownRecordingIds = new Set([
    ...activeRecordingIds,
    ...archivedRecordingIds,
  ]);
  const knownSiteIds = new Set([...activeSiteIds, ...archivedSiteIds]);
  const seenPlacements = new Set<string>();

  const sites = state.sites.map((site) => ({
    ...site,
    recordingIds: site.recordingIds.filter((id) => {
      if (!knownRecordingIds.has(id) || seenPlacements.has(id)) return false;
      seenPlacements.add(id);
      return true;
    }),
  }));
  const issues = state.issues.map((issue) => ({
    ...issue,
    siteId: issue.siteId && knownSiteIds.has(issue.siteId) ? issue.siteId : undefined,
    recordingId:
      issue.recordingId && knownRecordingIds.has(issue.recordingId)
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
