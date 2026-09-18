# Signal Commons Studio - Project Specification

## Goal

Signal Commons Studio is an offline-first browser workspace for community soundscape fieldwork. A field team curates short field recordings, composes a listening route across neighborhood sites, resolves consent and transcript findings, and compares listener scenarios before publishing a study pack.

## Users

- Field researchers catalogue recordings with capture context and audio metadata.
- Route editors arrange clips into a coherent listening route.
- Quality reviewers verify consent notes, transcripts, and listening support.
- Project leads use scenario projections to choose planning preferences.

## Core entities

- `FieldStudy`: title, field area, listening question, publication date, and release state.
- `Recording`: a short sound clip with catalogue ID, source, recording date, file format, capture location, audio specification, signal role, sensitivity, transcript status, and consent status.
- `Site`: a listening-route stop with a research prompt, duration and clip capacity, quiet-playback support, seating availability, and ordered recording IDs.
- `Placement`: assignment of a recording to a site and position in the route.
- `QualityIssue`: a severity-ranked evidence finding linked to a site or clip, with open, in-progress, or resolved state.
- `Snapshot`: a frozen release summary used for local export and comparison.
- `ImportBatch`: a provenance group that brings recordings into the study; open (unfinished) or completed.
- `ArchiveEntry`: a soft-deleted record (superseded release, import batch with its clips, or site) retained in an archive vault so references and published versions keep resolving.

## Workflows

### 1. Curate the signal library

The user opens the library, searches and filters recordings, adds a recording through a validated editor, and sees it enter the study. Duplicate catalogue IDs, missing titles or capture context, invalid audio specifications, and weak summaries are rejected with field-level messages. The recording is persisted in local storage and becomes available to the route editor.

### 2. Compose and validate a listening route

The user opens the route view, selects an unplaced clip, assigns it to a listening site, changes sequence, and moves clips between sites. The domain engine recalculates site duration, clip utilization, signal-role coverage, and accessibility constraints after every transition. The constraint panel exposes blocking errors and warnings.

### 3. Resolve evidence quality before release

The user opens the quality desk, creates a finding linked to a clip or site, advances it through open, in-progress, and resolved states, and runs a release check. The release engine combines unresolved blockers, featured clip coverage, role coverage, and route validation. A passing study can export a JSON snapshot; a blocked study explains what remains.

### 4. Compare listener scenarios

The user opens the scenario lab and adjusts listening pace, listener count, and accessibility priority. The projection engine recomputes listening duration, comfort, access coverage, and pressure sites without mutating the saved study. The user can explicitly apply a scenario as planning preferences.

### 5. Export a field checklist

The user filters the quality desk by a listening site and downloads a CSV checklist that lists every placed clip in sequence with audio duration and unresolved findings.

### 6. Apply the retention policy

The user opens the retention desk and reviews every publication, import batch, and site classified as in retention (`active`), past its window (`expired`), or in the archive vault (`archived`). The policy windows are: 365 days for superseded publications, 180 days for completed imports, 90 days for unfinished imports, and 120 days for disused (empty) sites; sites carrying route clips are protected. Archiving a record soft-deletes it into the vault rather than removing it, so frozen release snapshots, route placements, findings, and import provenance continue to resolve to the archived object (reported as an archived reference). Archived material can be restored; restored objects return flagged for re-qualification and must pass a fresh readiness check before they can belong to a published version again.

## State and rules

- Study state transitions are `draft -> review -> ready`; a blocking change regresses a ready study to `review`.
- Persisted state uses an explicit schema version, a monotonically increasing content revision, and a bounded command audit log.
- State-changing commands carry a command ID, origin tab, issue time, and expected revision. Repeated command IDs are idempotent, while stale revisions are rejected and recorded without changing content.
- Browser tabs synchronize committed workspace records through storage events and reload the checksummed primary or backup record.
- Version 1 and 2 browser data is migrated into the current schema (v3); nested invalid records are rejected, legacy recordings are attached to a synthetic completed import batch, and dangling or duplicate route references are repaired during startup validation while references into the archive are preserved.
- Persistence writes a checksummed record plus the previous primary record as a backup. A corrupt or incomplete primary record falls back to the last valid backup before using sample data.
- Recording catalogue IDs are normalized and unique.
- Every recording must have positive sample rate, duration, and a valid channels or bit depth value.
- A site warns above 80% of listening capacity and blocks above 100%.
- Placement commands enforce site clip and duration limits before changing route state.
- Sensitive clips cannot enter a quiet-playback site without review.
- Featured clips must be assigned to a listening site before release.
- Arrival, texture, voice, and departure signals must all be represented in the route before release.
- Critical consent or editorial findings block release until resolved.
- A successful readiness check freezes a revision, deterministic content fingerprint, and snapshot; any release-relevant change marks that release stale and blocks export until another successful check.
- Each release has a monotonic sequence and records the prior release it supersedes, preserving a local release lineage. When a new release is frozen, the previous head moves into a retained `releaseHistory` collection; the current head never expires.
- Retention policy is executable per business category: superseded releases (365 days), completed imports (180 days), unfinished imports (90 days), and disused empty sites (120 days) age into `expired`; an explicit sweep or per-record archive command moves them into the archive vault.
- Cleanup never hard-deletes: archiving an import moves its clips with it, and reference resolution falls back to the archive so published versions, import batches, and route/finding references continue to resolve to the cleaned object with an archived marker. Only references unknown to both active material and the archive are pruned at startup.
- Archived records can be restored. Restored imports reopen (unfinished) and return with their clips; restored sites and clips carry a `restoredAt` marker and the project regresses to review. The release gate lists restored material while it awaits re-qualification, and a passing readiness check clears the marker for restored material covered by the release (placed clips and route sites), re-earning publication eligibility; restored clips left out of the route keep their marker without blocking the rest of the release. A restored publication returns as stale lineage and is never republished automatically.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, route analysis, release rules, checklist serialization, and scenario projections.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/retention`: retention policy windows, material classification, archive sweep and restore, and reference integrity.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/quality`, `/retention`, and `/scenarios`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- JSON snapshots use schema version 2 and include the frozen content revision, fingerprint, planning preferences, route summary, and unresolved findings.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, route constraints, release rules, deterministic fingerprints, reducer boundaries, site checklists, review transitions, versioned persistence, retention classification, archive sweep, reference resolution, and restore re-qualification.
- Playwright browser checks for the five user-facing workflows.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Playwright checks that sweeping expired material archives it without breaking route references, and that a restored import is blocked from release until a passing readiness check.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
