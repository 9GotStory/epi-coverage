# ADR-0007: Every EPI Import Runs a Server-Enforced Preflight Before Any Write

* Status: Accepted
* Date: 2026-11-11
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

On 2026-11-11, staff uploaded a 1-year file for FY2569 in full-sync mode, and the file was wrong. None of its rows matched an existing child on the import identity key. The import inserted 143 new rows and then deactivated almost all of the 181 existing children.

The import wrote each chunk immediately and deactivated rows during cleanup. So the damage was visible only after the data had already changed. Recovery required editing `is_active` directly in the sheet, which bypassed validation and the audit log.

The decisions behind this ADR were made in the grilling session on issue #111 (Q1–Q15).

## Decision

1. **Every import, merge or sync, starts with a read-only preflight** (`preflightEpiImport`).
   * It receives only the Record Identity fields.
   * It returns counts and facility codes only: matched, new and would-deactivate, overall and per facility.
   * It records a `preflight` receipt and writes no EPI sheet.
2. **Risky imports need a typed confirmation, checked by the server.**
   * Risky means either:
     * a facility has active children but no file row matches any of them; or
     * a sync would deactivate more than `EPI_SYNC_SHRINK_THRESHOLD` (20%) of the active children in the touched facilities.
   * The admin who ran the preflight must type the number the server computed (`confirmEpiImport`).
   * **Amended 2026-11-12 (Issue #136):** a third risk condition, a file row born outside the selected Cohort Birth Range, joins the two above, and each fired condition now has its own typed number. The current list of conditions is in `docs/features.md`.
3. **Writes fail closed.**
   * `upsertEpiData` and `cleanupEpiData` reject a batch that has no preflight receipt.
   * `upsertEpiData` also rejects a batch that is risky but not confirmed, or whose chunk identity fingerprints differ from the preflight.
   * Before the first write, it rejects a batch whose counts went stale because an overlapping import progressed after the preflight.
4. **Audit carries counts, never identities.**
   * The first written chunk's `upload_excel` event includes the preflight counts.
   * A risky import additionally records `confirm_epi_import`.

Business rules are in `docs/features.md`. The receipt mechanics are in `docs/hdc-column-upgrade.md`.

## Consequences

* Every upload takes one extra round trip and one extra click. A risky upload also needs a typed number.
* Clients older than this change cannot import. The backend and frontend must be deployed together.
* Receipts from before this change that are stuck in `uploading` cannot be finalized and must be re-imported.
* An app-level undo of a completed sync was out of scope here; Import Undo is decided in ADR-0009 (issue #112).
