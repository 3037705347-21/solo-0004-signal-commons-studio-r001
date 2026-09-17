import {
  ArchiveRestore,
  Archive as ArchiveIcon,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Compass,
  DownloadCloud,
  FileClock,
  Link2,
  PackageCheck,
  RotateCcw,
  Save,
  ShieldCheck,
  Tags,
  TimerReset,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Metric } from "../../components/Metric";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import { formatDate, titleCase } from "../../domain/formatters";
import type {
  RetentionCategory,
  RetentionEntry,
  RetentionPolicy,
} from "../../domain/models";
import {
  danglingArchivedReferenceIds,
  resolveRecording,
} from "../../domain/retention";
import { useStudy, type ImportBatchDraft } from "../../state/StudyContext";

const CATEGORY_LABEL: Record<RetentionCategory, string> = {
  release: "Published release",
  import: "Import batch",
  site: "Listening site",
};

const STATUS_TONE = {
  active: "positive",
  expired: "danger",
  archived: "neutral",
} as const;

const CATEGORY_ICON = {
  release: DownloadCloud,
  import: ClipboardList,
  site: Compass,
} as const;

type CategoryFilter = RetentionCategory | "all";

function daysLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function RetentionPage() {
  const {
    state,
    retention,
    createImportBatch,
    completeImportBatch,
    updateRetentionPolicy,
    archiveMaterial,
    restoreMaterial,
    requalifyMaterial,
  } = useStudy();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [toast, setToast] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<RetentionPolicy>(
    state.retentionPolicies,
  );
  const [showImportModal, setShowImportModal] = useState(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const liveEntries = useMemo(
    () =>
      retention.entries
        .filter((entry) => entry.status !== "archived")
        .filter((entry) =>
          categoryFilter === "all" ? true : entry.category === categoryFilter,
        ),
    [retention.entries, categoryFilter],
  );

  const brokenRefs = useMemo(
    () =>
      danglingArchivedReferenceIds(state).map((id) => {
        const recording = resolveRecording(state, id);
        const siteNames = state.sites
          .filter((site) => site.recordingIds.includes(id))
          .map((site) => site.name);
        return { id, title: recording?.title ?? id, siteNames };
      }),
    [state],
  );

  const savePolicy = () => {
    const result = updateRetentionPolicy(policyDraft);
    notify(result.ok ? "Retention policy updated." : result.message ?? "Could not save policy.");
  };

  const archive = (entry: RetentionEntry) => {
    if (!window.confirm(`Archive “${entry.label}”? It moves to the vault and stays resolvable by existing references.`))
      return;
    const result = archiveMaterial(entry.category, entry.id);
    if (!result.ok) notify(result.message ?? "Archive failed.");
  };

  const restore = (category: RetentionCategory, id: string, label: string) => {
    if (!window.confirm(`Restore “${label}”? Restored material must be requalified before it can be published.`))
      return;
    const result = restoreMaterial(category, id);
    notify(
      result.ok
        ? "Restored. Requalification is required before release."
        : result.message ?? "Restore failed.",
    );
  };

  const requalify = (entry: RetentionEntry) => {
    const result = requalifyMaterial(entry.category, entry.id);
    notify(
      result.ok
        ? "Requalified for publication with a renewed retention window."
        : result.message ?? "Requalification failed.",
    );
  };

  const policyFields: Array<{
    key: keyof RetentionPolicy;
    label: string;
    hint: string;
  }> = [
    { key: "releaseDays", label: "Published releases (days)", hint: "Keep frozen versions after release" },
    { key: "importOpenDays", label: "Open imports (days)", hint: "Unfinished import batches" },
    { key: "importCompletedDays", label: "Completed imports (days)", hint: "Finished import batches" },
    { key: "siteDays", label: "Listening sites (days)", hint: "Idle route sites" },
    { key: "restoreGraceDays", label: "Restore window (days)", hint: "Guidance for vault recovery" },
  ];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="RETENTION DESK"
        title="Retention & archives"
        description="Apply executable retention rules by material class; cleaned objects stay resolvable through their tombstones."
        actions={
          <Button
            variant="primary"
            icon={<ClipboardList size={16} />}
            onClick={() => setShowImportModal(true)}
          >
            New import batch
          </Button>
        }
      />
      <div className="metric-grid four">
        <Metric
          label="Within retention"
          value={String(retention.activeCount)}
          detail="Active material"
          icon={<ShieldCheck size={17} />}
          tone="teal"
        />
        <Metric
          label="Past retention"
          value={String(retention.expiredCount)}
          detail="Ready to archive"
          icon={<CalendarClock size={17} />}
          tone={retention.expiredCount ? "red" : "teal"}
        />
        <Metric
          label="In the vault"
          value={String(retention.archivedCount)}
          detail="Recoverable"
          icon={<ArchiveIcon size={17} />}
          tone="amber"
        />
        <Metric
          label="References on vault clips"
          value={String(brokenRefs.length)}
          detail="Block new release"
          icon={<Link2 size={17} />}
          tone={brokenRefs.length ? "red" : "teal"}
        />
      </div>

      <section className="retention-policy-card">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">EXECUTABLE POLICY</div>
            <h2>Retention windows by business class</h2>
          </div>
          <TimerReset size={19} />
        </div>
        <div className="retention-policy-grid">
          {policyFields.map(({ key, label, hint }) => (
            <TextField
              key={key}
              label={label}
              type="number"
              min="1"
              value={String(policyDraft[key])}
              hint={hint}
              onChange={(event) => {
                const value = Math.max(1, Math.floor(Number(event.target.value) || 1));
                setPolicyDraft((current) => ({ ...current, [key]: value }));
              }}
            />
          ))}
        </div>
        <div className="retention-policy-actions">
          <Button
            variant="primary"
            icon={<Save size={15} />}
            onClick={savePolicy}
            disabled={
              JSON.stringify(policyDraft) ===
              JSON.stringify(state.retentionPolicies)
            }
          >
            Save policy
          </Button>
          <Button
            variant="ghost"
            icon={<RotateCcw size={15} />}
            onClick={() => setPolicyDraft(state.retentionPolicies)}
          >
            Reset
          </Button>
        </div>
      </section>

      {brokenRefs.length > 0 && (
        <section className="retention-refs-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">REFERENCE INTEGRITY</div>
              <h2>Live references resolving to cleaned clips</h2>
            </div>
            <Link2 size={19} />
          </div>
          <p className="retention-refs-copy">
            Existing placements still resolve to the vault copy, but a new
            release is blocked until the clips are restored or replaced.
          </p>
          <div className="retention-ref-list">
            {brokenRefs.map((ref) => (
              <div className="retention-ref-row" key={ref.id}>
                <FileClock size={15} />
                <strong>{ref.title}</strong>
                <span>placed in {ref.siteNames.join(", ")}</span>
                <Button
                  variant="secondary"
                  icon={<ArchiveRestore size={14} />}
                  onClick={() => {
                    const batchId = state.tombstoneIndex.recordings[ref.id]
                      ?.recording.importBatchId;
                    if (batchId && state.tombstoneIndex.importBatches[batchId]) {
                      restore("import", batchId, "its import batch");
                    } else {
                      notify("This clip was archived with an import batch that no longer exists.");
                    }
                  }}
                >
                  Restore via batch
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="retention-live-card" data-testid="retention-ledger">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">RETENTION LEDGER</div>
            <h2>Material by retention standing</h2>
          </div>
          <div className="review-site-field">
            <SelectField
              label="Business class"
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value as CategoryFilter)
              }
            >
              <option value="all">All classes</option>
              <option value="release">Published releases</option>
              <option value="import">Import batches</option>
              <option value="site">Listening sites</option>
            </SelectField>
          </div>
        </div>
        {liveEntries.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={22} />}
            title="Nothing in this class"
            detail="No live material matches the selected business class."
          />
        ) : (
          <div className="retention-table">
            {liveEntries.map((entry) => (
              <RetentionRow
                key={entry.key}
                entry={entry}
                onArchive={() => archive(entry)}
                onRequalify={() => requalify(entry)}
              />
            ))}
          </div>
        )}
      </section>

      <OpenBatchPanel
        onComplete={(batchId) => {
          const result = completeImportBatch(batchId);
          notify(result.ok ? "Import batch marked complete." : result.message ?? "Could not complete batch.");
        }}
      />

      <VaultPanel onRestore={restore} />

      {showImportModal && (
        <ImportBatchModal
          onClose={() => setShowImportModal(false)}
          onSave={(draft) => {
            const result = createImportBatch(draft);
            if (result.ok) {
              setShowImportModal(false);
              notify("Import batch opened.");
            }
            return result;
          }}
        />
      )}
      {toast && <div className="toast toast-positive">{toast}</div>}
    </div>
  );
}

function RetentionRow({
  entry,
  onArchive,
  onRequalify,
}: {
  entry: RetentionEntry;
  onArchive: () => void;
  onRequalify: () => void;
}) {
  const Icon = CATEGORY_ICON[entry.category];
  return (
    <article className="retention-row">
      <div className="retention-row-icon">
        <Icon size={17} />
      </div>
      <div className="retention-row-main">
        <div className="retention-row-title">
          <h3>{entry.label}</h3>
          <Badge tone={STATUS_TONE[entry.status]}>{titleCase(entry.status)}</Badge>
          <Badge tone="info">{CATEGORY_LABEL[entry.category]}</Badge>
          {entry.requalificationRequired && (
            <Badge tone="warning">Restored · requalify</Badge>
          )}
        </div>
        <div className="retention-row-meta">
          <span>
            <CalendarClock size={13} /> window {daysLabel(entry.policyDays)}
          </span>
          <span>from {entry.retainedFrom}</span>
          <span>
            {entry.status === "expired" ? "expired" : "retain until"}{" "}
            {formatDate(entry.retainedUntil)}
          </span>
        </div>
      </div>
      <div className="retention-row-actions">
        {entry.requalificationRequired && (
          <Button
            variant="secondary"
            icon={<ShieldCheck size={14} />}
            onClick={onRequalify}
          >
            Requalify
          </Button>
        )}
        <Button
          variant={entry.status === "expired" ? "primary" : "ghost"}
          icon={<ArchiveIcon size={14} />}
          onClick={onArchive}
          disabled={entry.status !== "expired"}
        >
          Archive
        </Button>
      </div>
    </article>
  );
}

function OpenBatchPanel({ onComplete }: { onComplete: (id: string) => void }) {
  const { state } = useStudy();
  const batches = state.importBatches;
  if (batches.length === 0) return null;
  return (
    <section className="retention-live-card" data-testid="import-intake">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">IMPORT INTAKE</div>
          <h2>Import batches</h2>
        </div>
        <Boxes size={19} />
      </div>
      <div className="retention-table">
        {batches.map((batch) => (
          <article className="retention-row" key={batch.id}>
            <div className="retention-row-icon">
              {batch.status === "completed" ? (
                <PackageCheck size={17} />
              ) : (
                <ClipboardList size={17} />
              )}
            </div>
            <div className="retention-row-main">
              <div className="retention-row-title">
                <h3>{batch.label}</h3>
                <Badge tone={batch.status === "completed" ? "positive" : "warning"}>
                  {batch.status === "completed" ? "Completed" : "Open"}
                </Badge>
                <Badge tone="neutral">{batch.recordingIds.length} clips</Badge>
              </div>
              <div className="retention-row-meta">
                <span>{batch.source || "Unspecified source"}</span>
                <span>opened {formatDate(batch.createdAt)}</span>
                {batch.completedAt && <span>completed {formatDate(batch.completedAt)}</span>}
              </div>
              {batch.note && <p className="retention-batch-note">{batch.note}</p>}
            </div>
            {batch.status === "open" && (
              <div className="retention-row-actions">
                <Button
                  variant="secondary"
                  icon={<PackageCheck size={14} />}
                  onClick={() => onComplete(batch.id)}
                >
                  Mark complete
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function VaultPanel({
  onRestore,
}: {
  onRestore: (category: RetentionCategory, id: string, label: string) => void;
}) {
  const { retention } = useStudy();
  const { archived } = retention;
  const total =
    archived.recordings.length +
    archived.sites.length +
    archived.importBatches.length +
    archived.releases.length;
  return (
    <section className="retention-vault-card">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">ARCHIVE VAULT</div>
          <h2>Recoverable material</h2>
        </div>
        <ArchiveIcon size={19} />
      </div>
      {total === 0 ? (
        <EmptyState
          icon={<ArchiveIcon size={22} />}
          title="The vault is empty"
          detail="Expired material appears here after it is archived."
        />
      ) : (
        <div className="vault-groups">
          <VaultGroup
            title="Import batches"
            icon={<ClipboardList size={15} />}
            items={archived.importBatches.map((item) => ({
              id: item.batch.id,
              label: item.batch.label,
              detail: `${item.recordingIds.length} clips · archived ${formatDate(item.archivedAt)}`,
            }))}
            category="import"
            onRestore={onRestore}
          />
          <VaultGroup
            title="Listening sites"
            icon={<Compass size={15} />}
            items={archived.sites.map((item) => ({
              id: item.site.id,
              label: item.site.name,
              detail: `${item.recordingIds.length} clips · archived ${formatDate(item.archivedAt)}`,
            }))}
            category="site"
            onRestore={onRestore}
          />
          <VaultGroup
            title="Published releases"
            icon={<Tags size={15} />}
            items={archived.releases.map((item) => ({
              id: item.release.id,
              label: `Release #${item.release.sequence}`,
              detail: `archived ${formatDate(item.archivedAt)}`,
            }))}
            category="release"
            onRestore={onRestore}
          />
        </div>
      )}
    </section>
  );
}

function VaultGroup({
  title,
  icon,
  items,
  category,
  onRestore,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ id: string; label: string; detail: string }>;
  category: RetentionCategory;
  onRestore: (category: RetentionCategory, id: string, label: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="vault-group">
      <div className="vault-group-title">
        {icon}
        <strong>{title}</strong>
        <Badge tone="neutral">{items.length}</Badge>
      </div>
      {items.map((item) => (
        <div className="vault-row" key={item.id}>
          <div>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </div>
          <Button
            variant="secondary"
            icon={<ArchiveRestore size={14} />}
            onClick={() => onRestore(category, item.id, item.label)}
          >
            Restore
          </Button>
        </div>
      ))}
    </div>
  );
}

function ImportBatchModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (draft: ImportBatchDraft) => {
    ok: boolean;
    errors?: Record<string, string>;
    message?: string;
  };
}) {
  const { state } = useStudy();
  const availableRecordings = state.recordings.filter(
    (recording) => !recording.importBatchId,
  );
  const [draft, setDraft] = useState<ImportBatchDraft>({
    label: "",
    source: "",
    note: "",
    recordingIds: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toggleRecording = (id: string) =>
    setDraft((current) => ({
      ...current,
      recordingIds: current.recordingIds.includes(id)
        ? current.recordingIds.filter((candidate) => candidate !== id)
        : [...current.recordingIds, id],
    }));

  return (
    <Modal
      eyebrow="NEW IMPORT BATCH"
      title="Group clips into an import batch"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const result = onSave(draft);
              if (!result.ok) setErrors(result.errors ?? { label: result.message ?? "Could not create batch." });
            }}
          >
            Open batch
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Batch label"
          value={draft.label}
          onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          error={errors.label}
          placeholder="Autumn contributor intake"
        />
        <TextField
          label="Source"
          value={draft.source}
          onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
          placeholder="Shared drive / device / archive"
        />
        <TextField
          label="Note"
          textarea
          rows={3}
          value={draft.note}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          hint="What still needs review before this import completes?"
        />
      </div>
      <div className="import-picker">
        <div className="eyebrow">
          CLIPS WITHOUT A BATCH · {draft.recordingIds.length} selected
        </div>
        {availableRecordings.length === 0 ? (
          <p className="retention-batch-note">
            Every live clip already belongs to an import batch.
          </p>
        ) : (
          availableRecordings.map((recording) => {
            const selected = draft.recordingIds.includes(recording.id);
            return (
              <label className={`import-pick-row ${selected ? "selected" : ""}`} key={recording.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleRecording(recording.id)}
                />
                <strong>{recording.title}</strong>
                <small>{recording.catalogId}</small>
              </label>
            );
          })
        )}
      </div>
    </Modal>
  );
}
