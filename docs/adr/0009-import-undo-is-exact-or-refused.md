# ADR-0009: Import Undo Is Exact or Refused

* Status: Accepted
* Date: 2026-11-12
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

Recovering from the wrong Full-File Sync on 2026-11-11 meant editing `is_active` directly in the `Epi_1_Year` sheet. That edit bypassed validation, locking and the audit log (Issue #111, ADR-0007). Issue #112 asks for an app-level Import Undo instead (`CONTEXT.md` §47).

The data an import leaves behind cannot support an inferred undo:

* `cleanupEpiData` does not record which rows it deactivated. A row it deactivated looks the same as a row an earlier sync deactivated when a child moved out (`is_active = false`, `last_seen_batch` ≠ the batch). An inferred undo would bring moved-out children back.
* `upsertEpiData` overwrites a matched row with the file's values, and it sets `is_active = true` on a matched inactive row. No previous values or previous state are kept.

The design decisions were made in the grilling session on issue #112 (Q1–Q14).

## Decision

1. **Import Undo is exact or refused.** It reverses only which records are active, and it does so only when it can do that exactly.
2. **Only a Batch that updated no existing record can be undone.** Any `updated > 0` refuses, which includes every reactivation. An undoable Batch therefore only inserted rows and, in sync mode, deactivated rows.
3. **Cleanup records exactly which rows it deactivated.** Batches imported before this record existed cannot be undone.
4. **Only the latest completed Batch of a table and Fiscal Year can be undone**, and only when no later receipt has written to its facilities. A receipt that is still only `preflight` does not block it. Undo is one step: an undone Batch cannot be undone again and still blocks earlier Batches.
5. **Undo is soft.** Rows the Batch inserted become inactive. They are not deleted.
6. Admin and superadmin may undo, enforced on the server. The undo is audited with counts and facility codes only. If no Active Records remain afterwards, the undo also removes that table's Dashboard Summaries for the Fiscal Year (`CONTEXT.md` §44).

Business behavior is in `docs/features.md`. The added column and the receipt status are in `docs/schema.md`.

## Rationale

* Data integrity outranks convenience. A partial undo would leave wrong vaccine dates on matched children, and an inferred undo would reactivate children who really moved out.
* Matching on Record Identity is scoped to Fiscal Year, facility and birth date. A file for the wrong Age Group or Fiscal Year therefore almost never matches, so the incident shape (`updated 0`) can always be undone.
* When a wrong file did match existing children, the correct file must be at hand anyway. Importing it again restores everything, including the overwritten values, and it goes through the preflight (ADR-0007).

## Consequences

* A normal sync, which matches existing children, cannot be undone. Its recovery is to import the correct file again.
* The EPI sheets gain one system column that records the deactivating batch. Rows deactivated before it exists carry no such record.
* An undo changes its receipt, so any open preflight that overlaps it becomes stale and must be restarted.

## Alternatives Considered

* **Infer the undo from `last_seen_batch` and `is_active`** (the idea in issue #112). Rejected: it cannot tell this batch's deactivations from earlier ones.
* **Undo membership but warn that overwritten values stay.** Rejected: it leaves silently wrong vaccine dates.
* **Store a pre-image of every updated row.** Rejected: it duplicates individual health data and adds storage for a case that re-importing already covers.
* **Hard-delete the inserted rows.** Rejected: it breaks soft-deactivation semantics (`CONTEXT.md` §30) and cannot be reversed.
* **Close #112 and document re-import as the only recovery.** Rejected: staff may not have the correct file at hand.

## References

* `0007-mandatory-import-preflight.md`: preflight, receipts, overlap and staleness rules
* `../../CONTEXT.md` §27–§30, §44, §47 Import Undo
* `../features.md`, `../schema.md`, `../hdc-column-upgrade.md`
* `backend/src/Upload.js`: `upsertEpiData`, `cleanupEpiData`
* Issues #111, #112
