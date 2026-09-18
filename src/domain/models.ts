export type ProjectStage = "draft" | "review" | "ready";
export type SignalRole = "arrival" | "texture" | "voice" | "departure";
export type Sensitivity = "public" | "restricted" | "sensitive";
export type TranscriptStatus = "missing" | "draft" | "verified";
export type ConsentStatus = "pending" | "confirmed" | "restricted";
export type IssueSeverity = "note" | "warning" | "critical";
export type IssueStatus = "open" | "in-progress" | "resolved";

export type ImportBatchStatus = "open" | "completed";
/** Lifecycle state assigned by the executable retention policy. */
export type RetentionStatus = "active" | "expired" | "archived";
/** Business categories covered by the retention policy. */
export type RetentionKind = "release" | "import" | "site";

export interface AudioSpec {
  sampleRate: number;
  channels: 1 | 2;
  bitDepth: 16 | 24 | 32;
  durationSeconds: number;
}

export interface Recording {
  id: string;
  catalogId: string;
  title: string;
  source: string;
  recordedOn: string;
  format: string;
  location: string;
  summary: string;
  audioSpec: AudioSpec;
  signalRole: SignalRole;
  sensitivity: Sensitivity;
  transcriptStatus: TranscriptStatus;
  consentStatus: ConsentStatus;
  isFeatured: boolean;
  tags: string[];
  color: string;
  /** Import batch that brought this clip into the study. */
  importBatchId: string;
  /** Set after recovery from the archive until the next passing release check. */
  restoredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  label: string;
  status: ImportBatchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Set after recovery from the archive until the next passing release check. */
  restoredAt?: string;
}

export interface Site {
  id: string;
  name: string;
  shortLabel: string;
  prompt: string;
  maxDurationSeconds: number;
  maxClips: number;
  quietSpace: boolean;
  hasSeating: boolean;
  color: string;
  sequence: number;
  recordingIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Set after recovery from the archive until the next passing release check. */
  restoredAt?: string;
}

export interface QualityIssue {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  siteId?: string;
  recordingId?: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface RoutePreferences {
  pace: "brief" | "steady" | "deep";
  accessPriority: number;
  listenerCount: number;
}

export interface FieldStudy {
  id: string;
  title: string;
  fieldArea: string;
  listeningQuestion: string;
  publicationDate: string;
  stage: ProjectStage;
  lastReadinessCheck?: string;
}

export interface CommandLogEntry {
  id: string;
  commandId: string;
  originId: string;
  revision: number;
  expectedRevision: number | null;
  status: "applied" | "rejected";
  action: string;
  summary: string;
  timestamp: string;
  actor: "local-user" | "system";
}

export interface StudyState {
  version: 3;
  revision: number;
  updatedAt: string;
  project: FieldStudy;
  recordings: Recording[];
  importBatches: ImportBatch[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  /** Most recent release record; superseded releases move to releaseHistory. */
  release: ReleaseRecord | null;
  releaseHistory: ReleaseRecord[];
  /** Soft-deleted material retained so published versions and references keep resolving. */
  archive: ArchiveEntry[];
  lastSavedAt?: string;
}

export interface RecordingDraft {
  catalogId: string;
  title: string;
  source: string;
  recordedOn: string;
  format: string;
  location: string;
  summary: string;
  sampleRate: string;
  channels: string;
  bitDepth: string;
  durationSeconds: string;
  signalRole: SignalRole;
  sensitivity: Sensitivity;
  transcriptStatus: TranscriptStatus;
  consentStatus: ConsentStatus;
  isFeatured: boolean;
  tags: string;
  color: string;
}

export interface IssueDraft {
  title: string;
  description: string;
  severity: IssueSeverity;
  owner: string;
  siteId: string;
  recordingId: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ConstraintFinding {
  id: string;
  type: "error" | "warning" | "notice";
  title: string;
  detail: string;
  siteId?: string;
  recordingId?: string;
}

export interface SiteAnalysis {
  siteId: string;
  durationSeconds: number;
  utilization: number;
  clipCount: number;
  clipUtilization: number;
  roleCoverage: SignalRole[];
  findings: ConstraintFinding[];
}

export interface RouteAnalysis {
  totalDurationSeconds: number;
  placedCount: number;
  unplacedCount: number;
  featuredCoverage: number;
  roleCoverage: number;
  sites: SiteAnalysis[];
  findings: ConstraintFinding[];
  blockingCount: number;
  warningCount: number;
}

export interface ReleaseResult {
  ready: boolean;
  score: number;
  blockers: string[];
  cautions: string[];
  checkedAt: string;
}

export interface ListenerScenarioInput {
  pace: RoutePreferences["pace"];
  accessPriority: number;
  listenerCount: number;
}

export interface ListenerProjection {
  durationSeconds: number;
  comfortScore: number;
  accessScore: number;
  continuityScore: number;
  pressureSiteIds: string[];
  recommendations: string[];
}

export interface ReleaseRecord {
  id: string;
  sequence: number;
  createdAt: string;
  status: "ready" | "blocked" | "stale";
  revision: number;
  fingerprint: string;
  supersedes?: string;
  readiness: ReleaseResult;
  snapshot?: Snapshot;
}

export interface Snapshot {
  schemaVersion: 2;
  generatedAt: string;
  releaseId: string;
  releaseSequence: number;
  revision: number;
  fingerprint: string;
  project: FieldStudy;
  preferences: RoutePreferences;
  summary: {
    recordingCount: number;
    siteCount: number;
    routeSeconds: number;
    readinessScore: number;
  };
  sites: Array<Site & { recordings: Recording[] }>;
  unresolvedIssues: QualityIssue[];
}

/** A soft-deleted record retained in the archive so references keep resolving. */
export interface ArchiveEntry {
  id: string;
  kind: RetentionKind;
  archivedAt: string;
  reason: string;
  /** Why the retention policy marked the record expired before archival. */
  retentionLabel: string;
  release?: ReleaseRecord;
  importBatch?: ImportBatch;
  site?: Site;
  /** Clips swept together with an import batch; resolvable by id. */
  recordings: Recording[];
}

/** A material item classified by the retention policy for display and sweeping. */
export interface RetentionItem {
  kind: RetentionKind;
  id: string;
  label: string;
  status: RetentionStatus;
  categoryLabel: string;
  updatedAt: string;
  expiresAt?: string;
  referenceCount: number;
  detail: string;
}
