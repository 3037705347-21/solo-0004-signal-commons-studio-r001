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
- `Recording`: a short sound clip with catalogue ID, source, recording date, file format, capture location, audio specification, signal role, sensitivity, transcript status, consent status, optional import batch link, and retention markers.
- `Site`: a listening-route stop with a research prompt, duration and clip capacity, quiet-playback support, seating availability, ordered recording IDs, and retention markers.
- `Placement`: assignment of a recording to a site and position in the route.
- `QualityIssue`: a severity-ranked evidence finding linked to a site or clip, with open, in-progress, or resolved state.
- `ImportBatch`: an intake grouping of recordings with open or completed state; completed and open batches follow different retention windows.
- `RetentionPolicy`: executable per-class retention windows (published releases, open imports, completed imports, sites) plus a restore guidance window.
- `TombstoneIndex`: vaulted copies of archived recordings, sites, import batches, and releases that keep existing references resolvable after cleanup.
- `Snapshot`: a frozen release summary used for local export and comparison.

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

### 6. Apply retention and recover archives

The lead opens the retention desk, reviews an executable ledger of releases, import batches, and sites classified as within retention, expired, or archived, and adjusts per-class retention windows. Expired material is archived into a recoverable vault instead of being hard-deleted; published versions move into release lineage, and site placements, import batches, and findings continue to resolve to cleaned objects. Archived material can be restored, but restored clips and sites must be explicitly requalified (and a restored release re-checked) before publication eligibility returns.

## State and rules

- Study state transitions are `draft -> review -> ready`; a blocking change regresses a ready study to `review`.
- Persisted state uses an explicit schema version, a monotonically increasing content revision, and a bounded command audit log.
- State-changing commands carry a command ID, origin tab, issue time, and expected revision. Repeated command IDs are idempotent, while stale revisions are rejected and recorded without changing content.
- Browser tabs synchronize committed workspace records through storage events and reload the checksummed primary or backup record.
- Version 1 browser data is migrated into the current schema; nested invalid records are rejected and dangling or duplicate route references are repaired during startup validation.
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
- Each release has a monotonic sequence and records the prior release it supersedes, preserving a local release lineage.
- Retention windows are executable policy by business class: published releases, open import batches, completed import batches, and sites each age from their origin (or last restore/requalification) into active, expired, or archived standing; standings are derived and update immediately when the policy changes.
- Only expired material can be archived. Archiving removes recordings, sites, batches, or releases from the live workspace into a tombstone vault without breaking references: site placements, findings, import batches, release lineage, and checklists resolve cleaned objects through their tombstones.
- Archived material is recoverable. A restore reopens the object with a renewed retention window but revokes publication eligibility until an owner explicitly requalifies it; restored releases return as historical lineage and require a new readiness check.
- A readiness check blocks publication while restored clips or sites await requalification or while live route references resolve only to vaulted clips.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, route analysis, release rules, checklist serialization, retention policy and archive lifecycle, and scenario projections.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `features/retention`: retention policy, per-class ledger, import batch intake, archive vault, restore and requalification workflow.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/quality`, `/scenarios`, and `/retention`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- JSON snapshots use schema version 2 and include the frozen content revision, fingerprint, planning preferences, route summary, and unresolved findings.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, route constraints, release rules, deterministic fingerprints, reducer boundaries, site checklists, review transitions, retention and archive lifecycle, and versioned persistence.
- Playwright browser checks for the five user-facing workflows.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Playwright checks that expired material archives into the vault, existing references keep resolving, and a restore requires requalification before release.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
