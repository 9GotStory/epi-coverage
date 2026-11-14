# ADR-0014: The Facility Breakdown Is Not Public

* Status: Accepted
* Date: 2026-11-14
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

The Summary Dashboard (`/dashboard`) is public by intent (Issue #194). Its expanded age-group view lists every Facility with its passed and total counts, which come from the Facility Breakdown (`CONTEXT.md` §57) of each Dashboard Summary (§44). The public actions `getDashboardSummaries` and `getDashboardSummariesMultiYear` return it to any caller.

In View 2 the Facility Breakdown counts children. A count such as "1 of 3 did not pass" in a small Facility can let someone with local knowledge identify a child. The public summaries of Fiscal Year 2569, measured on 2026-11-14 (counts of Facilities only, no records kept), show how common this is:

* Whole-year View 2: 1–5 of 16–17 Facilities per Age Group had fewer than 5 children, and 7–12 had fewer than 10.
* Quarter View 2: 9–14 of 12–17 Facilities per Age Group had fewer than 5 children.
* View 1 counts doses, so its cells are larger, but the 3-year and 5-year groups still had cells under 5.

The district totals are public as well, so hiding one Facility's counts is undone by subtracting the visible Facilities from the district total.

The design decisions were made in the grilling session on issue #197.

## Decision

1. **The Facility Breakdown is returned only to a caller with a valid token** (an approved account, any Role). It covers every Facility, as the own-facility rule applies to Individual EPI Records only (Issue #194).
2. **The server enforces it.** `getDashboardSummaries` and `getDashboardSummariesMultiYear` stay public. With no token they return the summaries without the Facility Breakdown. With a valid token they include it. With a token the server no longer accepts they answer 401, which is a Session End (§51).
3. **Everything else on the Summary Dashboard stays public**: district totals, district per-vaccine counts and Coverage Goals.
4. **HDC OpenData is out of scope.** Its rows per `hospcode` are published by the Ministry itself, so passing them on through `getOpenData` discloses nothing new.
5. **The browser drops every cached query when the signed-in state changes**: sign-in, Sign-out and Session End. Otherwise a Facility Breakdown fetched while signed in stays on the public page after Sign-out.

What the public page shows in place of the Facility Breakdown is defined in `docs/features.md` §3.5.

## Rationale

* With the measured cell sizes, a small-cell threshold would hide nearly every Facility in a quarter view and a third of them in some whole-year views. Each suppressed cell would also need a second suppressed cell against the public district total. The result would be complex and would leave little to show.
* Withholding the whole Facility Breakdown fails closed, needs no threshold to maintain, and keeps the per-Facility comparison for the staff who act on it.
* Answering 401 to a rejected token keeps one meaning for a stale token, Session End, and lets the page rely on its own signed-in state. A signed-in page always receives the Facility Breakdown or a 401, so it never mistakes a withheld Facility Breakdown for a legacy summary without one.

## Consequences

* An anonymous viewer can no longer compare Facilities on the Summary Dashboard; `docs/features.md` §1 and §3.5 change accordingly.
* Every call to the two summary actions with a token now reads the session store.
* A Facility-level field added to a Dashboard Summary later falls under this rule as part of the Facility Breakdown.

## Alternatives Considered

* **No rule.** Rejected: small View 2 cells in a public page can identify a child, and "ยังไม่ผ่านเกณฑ์" would be read as unvaccinated.
* **Small-cell suppression at a threshold.** Rejected for the reasons above.
* **Public Facility Breakdown for the whole year only.** Rejected: whole-year View 2 still has cells under 5 children.
* **A separate token-only action for the Facility Breakdown.** Rejected: it changes the Router and every consumer for no gain over filtering the existing actions.
* **Silently serving the public shape to a rejected token.** Rejected: the signed-in page could not tell a withheld Facility Breakdown from a missing one.

## References

* `../../CONTEXT.md` §44 Dashboard Summary, §51 Session, §54 Imported-Data Evaluation, §57 Facility Breakdown
* `../features.md` §1, §3.5
* `backend/src/Router.js`, `backend/src/DashboardCache.js`
* `frontend/src/shared/components/AgeGroupExpandedView.tsx`, `frontend/src/shared/contexts/AuthContext.tsx`
* Issues #194, #197
