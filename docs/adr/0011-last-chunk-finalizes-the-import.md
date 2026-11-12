# ADR-0011: The Last Chunk Finalizes the Import

* Status: Accepted
* Date: 2026-11-12
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

An Import writes its Batch in chunks (`upsertEpiData`) and then finalizes it with a separate client request (`cleanupEpiData`). Finalizing is what deactivates records absent from a Full-File Sync, sets the receipt to `complete` and records the `finalize` marker that Import Undo requires (ADR-0009).

The client owns the step between the two requests. If anything goes wrong after the last chunk is written and before cleanup succeeds (a 401 that sends the admin to the login screen, a 500, a lost network response, a closed tab), the Upload page forgets the Batch and has no way to finalize it. The receipt stays `uploading`. Once the admin imports again, the newer overlapping receipt makes cleanup of the old one refuse forever (Issue #144: three receipts stuck this way, two of them on 2026-11-12).

A sync that is written but never finalized leaves absent children active, and the Dashboard Summaries are not rewritten. If the stuck receipt is the latest written receipt of its table and Fiscal Year, Import Undo reports it as still uploading.

The cause of the 2026-11-12 failures is not confirmed. Session expiry cannot explain the second one, which came 90 seconds after a fresh 24-hour login. The design therefore has to hold for any failure between the two requests.

The design decisions were made in the grilling session on issue #144 (Q1–Q10).

## Decision

1. **Writing the last missing chunk finalizes the Batch in the same request, under the same import lock.** When every chunk of the Batch is written, `upsertEpiData` deactivates absent records (sync only), sets the receipt to `complete` with the `finalize` marker, writes the `cleanup_epi_data` audit event as before, and returns `finalized: true` with the `deactivated` count.
2. **The Upload page no longer calls `cleanupEpiData`.** The endpoint stays as an idempotent replay for clients still running the previous frontend. The backend is therefore deployed before the frontend.
3. **Finalizing can be repeated safely.** A resent finalizing chunk of a receipt that is still `uploading` with every chunk written finishes the finalize instead of replaying as a no-op. The `deactivated` count is the number of rows whose `deactivated_by_batch` is this Batch, not the rows changed in this attempt. A replay against a `complete` receipt, from either endpoint, returns the recorded `finalize.deactivated`.
4. **A receipt that never wrote every chunk stays `uploading`.** There is no new status and no resuming of the same Batch. The recovery is to import the file again as a new Batch.

Receipt fields and statuses are in `docs/hdc-column-upgrade.md`. Business behavior is in `docs/features.md`.

## Rationale

* Removing the gap between writing and finalizing works whatever the cause of the failure, and needs no client state that can be lost.
* Making an unfinalized import discoverable and finishable from the Upload page would add an endpoint, a UI and a new term for a gap that need not exist.
* A retry button that keeps the Batch only in page memory is lost on the same 401, logout or reload that causes the failure.
* Keeping the audit event and the `finalize` marker unchanged keeps Import Undo, the Audit Log and existing tests valid.

## Consequences

* After this change, `uploading` means that not every chunk is written. It can only arise for files of more than one chunk.
* If the finalizing chunk succeeds on the server but its response is lost, the admin sees a failure and imports again. The data stays correct, but the new Batch updates existing records and therefore cannot be undone (`updated_existing`, ADR-0009).
* One request now both writes a chunk and scans the table for deactivation, so it runs longer within the GAS execution limit.
* The receipts already stuck in `uploading` are left as they are. ADR-0007's note that pre-preflight receipts stuck in `uploading` must be re-imported still applies.
* The step that remains client-owned is writing the Dashboard Summaries after finalize. Summary Regeneration (`CONTEXT.md` §45) already recovers it.

## Alternatives Considered

* **A "finalize again" button that keeps the Batch in page memory.** Rejected: lost on the 401, logout or reload that causes the failure.
* **A server-discoverable unfinalized import with a "finish import" action, like an Unfinished Import Undo (ADR-0010).** Rejected: an endpoint, a UI and a term for a gap that the chosen design removes.
* **Mark stale `uploading` receipts as `abandoned`.** Rejected: a superseded receipt blocks nothing, and a status would add no information.
* **Keep calling `cleanupEpiData` after the last chunk.** Rejected: that request can fail after the import has completed and show the admin an error for a successful import.

## References

* `0007-mandatory-import-preflight.md`
* `0009-import-undo-is-exact-or-refused.md`
* `0010-import-undo-finishes-or-stays-unfinished.md`
* `../../CONTEXT.md` §27 Import, §28 Batch, §29 Full-File Sync, §45 Summary Regeneration
* `../features.md`, `../hdc-column-upgrade.md`
* `backend/src/Upload.js`: `upsertEpiData`, `cleanupEpiData`; `frontend/src/features/upload/hooks/useUploadManager.ts`: `confirmUpload`
* Issue #144
