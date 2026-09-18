import { analyzeRoute, getUnplacedRecordings } from "../domain/routeAnalysis";
import { issueProgress } from "../domain/releaseRules";
import {
  classifyRetention,
  pendingRequalification,
  resolveRecording,
  resolveSite,
  scanReferences,
} from "../domain/retention";
import type {
  ArchiveEntry,
  Recording,
  QualityIssue,
  RetentionItem,
  StudyState,
  Site,
} from "../domain/models";

export function selectRecordingById(
  state: StudyState,
  id: string,
): Recording | undefined {
  return state.recordings.find((recording) => recording.id === id);
}

export function selectSiteById(
  state: StudyState,
  id: string,
): Site | undefined {
  return state.sites.find((site) => site.id === id);
}

export function selectRecordingSite(
  state: StudyState,
  recordingId: string,
): Site | undefined {
  return state.sites.find((site) => site.recordingIds.includes(recordingId));
}

/** Resolve a clip through active material or the archive (never dangling). */
export function selectResolvedRecording(
  state: StudyState,
  id: string,
) {
  return resolveRecording(state, id);
}

export function selectRecordingsForSite(
  state: StudyState,
  siteId: string,
): Array<Recording & { archived?: boolean }> {
  const site = selectSiteById(state, siteId);
  if (!site) return [];
  return site.recordingIds
    .map((id) => {
      const resolved = resolveRecording(state, id);
      if (!resolved) return null;
      return resolved.archived
        ? { ...resolved.recording, archived: true as const }
        : resolved.recording;
    })
    .filter((recording): recording is Recording & { archived?: boolean } =>
      Boolean(recording),
    );
}

export function selectIssuesForSite(
  state: StudyState,
  siteId: string,
): QualityIssue[] {
  return state.issues.filter((issue) => issue.siteId === siteId);
}

export function selectWorkspaceSummary(state: StudyState) {
  const analysis = analyzeRoute(state.recordings, state.sites);
  return {
    analysis,
    unplacedRecordings: getUnplacedRecordings(state.recordings, state.sites),
    issueProgress: issueProgress(state.issues),
    openIssues: state.issues.filter((issue) => issue.status !== "resolved"),
    criticalIssues: state.issues.filter(
      (issue) => issue.severity === "critical" && issue.status !== "resolved",
    ),
  };
}

export interface RetentionOverview {
  items: RetentionItem[];
  archive: ArchiveEntry[];
  referenceIssues: ReturnType<typeof scanReferences>;
  counts: { active: number; expired: number; archived: number };
  pendingRestore: {
    recordings: Recording[];
    sites: Site[];
    batches: StudyState["importBatches"];
  };
}

export function selectRetentionOverview(
  state: StudyState,
  at = new Date(),
): RetentionOverview {
  const items = classifyRetention(state, at);
  const counts = {
    active: items.filter((item) => item.status === "active").length,
    expired: items.filter((item) => item.status === "expired").length,
    archived: state.archive.length,
  };
  return {
    items,
    archive: state.archive,
    referenceIssues: scanReferences(state),
    counts,
    pendingRestore: pendingRequalification(state),
  };
}

export { resolveSite };
