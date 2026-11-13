# ADR-0012: The Finalize Audit Is Rebuilt from the Receipt

* Status: Accepted
* Date: 2026-11-13
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

A Finalize (`CONTEXT.md` §48) writes the receipt as `complete` with the `finalize` marker, then appends the `cleanup_epi_data` audit event (ADR-0011). If the append fails after the receipt write, the event is lost for good. Every later replay hits the `complete` path, which returns the recorded count without looking at the Audit Log (Issue #146).

The event is more than a trace. The As-of Date (`CONTEXT.md` §31) is the timestamp of the latest `cleanup_epi_data` event (`getLatestImportTime`), so a lost event makes the app report an older import.

Chunk audits do not have this gap. `ensureUploadAudit` rebuilds a missing `upload_excel` event from the metadata on the receipt. Repair on replay alone would not be enough here, because the Upload page never resends a chunk of a Batch after a failure: it tells the admin to import again, which creates a new Batch.

A check of production on 2026-11-13 found every `complete` receipt with its event, so no event has been lost so far.

The design decisions were made in the grilling session on issue #146 (Q1–Q11).

## Decision

1. **The `finalize` marker records who finalized the Batch** as `actor: { userId, email }`. The event keeps its shape (user id `SYSTEM`, the actor's email, `Batch <id>: <n> deactivated (<mode>).`).
2. **Exactly one `cleanup_epi_data` event per finalized Batch.** One function ensures it, like `ensureUploadAudit` and `ensureUndoAudit`: it writes the event only if no event of that action for that Batch exists.
3. **Every Finalize and every replay of a `complete` receipt sweeps all `complete` receipts** and rebuilds the missing events of those whose marker has an `actor`. The current Batch's event is written first.
4. **A rebuilt event carries `finalize.at` as its timestamp** and notes in its details when it was actually written. The event a Finalize writes in its own execution has no note.
5. **Only the current Batch's event can fail the request.** A failure of the current event surfaces as an error, as before, and never as a false audited success. A failure to rebuild another Batch's event is left for the next sweep.
6. **Receipts whose marker has no `actor` are skipped.** They hold nothing truthful about who finalized them.

The marker fields are in `docs/hdc-column-upgrade.md`.

## Rationale

* The admin's next Import is the one step that reliably follows a failed Finalize, so sweeping at every Finalize repairs the lost event without new UI or client state.
* A rebuilt event stamped with the repair time could move the As-of Date past the real latest import. `finalize.at` keeps it correct, and the note keeps the log honest about the late write.
* Rebuilding only from recorded facts follows ADR-0009 and ADR-0010: never infer what is not recorded.

## Consequences

* `audit_logs` rows are no longer strictly in timestamp order. A rebuilt event can sit below newer rows.
* Each Finalize reads `audit_logs` once more, as each chunk write already does.
* An admin still sees an error when the current Batch's event fails after the receipt is `complete`. Their re-import then rebuilds the lost event.
* Events lost before this decision cannot be rebuilt, and none are known.

## Alternatives Considered

* **Repair on replay only.** Rejected: the Upload page never replays a Batch after a failure, so the repair would almost never run.
* **Write the receipt as `complete` only after the audit, as in ADR-0010.** Rejected: if the audit fails, a sync that already deactivated rows stays `uploading` for good, with no way to reach it from the app, and Import Undo reports it as in progress.
* **Return success when the audit append fails.** Rejected: a false audited success, and a timeout cannot be caught anyway.
* **Stamp a rebuilt event with the time it is written.** Rejected: it can move the As-of Date forward.
* **Rebuild events of receipts that have no `actor`, using the last chunk's audit.** Rejected: before Issue #144 the finalizing admin was whoever called `cleanupEpiData`, which the receipt does not record.

## References

* `0009-import-undo-is-exact-or-refused.md`
* `0010-import-undo-finishes-or-stays-unfinished.md`
* `0011-last-chunk-finalizes-the-import.md`
* `../../CONTEXT.md` §31 As-of Date, §32 Audit Log, §48 Finalize
* `../hdc-column-upgrade.md`
* `backend/src/Upload.js`: `epiFinalizeBatch`, `ensureUploadAudit`, `ensureUndoAudit`; `backend/src/Data.js`: `logAction`, `getLatestImportTime`
* Issues #144, #145, #146
