import {
  Archive,
  ArchiveRestore,
  Box,
  FileClock,
  History,
  Link2,
  MapPin,
  PackageOpen,
  RotateCcw,
  ShieldQuestion,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { SectionHeader } from "../../components/SectionHeader";
import { formatDate } from "../../domain/formatters";
import type {
  ArchiveEntry,
  RetentionItem,
  RetentionKind,
} from "../../domain/models";
import { RETENTION_RULES } from "../../domain/retention";
import { selectRetentionOverview } from "../../state/selectors";
import { useStudy } from "../../state/StudyContext";

const KIND_ICONS: Record<RetentionKind, typeof FileClock> = {
  release: History,
  import: PackageOpen,
  site: MapPin,
};

const STATUS_TONE: Record<
  RetentionItem["status"],
  "positive" | "warning" | "neutral"
> = {
  active: "positive",
  expired: "warning",
  archived: "neutral",
};

export function RetentionPage() {
  const { state, sweepExpired, archiveRecord, restoreArchived } = useStudy();
  const [toast, setToast] = useState<string | null>(null);
  const overview = useMemo(() => selectRetentionOverview(state), [state]);
  const { items, archive, referenceIssues, counts, pendingRestore } = overview;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const runSweep = () => {
    const count = sweepExpired();
    notify(
      count
        ? `Archived ${count} expired record${count === 1 ? "" : "s"}. References continue to resolve.`
        : "Nothing is past its retention window right now.",
    );
  };

  const archiveOne = (kind: RetentionKind, id: string, label: string) => {
    const result = archiveRecord(kind, id);
    notify(result.ok ? `Archived ${label}.` : result.message ?? "Could not archive.");
  };

  const restore = (entry: ArchiveEntry) => {
    const label =
      entry.kind === "release" && entry.release
        ? `Release #${entry.release.sequence}`
        : entry.kind === "import" && entry.importBatch
          ? entry.importBatch.label
          : entry.site?.name ?? "record";
    const result = restoreArchived(entry.id);
    notify(
      result.ok
        ? `${label} restored. It must pass a new readiness check before release.`
        : result.message ?? "Could not restore.",
    );
  };

  const pendingTotal =
    pendingRestore.recordings.length +
    pendingRestore.sites.length +
    pendingRestore.batches.length;

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="RETENTION POLICY"
        title="Retention desk"
        description="Apply retention windows to publications, imports, and sites. Cleanup archives instead of deleting, so published versions and references keep resolving."
        actions={
          <Button
            variant={counts.expired ? "primary" : "secondary"}
            icon={<Trash2 size={16} />}
            disabled={counts.expired === 0}
            onClick={runSweep}
          >
            Archive {counts.expired} expired
          </Button>
        }
      />

      <div className="summary-strip">
        <div>
          <span className="eyebrow">IN RETENTION</span>
          <strong>
            {counts.active}
            <small> active</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">EXPIRED</span>
          <strong className={counts.expired ? "text-amber" : ""}>
            {counts.expired}
            <small> ready to archive</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">ARCHIVED</span>
          <strong>
            {counts.archived}
            <small> in archive</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">RESOLVABLE REFERENCES</span>
          <strong className={referenceIssues.length ? "text-amber" : ""}>
            {referenceIssues.length}
            <small> need attention</small>
          </strong>
        </div>
      </div>

      <section className="retention-policy">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">POLICY WINDOWS</div>
            <h2>How long each category is kept</h2>
          </div>
          <ShieldQuestion size={20} />
        </div>
        <div className="policy-grid">
          {RETENTION_RULES.map((rule) => {
            const Icon =
              rule.kind === "release"
                ? History
                : rule.kind === "import"
                  ? PackageOpen
                  : MapPin;
            return (
              <article className="policy-card" key={rule.categoryLabel}>
                <div className="policy-icon">
                  <Icon size={18} />
                </div>
                <h3>{rule.categoryLabel}</h3>
                <strong>{rule.retainDays} days</strong>
                <p>{rule.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      {pendingTotal > 0 && (
        <section className="blocker-list">
          <div className="eyebrow">AWAITING RE-QUALIFICATION</div>
          <div className="blocker-row">
            <RotateCcw size={16} />
            <span>
              {pendingTotal} restored item{pendingTotal === 1 ? "" : "s"}{" "}
              returned from the archive. Run a passing readiness check on the
              quality desk to regain publication eligibility.
            </span>
          </div>
        </section>
      )}

      <section className="retention-inventory">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">MATERIAL INVENTORY</div>
            <h2>Classified by business category</h2>
          </div>
          <Box size={20} />
        </div>
        <div className="retention-table">
          <div className="retention-row retention-head">
            <span>Record</span>
            <span>Category</span>
            <span>Status</span>
            <span>Window ends</span>
            <span>References</span>
            <span />
          </div>
          {items.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            return (
              <div className="retention-row" key={`${item.kind}-${item.id}`}>
                <span className="retention-record">
                  <Icon size={15} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </span>
                <span className="retention-category">{item.categoryLabel}</span>
                <span>
                  <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                </span>
                <span className="retention-date">
                  {item.status === "active" && item.expiresAt
                    ? formatDate(item.expiresAt)
                    : item.expiresAt
                      ? `expired ${formatDate(item.expiresAt)}`
                      : "Protected"}
                </span>
                <span>{item.referenceCount}</span>
                <span>
                  {item.status === "expired" && (
                    <Button
                      variant="ghost"
                      icon={<Archive size={14} />}
                      onClick={() => archiveOne(item.kind, item.id, item.label)}
                    >
                      Archive
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="retention-references">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">REFERENCE INTEGRITY</div>
            <h2>Links after cleanup</h2>
          </div>
          <Link2 size={20} />
        </div>
        {referenceIssues.length === 0 ? (
          <p className="retention-note">
            Every route placement, finding, import link, and frozen snapshot
            resolves to active material.
          </p>
        ) : (
          <div className="reference-list">
            {referenceIssues.map((issue) => (
              <div
                className={`reference-row ${issue.state}`}
                key={`${issue.ownerId}-${issue.kind}-${issue.targetId}`}
              >
                {issue.state === "archived" ? (
                  <Archive size={15} />
                ) : (
                  <FileClock size={15} />
                )}
                <span>
                  <strong>{issue.ownerLabel}</strong> references{" "}
                  <em>{issue.targetLabel}</em> ({issue.kind})
                </span>
                <Badge tone={issue.state === "archived" ? "warning" : "danger"}>
                  {issue.state === "archived"
                    ? "Resolves to archive"
                    : "Unresolvable"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="retention-archive">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">ARCHIVE VAULT</div>
            <h2>Archived material (restorable)</h2>
          </div>
          <Archive size={20} />
        </div>
        {archive.length === 0 ? (
          <EmptyState
            icon={<Archive size={22} />}
            title="Archive is empty"
            detail="Expired publications, imports, and sites appear here after a sweep."
          />
        ) : (
          <div className="archive-list">
            {archive.map((entry) => (
              <ArchiveRow key={entry.id} entry={entry} onRestore={restore} />
            ))}
          </div>
        )}
      </section>

      {toast && <div className="toast toast-positive">{toast}</div>}
    </div>
  );
}

function ArchiveRow({
  entry,
  onRestore,
}: {
  entry: ArchiveEntry;
  onRestore: (entry: ArchiveEntry) => void;
}) {
  const title =
    entry.kind === "release" && entry.release
      ? `Release #${entry.release.sequence}`
      : entry.kind === "import" && entry.importBatch
        ? entry.importBatch.label
        : entry.site?.name ?? "Record";
  const detail =
    entry.kind === "release"
      ? entry.release?.snapshot
        ? `${entry.release.snapshot.summary.recordingCount} clips · ${entry.release.snapshot.summary.siteCount} sites frozen`
        : "No snapshot"
      : entry.kind === "import"
        ? `${entry.recordings.length} clip${entry.recordings.length === 1 ? "" : "s"} brought in by this batch`
        : entry.site
          ? `${entry.site.recordingIds.length} route reference${entry.site.recordingIds.length === 1 ? "" : "s"} retained`
          : "";
  const Icon = KIND_ICONS[entry.kind];
  return (
    <article className="archive-row">
      <div className="archive-icon">
        <Icon size={17} />
      </div>
      <div className="archive-main">
        <div className="archive-title-line">
          <h3>{title}</h3>
          <Badge tone="neutral">{entry.retentionLabel}</Badge>
        </div>
        <p>{entry.reason}</p>
        <small>
          Archived {formatDate(entry.archivedAt)} · {detail}
        </small>
      </div>
      <Button
        variant="secondary"
        icon={<ArchiveRestore size={15} />}
        onClick={() => onRestore(entry)}
      >
        Restore
      </Button>
    </article>
  );
}
