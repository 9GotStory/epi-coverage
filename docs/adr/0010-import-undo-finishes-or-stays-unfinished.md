# ADR-0010: Import Undo Finishes or Stays Unfinished

* Status: Accepted
* Date: 2026-11-12
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

Import Undo (ADR-0009, `CONTEXT.md` §47) makes several separate writes under the import lock: the EPI rows, the receipt, the `undo_epi_import` audit and, when no Active Records remain, the deletion of the table and year's Dashboard Summaries. The lock flushes in `finally`, so if a Sheets error or an execution timeout stops the undo between two writes, the writes before the failure are kept (Issue #140).

At each of the three gaps the undo is left half done, and the app cannot complete it:

* **Rows written, receipt not.** The receipt still says `complete`, but its rows are already reversed, and reactivation has cleared their `deactivated_by_batch`. A fresh preview then offers an undo of 0 / 0, which would record a false audit.
* **Receipt written, audit not.** The receipt says `undone`, so a retry is refused as `already_undone`, and the Audit Log never shows the reversal.
* **Audit written, summaries not deleted.** The table and year have no Active Records but keep Dashboard Summaries. Summary Regeneration skips such tables and keeps their rows by design (Issue #134), so it cannot remove them.

Any later Import into the same table and year also makes the half-done receipt unreachable, because Import Undo only targets the latest written receipt.

The design decisions were made in the grilling session on issue #140 (Q1–Q13).

## Decision

1. **A receipt is `undone` only when every step is complete.** Import Undo first writes the receipt as `undoing`, with the plan: who started it, when, and the confirmed counts. Then it writes the rows, the audit and, when no Active Records remain, the summary deletion. The receipt becomes `undone` last.
2. **An Unfinished Import Undo is finished by running Import Undo again.** It is the same action ("ย้อนต่อให้เสร็จ"), with the same admin and superadmin roles, enforced on the server. Any admin may finish it. Every step can be repeated safely: the rows are written only if they are not yet written, the audit only if it does not exist, and summaries are deleted only if the table and year have no Active Records at that moment.
3. **Finishing is exact or refused.** The row effect that remains must equal the plan exactly (rows not yet written) or be zero (rows already written). Any other state is refused and the receipt stays `undoing`.
4. **The audit is reconstructed from the plan.** There is one `undo_epi_import` event, attributed to the admin who started the undo, with the planned counts. If another admin finishes the undo, the event records who finished it.
5. **An Unfinished Import Undo blocks Imports into its table and Fiscal Year.** Both the preflight and the first chunk write of any other Batch are refused, for the whole table and year and not only the overlapping facilities. The unfinished receipt therefore stays the latest written receipt until it is finished.
6. Receipts already `undone` before this decision count as complete.

Business behavior is in `docs/features.md`. The receipt status is in `docs/schema.md` and `docs/hdc-column-upgrade.md`.

## Rationale

* An unfinished undo must be recorded, not inferred. The rows alone cannot tell a reversed batch from a batch that never inserted anything, and ADR-0009 forbids inferring what a batch changed.
* Reusing the same action keeps the vocabulary and UI small. An unfinished undo is unfinished work, not damage that needs a separate tool.
* Blocking Imports is the only way to keep the unfinished receipt reachable. Unfinished undos are rare, so the block costs little.

## Consequences

* The receipt gains the status `undoing`. Cleanup refuses it, and a resent chunk of its Batch writes nothing, the same as for `undone`.
* A table and Fiscal Year cannot be imported until its Unfinished Import Undo is finished.
* An Unfinished Import Undo refused because its rows no longer match the plan has no in-app way out. That state only follows a manual edit of the EPI sheet. The system owner restores the rows to the plan by hand, records an `audit_logs` entry with action `manual_data_fix` (as in Issue #134), and then finishes the undo in the app.
* Summary Regeneration is unchanged. It still never deletes Dashboard Summaries.

## Alternatives Considered

* **Repair from the `undone` receipt without an intermediate status.** Rejected: it cannot detect the gap between the row write and the receipt write.
* **A separate repair action for admins.** Rejected: it adds a term and a UI for what is only unfinished work.
* **Repair automatically in the preview or in another locked operation.** Rejected: the preview is read-only by contract, and a repair should be an action an admin takes on purpose.
* **Let Summary Regeneration delete the summaries of tables with no Active Records.** Rejected: it reverses Issue #134, which keeps a real snapshot from being replaced by an empty read.
* **Allow Imports while an undo is unfinished.** Rejected: the unfinished receipt would stop being the latest one and could never be finished.
* **An in-app force-finish or cancel.** Rejected: it would have to trust row state that disagrees with the plan.

## References

* `0009-import-undo-is-exact-or-refused.md`
* `0007-mandatory-import-preflight.md`
* `../../CONTEXT.md` §44, §45, §47 (Unfinished Import Undo)
* `../features.md`, `../schema.md`, `../hdc-column-upgrade.md`
* `backend/src/Upload.js`: `undoEpiImport`, `ensureUploadAudit`; `backend/src/DashboardCache.js`: `deleteDashboardSummaries`
* Issues #112, #134, #139, #140
