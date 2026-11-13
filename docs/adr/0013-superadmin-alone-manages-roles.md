# ADR-0013: Superadmin Alone Manages Roles; No One Changes Their Own Row

* Status: Accepted
* Date: 2026-11-13
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

The Role set has `admin` and `superadmin` (`CONTEXT.md` §35), but before Issue #166 the server gave them identical capability everywhere. `updateUserStatus` and `updateUserFacility` accepted any change from either Role, to any row. An `admin` could therefore set any Role, including `superadmin` on their own row, and could demote or suspend a `superadmin`. Only the UI blocked edits to one's own row.

`docs/features.md` §1 said a Super Admin approves pending users, while the code and UI have always let `admin` approve.

No code path creates a `superadmin`: `createUser` always writes `user`/`pending`, and setup seeds no users. A `superadmin` exists only through a manual edit of the Users sheet.

The design decisions were made in the grilling session on issue #166.

## Decision

1. **Only `superadmin` changes a Role.** A `superadmin` may set any Role on another row, including demoting or suspending another `superadmin`.
2. **`admin` changes only rows whose Role is exactly `user`**: their Approval Status and facility. A row whose Role is `admin`, `superadmin`, or any value outside the Role set needs a `superadmin` (fail closed).
3. **No one changes their own row**, whatever their Role: Approval Status, Role and facility.
4. **A refused request is refused whole**: nothing is written and nothing is audited. A request from an `admin` that supplies a Role is refused, even when it equals the current Role.
5. The server enforces all of this. The UI hides the actions the server would refuse, but adds no new Role actions.

What each Role allows is stated in `docs/features.md` §1.

## Rationale

* The real exposure was privilege escalation: an `admin` raising themselves to `superadmin`, or locking a `superadmin` out. Approving facility staff is routine work admins already do, so it stays with `admin`.
* With rules 1 and 3 together, the application can never reduce the number of `superadmin` rows to zero: only a `superadmin` can change a `superadmin` row, and the actor cannot change their own, so the actor always remains.
* Refusing one's own row also prevents an accidental self-suspension, which the user could not undo by signing in again.

## Consequences

* Granting or revoking `admin` needs a `superadmin`. If no `superadmin` exists, the Spreadsheet owner must set one in the Users sheet.
* Changing one's own row needs another admin or `superadmin`, or a manual sheet edit.
* Promoting to `superadmin` and demoting have no UI. They are server-supported for `superadmin` callers only.
* Every other admin capability (import, Import Undo, vaccine rules, facilities, data scope) stays identical for `admin` and `superadmin`.

## Alternatives Considered

* **Only `superadmin` manages users at all, approval included**, as `docs/features.md` §1 read. Rejected: with one `superadmin` at the district office, no one else could approve new staff.
* **Remove `superadmin` from the Role set.** Rejected: it changes the Role vocabulary, schema and existing data, and leaves no Role able to guard Role changes.
* **Keep both Roles equal and fix only the documentation.** Rejected: it leaves self-escalation open.

## References

* `../../CONTEXT.md` §33 User, §34 Approval Status, §35 Role
* `../features.md` §1
* `backend/src/Router.js`, `backend/src/Auth.js`: `updateUserStatus`, `updateUserFacility`
* `frontend/src/features/admin/components/columns.tsx`
* Issues #158, #162, #166
