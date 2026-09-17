import type {
  Recording,
  IssueStatus,
  ReleaseRecord,
  RetentionCategory,
  RetentionPolicy,
  RoutePreferences,
  QualityIssue,
  ImportBatch,
  StudyState,
} from "../domain/models";

export interface CommandMeta {
  commandId: string;
  expectedRevision: number;
  originId: string;
  issuedAt: string;
}

type StudyActionPayload =
  | { type: "recording/upsert"; recording: Recording }
  | { type: "recording/remove"; recordingId: string }
  | {
      type: "placement/assign";
      recordingId: string;
      siteId: string;
      index?: number;
    }
  | { type: "placement/remove"; recordingId: string }
  | {
      type: "placement/reorder";
      siteId: string;
      recordingId: string;
      direction: -1 | 1;
    }
  | { type: "issue/add"; issue: QualityIssue }
  | {
      type: "issue/transition";
      issueId: string;
      status: IssueStatus;
      at?: Date;
    }
  | { type: "preferences/update"; preferences: RoutePreferences }
  | { type: "project/readiness"; release: ReleaseRecord }
  | { type: "import/create"; batch: ImportBatch }
  | { type: "import/complete"; batchId: string }
  | { type: "retention/policy"; policy: RetentionPolicy }
  | {
      type: "retention/archive";
      category: RetentionCategory;
      id: string;
    }
  | {
      type: "retention/restore";
      category: RetentionCategory;
      id: string;
    }
  | {
      type: "retention/requalify";
      category: RetentionCategory;
      id: string;
    }
  | { type: "workspace/reset"; state: StudyState }
  | { type: "workspace/sync"; state: StudyState };

export type StudyAction = StudyActionPayload & { meta?: CommandMeta };
