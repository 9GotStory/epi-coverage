# task.md Reconciliation — Evidence Record

This document is an **evidence record of the legacy-roadmap reconciliation**. It is **not the active backlog**.

- **Active tracker**: GitHub Issues becomes the active work tracker after the approved STILL NEEDED work is migrated (see `docs/agents/issue-tracker.md`).
- **Legacy source**: `task.md` remains the untouched legacy source during this step. It is not modified by this reconciliation.
- **Method**: classifications were derived from current canonical documentation (`CLAUDE.md`, `CONTEXT.md`, `docs/features.md`, `docs/schema.md`, `docs/spec.md`, `docs/adr/`, `docs/hdc-column-upgrade.md`, `docs/hdc-record-display.md`), the current implementation (`backend/src/`, `frontend/src/`), and verification evidence (`backend/tests/`, `frontend/src/**/*.test.*`). Checkbox state in `task.md` was never used as classification evidence.
- **Baseline**: `main` at commit `89ca5ba0e7bf444504a4586b803d26ff4c2bba81`.
- **Date**: 2026-09-11.

---

## 1. Executive summary

| Metric | Count |
|---|---|
| Legacy items reviewed (every checkbox line in `task.md`) | 86 |
| DONE | 65 |
| STILL NEEDED | 13 |
| OBSOLETE | 1 |
| SUPERSEDED | 7 |
| Verification-gap entries (tracked separately, §4) | 6 |
| Documented-pending / external-confirmation items (tracked separately, §8) | 3 |
| Genuine current contradictions (§5) | 2 (C1, C2) |
| task.md items unchecked but actually implemented | 3 (1.9, 1.11, 1.14) |

65 + 13 + 7 + 1 = 86.

Headline: `task.md` describes a cid-keyed, soft-delete-on-upload, hard-coded-rules, computed-Fully-Immunized system. The repository at the baseline is a composite-key, sync-mode-only-deactivation, config-driven-rules, HDC-`result`-authoritative system with substantial automated coverage on the import path. All five unchecked Phase 1 capabilities have implementations, but only 1.9, 1.11, and 1.14 are fully DONE; 1.10 and 1.13 remain partially STILL NEEDED. The real open work is: two security/audit contradictions (C1, C2), the never-executed Phase 8 verification pass, and a handful of small functional gaps.

## 2. Evidence and classification rules

### Classification definitions

- **DONE** — the required behavior is demonstrably present in the current implementation and consistent with canonical documentation.
- **STILL NEEDED** — valid current work remains. Partial classifications are used where part of a compound requirement is satisfied and part is not.
- **OBSOLETE** — no longer needed, with no replacement behavior required.
- **SUPERSEDED** — replaced by newer documented behavior; no implementation work follows.

### Evidence model (locked in this reconciliation)

1. Automated coverage is the preferred evidence for DONE.
2. Implemented behavior lacking appropriate automated coverage stays DONE **and** spawns a separate STILL NEEDED verification-gap entry (§4).
3. A task that is itself a testing/verification task is DONE only when that required check has actually been executed and passed.
4. Documentation-only items are DONE when the canonical document exists and matches current behavior.
5. Manual code inspection is not treated as equivalent to an automated check where an automated check is the point of the task.
6. Genuine manual/UAT requirements are never silently converted into automated-test requirements.
7. A checked legacy checkbox alone is not evidence that a verification task was executed.

### Contradiction policy

- Mere staleness (task.md wording replaced by mutually consistent canonical docs + implementation) → SUPERSEDED, citing the canonical replacement; no issue is created for old wording.
- Current canonical sources and/or implementation genuinely disagree → recorded as ⚠️ CONTRADICTION (§5); no winner is chosen silently; a "resolve contradiction" candidate issue carries it.
- ADRs are created only when resolving a contradiction requires a meaningful, hard-to-reverse architectural decision.

### Confidence scale

HIGH = direct file:line evidence from implementation, tests, or canonical docs. MEDIUM = strong indirect evidence; one aspect not line-verified. LOW = historical claim that cannot be re-verified.

### Verification status codes

✅ automated coverage exists · ⚠️ gap→VG# (§4) · — no coverage, none required for the classification · n/a.

## 3. Full reconciliation (86 items)

### Phase 0 — Project Setup

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 0.1 | Vite + React + TS | DONE | impl: `frontend/package.json`, `frontend/vite.config.ts` | — | none | HIGH |
| 0.2 | Dependencies | DONE | impl: `frontend/package.json:19-41` (`@react-oauth/google`, `@tanstack/react-table`, `recharts`, `jspdf`, `jspdf-autotable`; SheetJS in `shared/exportUtils.ts:14-42`) | — | none | HIGH |
| 0.3 | Tailwind v4 + shadcn | DONE | impl: `frontend/src/**/components/ui/*` (shadcn-style), DESIGN.md tokens | — | none | MED |
| 0.4 | FSD structure | DONE | impl: `frontend/src/{app,features,pages,shared,widgets}` all populated | — | none | HIGH |
| 0.5 | `.env.example` + `.gitignore` | **STILL NEEDED** (partial — compound requirement; one artifact missing) | `.gitignore:72-74`, `frontend/.gitignore:14-15` present; `.env.example` absent (repo-wide find: no match) | — | Issue #18 | HIGH |
| 0.6 | Router + lazy load | DONE | impl: `frontend/src/app/router.tsx:1-19` (`createBrowserRouter`, `lazy`) | — | none | HIGH |
| 0.7 | QueryClient | DONE | impl: `frontend/src/main.tsx` (`QueryClientProvider`) | — | none | HIGH |
| 0.8 | Type definitions | DONE | impl: `frontend/src/shared/types/index.ts` (`dtp5_date`:65, `opv5_date`:78) | — | none | HIGH |

### Phase 1 — GAS Backend

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 1.1 | Six sheets | SUPERSEDED | docs: `docs/schema.md` §1–10 — now 10+ sheets (Epi_2/3/5_Year, `vaccine_rules`, `epi_import_batches`, `opendata_cache`); impl: `backend/src/Setup.js:6-53` | — | none | HIGH |
| 1.2 | Headers per schema + plain text | SUPERSEDED | docs: `docs/hdc-column-upgrade.md` column contract; impl: `backend/src/Upload.js:34-38`, `Setup.js:80-88,140-148` (`setNumberFormat('@')`, broadened to 5-char codes) | ⚠️ VG1 | none | HIGH |
| 1.3 | `doGet` router | DONE | impl: `backend/src/Router.js` action dispatch | — | none | HIGH |
| 1.4 | `doPost` router | DONE | impl: `backend/src/Router.js` | — | none | HIGH |
| 1.5 | JWT verify | DONE | impl: `backend/src/Auth.js:112-166` server-side token verification; docs: `docs/spec.md:23-25` | — | none | HIGH |
| 1.6 | `getUserByGoogleId` | DONE | impl: `backend/src/Auth.js` login flow | — | none | HIGH |
| 1.7 | `createUser` (pending) | DONE | impl: `backend/src/Router.js:28` public-by-design, status `pending` | — | none | HIGH |
| 1.8 | approve/reject merged into `updateUserStatus` | DONE | impl: admin action list `Router.js:56-64`, `Auth.js` | — | none | HIGH |
| 1.9 | `getFacilities` | **DONE** (task.md unchecked — mislabel) | impl: `backend/src/Data.js:4-15`, `Router.js:74` | ⚠️ VG5 | none | HIGH |
| 1.10 | `uploadEpiData` | **STILL NEEDED** (partial; legacy semantics partly SUPERSEDED) | Implemented as `upsertEpiData` + `cleanupEpiData` (`Router.js:70-71`, admin-only); composite key `Upload.js:1-11`; single `setValues()` write `:32-42`; `'@'` identifier formats `:34-38`; `epi_import_batches` receipts `:25-30`; sync-only scoped soft-deactivation `:157-171`; tests: `backend/tests/hdc-import.test.cjs` (19 tests). **Unresolved current requirement:** canonical schema requires upload/import audit coverage (`docs/schema.md:82-90`); `upsertEpiData` writes no audit entry; `cleanup_epi_data` finalization logging does not satisfy import audit coverage. Recorded SUPERSEDED sub-behaviors: upsert-by-CID → composite key; unconditional soft-delete-on-upload → scoped sync-mode soft-deactivation | ✅ (import path) | Issue #2 (C1) | HIGH |
| 1.11 | `getEpiData` | **DONE** (task.md unchecked — mislabel) | impl: `backend/src/Data.js:109-124`, `getAuthorizedEpiData:350-356` (server-enforced facility scope) | ✅ (scope + 401) | none | HIGH |
| 1.12 | `updateUserStatus` | DONE | impl: `Router.js:56-64`, `Auth.js` | — | none | HIGH |
| 1.13 | `getAuditLogs` (filter by email/action) | **STILL NEEDED** (partial / contract decision required) | impl: `Data.js:241-253` admin-only, returns all logs; `Router.js:75` passes `email`/`actionType` but the implementation ignores both; frontend `AuditLogsTab.tsx:13-30` does client-side search. No canonical source documents a deliberate move of filtering to the frontend, so SUPERSEDED cannot be applied without silent inference | ⚠️ VG5 | Issue #15 | MED |
| 1.14 | `getOpenData` proxy | **DONE** (task.md unchecked — mislabel) | impl: `backend/src/OpenData.js:174-203` cache-first, `:6-56` CORS proxy + 6h cache, nightly ETL `:62-169`; docs: `docs/spec.md:26`, ADR-0001:41 | ⚠️ VG4 | none (cleanup note: dead `amp` branch `Router.js:44` → Issue #16) | HIGH |
| 1.15 | GAS Web App deploy | DONE | impl: `backend/deploy.sh`, `backend/.clasp.json`; docs: `docs/hdc-column-upgrade.md:61-68` runbook | — | none | HIGH |

### Phase 2 — Authentication (all DONE, no migration)

| ID | Legacy item | Class | Evidence | Verif | Conf |
|---|---|---|---|---|---|
| 2.1 | Google OAuth login | DONE | impl: `LoginScreen.tsx:13-55` | ⚠️ VG3 | HIGH |
| 2.2 | Post-login status routing | DONE | impl: `LoginScreen.tsx:30-40` (new/pending/approved/rejected) | ⚠️ VG3 | HIGH |
| 2.3 | First-time setup + facility selection | DONE | impl: `FirstTimeSetup.tsx:24-39,47-81,100-112` | ⚠️ VG3 | HIGH |
| 2.4 | AuthContext / useAuth | DONE | impl: `AuthContext.tsx:14-85` (+401 listener, logout `:53-62`) | ⚠️ VG3 | HIGH |
| 2.5 | ProtectedRoute role guard | DONE | impl: `ProtectedRoute.tsx:10-43`; `router.tsx:57-101` | ⚠️ VG3 | HIGH |
| 2.6 | Pending screen | DONE | impl: `PendingScreen.tsx:4-33` | ⚠️ VG3 | HIGH |
| 2.7 | Session + logout | DONE | impl: `AuthContext.tsx:22-44,53-62`; server sessions `Auth.js:315-329` | ⚠️ VG3 | HIGH |

### Phase 6 — Admin Panel

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 6.1 | User management | DONE | impl: `AdminDashboard.tsx:30-48,50-70`, `columns.tsx:158-187` | — | none | HIGH |
| 6.2 | Facilities add/edit/toggle | **STILL NEEDED** (partial) | impl: add + `is_active` toggle exist (`FacilitiesTab.tsx:59-75,77-105,118-158`); no rename/edit form | — | Issue #14 | MED |
| 6.3 | Audit logs viewer | DONE | impl: `AuditLogsTab.tsx:13-30` (searchable DataTable) | — | none | HIGH |

### Phase 3 — Upload (all DONE, no migration)

| ID | Legacy item | Class | Evidence | Verif | Conf |
|---|---|---|---|---|---|
| 3.1 | Drag & drop upload | DONE | impl: `UploadDashboard.tsx:33-42` | ✅ | HIGH |
| 3.2 | Browser-side parsing, string coercion, `<NA>`→null | DONE | impl: `parseHdcFile.ts:16-22`, `uploadHelpers.ts:57,64-77` (`padStart` normalization) | ✅ `parseHdcFile.test.ts:14-17` | HIGH |
| 3.3 | Preview before upload | DONE | impl: `UploadDashboard.tsx:240-289` | — | HIGH |
| 3.4 | Required-columns validation | DONE | impl: `uploadHelpers.ts:135-141` (zod), `parseHdcFile.ts:31-57` | ✅ `parseHdcFile.test.ts` | HIGH |
| 3.5 | Batch send to API | DONE | impl: `useUploadManager.ts:15,84-97` (chunks of 500) | ✅ | HIGH |
| 3.6 | Progress / result display | DONE | impl: `UploadDashboard.tsx:228-238,152-174` | — | HIGH |

Beyond legacy scope (not counted): fiscal-year dropdown (`UploadDashboard.tsx:60-81`), target-age-group selector (`:85-130`), merge/sync import mode (`:132-142`), dashboard re-sync tool (`:310-340`).

### App Shell (all DONE, no migration)

| ID | Legacy item | Class | Evidence | Conf |
|---|---|---|---|---|
| L.1 | GlobalNav / SubNav | DONE | impl: `frontend/src/widgets/layout/GlobalNav.tsx`, `SubNav.tsx` | HIGH |
| L.2 | AppLayout (FSD circular-dependency avoidance) | DONE | impl: `frontend/src/app/layouts/AppLayout.tsx` | HIGH |
| L.3 | AppLayout wraps routes | DONE | impl: `router.tsx:4,50` | HIGH |
| L.4 | NavLink active state | DONE | impl: GlobalNav (present per exploration) | MED |
| L.5 | Mobile responsive hamburger | DONE | impl: GlobalNav (present per exploration) | MED |

### Phase 4 — EPI Dashboard

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 4.1 | Fetch filtered data | DONE | impl: `useEpiData.ts:20,28` | — | none | HIGH |
| 4.2 | Age in months | DONE | impl: `ruleEngine.ts:19-29` (`getAgeInMonths`) | ⚠️ VG2 | none | HIGH |
| 4.3 | Hard-coded age schedules | SUPERSEDED | impl: `evaluateDynamicV1` `ruleEngine.ts:150-218` with backend rules; docs: `docs/hdc-column-upgrade.md:32` ("no frontend hard-coded list") | ✅ | none | HIGH |
| 4.4 | Rota rv2x/rv3x special case | SUPERSEDED | impl: generic `BRANCH` + `branch_alt_fields` `ruleEngine.ts:192-201` (rule data, not code) | ✅ `ruleEngine.test.ts:263-267` | none | HIGH |
| 4.5 | Virtual list table | DONE | impl: `EpiDataTable.tsx:4,30-40` (react-virtual); react-table in admin `data-table.tsx` | — | none | HIGH |
| 4.6 | Filters: facility + missing-vaccine type | **STILL NEEDED** (partial) | impl: facility scope server-enforced (`Data.js:350-356`), FY/quarter filters on dashboards; no missing-vaccine-type filter found on View 1 surfaces | — | Issue #11 | MED |
| 4.7 | "As of" date | DONE | impl: as-of strings in `UploadDashboard` + all four `EpiDashboard*` + `View1AgeRecords`; source is summaries/upload metadata, not `audit_logs` as legacy wording said | — | none | MED |
| 4.8 | Compute Fully Immunized | SUPERSEDED | docs: `CONTEXT.md:202-204`, `docs/hdc-record-display.md:5`, ADR-0002:98-106 — imported HDC `result` is the display authority; impl: `HdcRecordsView` renders `result` verbatim (`EpiDashboard.tsx:116`); internal V2 computation (`ruleEngine.ts:224-305`) deliberately retained for summaries only | ✅ (generic V2) | none (residual test debt → Issue #9) | HIGH |
| 4.9 | Coverage summary | DONE | impl: upload-time V2 summaries (`useUploadManager.ts:109-128`), `Dashboard.tsx:128-154` | — | none | HIGH |
| 4.10 | Excel export | DONE | impl: `HdcRecordsView.tsx:80`, `View1AgeRecords.tsx:101`, `exportUtils.ts:14-42` | ✅ `hdcData.test.ts:46-52` (leading zeros preserved) | none | HIGH |
| 4.11 | PDF export | DONE | impl: `HdcRecordsView.tsx:81-89`, Sarabun font, autotable | — | none | HIGH |

### Phase 5 — OpenData Dashboard

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 5.1 | Proxy fetch `s_epi1` | DONE | impl: `openDataApi.ts:3-17` (s_epi1..5, s_epi_complete), `useOpenData.ts:4-12` | ⚠️ VG4 | none | HIGH |
| 5.2 | Bar chart monthly/quarterly | SUPERSEDED | impl: `CoverageBarChart` → `CumulativeCoverageChart` (commit cafbb0d) + `VaccineGaugeGrid`/`VaccineRadarChart`, wired `OpenDataDashboard.tsx:379-384,435-439` | — | none | HIGH |
| 5.3 | Filters FY/month/quarter/facility | **STILL NEEDED** (partial) | impl: FY `:218-227`, quarter `:232-246`, facility `:250-267`; no month selector (monthly only as chart granularity) | — | Issue #13 | MED |
| 5.4 | Individual vs OpenData comparison | **STILL NEEDED** (absent) | impl: numbers in separate tabs; only a text note (`OpenDataDashboard.tsx:211-212`); no comparison surface; docs: ADR-0002:57,77,96 requires provenance-explicit comparison | — | Issue #10 | HIGH |

### Phase 7 — UI/UX Polish

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 7.1 | Responsive design | DONE | impl: dashboards + mobile nav | — | none | MED |
| 7.1a | types `dtp5_date`/`opv5_date` | DONE | impl: `types/index.ts:65,78` | — | none | HIGH |
| 7.1b | `Epi_5_Year` sheet setup | DONE | impl: `Setup.js` schemas; docs: `docs/schema.md` §10 | — | none | HIGH |
| 7.1c | `chartUtils.ts` `formatEpi1AllVaccines` | SUPERSEDED | function no longer exists; chart aggregation is `formatCompleteDataForChart` (`frontend/src/features/opendata/utils/chartUtils.ts:114`) after the cafbb0d redesign | — | none | MED |
| 7.1d | `VaccineGaugeGrid.tsx` | DONE | impl: `VaccineGaugeGrid.tsx:1,38-51` | — | none | HIGH |
| 7.1e | `VaccineRadarChart.tsx` | DONE | impl: `VaccineRadarChart.tsx:1-9` | — | none | HIGH |
| 7.1f | Wire components into OpenDataDashboard | DONE | impl: `OpenDataDashboard.tsx:379-384,435-439` | — | none | HIGH |
| 7.1g | "Verify UI layout and data accuracy" | **STILL NEEDED** (manual/UAT) | checked checkbox is the only evidence; no retained verification artifact exists → fails evidence rule 7 | — | attach to Issue #7 | LOW |
| 7.2a | `calcGroupSummary` → `facilityBreakdownV1` | DONE | impl: `dashboardLogic.ts:11,141,164` | — | none | HIGH |
| 7.2b | `AgeGroupSection` → Tabs | DONE | impl: `AgeGroupExpandedView.tsx:2,121-125` | — | none | HIGH |
| 7.2c | TabsContent view1 | DONE | impl: same file | — | none | MED |
| 7.2d | TabsContent view2 | DONE | impl: same file | — | none | MED |
| 7.2e | "Verify UI rendering" | **STILL NEEDED** (manual/UAT) | checked checkbox is the only evidence; no retained artifact → fails evidence rule 7 | — | attach to Issue #7 | LOW |
| 7.2f | Update `walkthrough.md` | OBSOLETE | `walkthrough.md` does not exist anywhere in the repository (find: no matches) | — | none | HIGH |
| 7.5 | Empty state | DONE | impl: `EmptyState.tsx` + "ไม่มีข้อมูล" in six surfaces | — | none | HIGH |
| 7.6 | Error boundary | DONE | impl: `GlobalErrorBoundary.tsx` + router `errorElement` | — | none | HIGH |

### Phase 8a — Testing & Deploy

| ID | Legacy item | Class | Evidence | Verif | Migration | Conf |
|---|---|---|---|---|---|---|
| 8.1 | Real-Excel upload UAT | **STILL NEEDED** (manual/UAT) | no record of execution; backend now receives JSON chunks, so a real-file end-to-end test remains valid UAT | — | Issue #6 | HIGH |
| 8.2 | Leading-zero check (06422/00588/11170) | DONE | test: `parseHdcFile.test.ts:14-17`, `hdcData.test.ts:46-52` — executed in the suite; scope since broadened to 5-character codes incl. `AE123` (`docs/hdc-column-upgrade.md:9`); residual live-sheet check folds into Issue #6; backend `'@'` application unasserted → VG1 | ⚠️ VG1 | none | MED |
| 8.3 | Soft-delete test | DONE | test: `backend/tests/hdc-import.test.cjs:115-135` — sync-mode scope, merge-never-deactivates, executed | ✅ | none | HIGH |
| 8.4 | FI HBV test cases | **STILL NEEDED** | no HBV multi-dose V2 scenario exists (grep: only hbv1 birth-dose cases) | — | Issue #9 | HIGH |
| 8.5 | GAS proxy OpenData CORS test | **STILL NEEDED** (integration) | `backend/src/OpenData.js` has no tests; live MOPH API involved | — | Issue #8 | HIGH |
| 8.6 | Build production + deploy | **STILL NEEDED** (deployment) | no `.github/`, no wrangler/CNAME, `vite.config.ts` has no `base`; only `frontend/public/_redirects` (Cloudflare-Pages convention) — hosting configured out-of-band; `docs/spec.md:7` allows GitHub Pages or Cloudflare Pages | — | Issues #3 (CI) + #4 (hosting) | HIGH |

### Phase 8b — Multi-Year Scope Upload (all DONE, no migration)

| ID | Legacy item | Class | Evidence | Conf |
|---|---|---|---|---|
| 8.1b | Fiscal-year dropdown | DONE | impl: `UploadDashboard.tsx:60-81` | HIGH |
| 8.2b | `fiscalYear` in payload | DONE | impl: `useUploadManager.ts` | HIGH |
| 8.3b | Router receives fiscalYear | DONE | impl: `backend/src/Router.js` (FY + `targetTable`) | HIGH |
| 8.4b | Upload.js fiscal-year scoping | DONE | impl: `Upload.js:1-11` (FY in composite key; `fiscal_year` column) | HIGH |
| 8.5b | schema.md `fiscal_year` | DONE | docs: `docs/schema.md:43` | HIGH |

Note: per-year sheets were later removed in favor of a `fiscal_year` column — see Issue #12 for the leftover `getAvailableYears` path.

## 4. Verification gaps (VG1–VG6)

Tracked separately from the 86 legacy classifications. Verification gaps are independent evidence gaps and may attach to a DONE behavior, a partially STILL NEEDED behavior, or a contradiction fix. They do not change the legacy-item counts.

| # | Type | Gap | Attached issue |
|---|---|---|---|
| VG1 | automated-test | Backend test mock's `setNumberFormat` is a no-op stub — nothing asserts `'@'` is applied to identifier columns; zeros cannot be lost in-mock (`backend/tests/hdc-import.test.cjs:35`) | #6 |
| VG2 | automated-test | No direct unit test of `getAgeInMonths` (only indirect via PENDING-classification test) | #17 |
| VG3 | integration-test | No automated tests for auth flows (login status routing, guards, 401 handling) | #17 |
| VG4 | integration-test | `backend/src/OpenData.js` has no tests: cache fallback, retention-on-failure, nightly ETL | #17 |
| VG5 | automated-test | `getFacilities` / `getAuditLogs` untested | #17 |
| VG6 | automated-test | Router 403 admin gate untested; regression tests must accompany the C2 fix | #1 (required) |

Manual/UAT items (8.1 → #6) and deployment verification (8.6 → #3/#4) remain manual per the evidence model — not converted into automated-test requirements.

## 5. Contradiction register

### ⚠️ C1 — audit coverage of EPI import

- **Topic**: `audit_logs` coverage of the import path.
- **Source A**: `docs/schema.md:82-90` — `audit_logs` records login/upload/approve/export actions; the audit contract includes uploads.
- **Source B**: `backend/src/Upload.js` — `upsertEpiData` writes no `logAction` entry; only `cleanupEpiData` logs (`cleanup_epi_data`, `Upload.js:174`).
- **Current implementation**: matches Source B — merge imports leave no audit trace; only sync finalizations are logged.
- **Existing test behavior**: none asserts audit content for imports.
- **Operational/data-integrity impact**: who imported which batch is partially unauditable — a traceability gap in a health-data system.
- **Proposed reconciliation issue**: Issue #2.
- **ADR required**: NO — behavior alignment, no architectural choice.

### ⚠️ C2 — server-side authorization enforcement on non-core actions

- **Topic**: fail-closed server-side authorization outside the core read/import path.
- **Source A**: `docs/spec.md:23-25`, ADR-0001:83, `CLAUDE.md` §7 — authorization is enforced by the backend security architecture, not frontend state; fail closed.
- **Source B**: `backend/src/Router.js` (public action list `:28-29`; login-only actions `:80-82`) —
  - `forceSyncOpenData` and `setupOpenDataTrigger` are public actions despite mutating/scheduling server-side state;
  - `updateLastLogin` is a public mutating action accepting a caller-supplied `googleId` — authorization/integrity review point (no canonical source found proving that public mutation is intentional);
  - `saveAiAnalysis` and `analyzeVaccineData` require authentication but are not facility-scoped against `authResult` before writing the record identified by the caller-supplied composite key;
  - their audit/`adminEmail` identity is caller-supplied rather than derived from `authResult` — part of the same server-side authorization/audit-integrity problem;
  - `deleteSession` requires authentication but deletes the supplied session id without verifying that the authenticated user owns that session — a session-ownership authorization gap, distinct from the facility-scope/composite-key gaps above;
  - public `getVaccineRules` discloses inactive rules — explicit review point only, not a proven contradiction unless canonical policy settles it.
- **Current implementation**: matches Source B. (`createUser` public is by design — pending-status first-login flow. `getUsers` is admin-gated via `adminActions` and is not part of this contradiction.)
- **Existing test behavior**: `hdc-import.test.cjs:164-172` covers 401-unauthenticated for PII endpoints only; these gaps are untested.
- **Operational/data-integrity impact**: any internet caller can trigger the OpenData ETL or create script triggers (resource abuse / sheet churn) and can mutate `last_login` for an arbitrary `googleId`; any approved user can write AI analysis to other facilities' records and attribute it to a caller-chosen `adminEmail` (cross-facility data integrity, privacy, and audit-identity forgery); any authenticated user can delete another user's session.
- **Proposed reconciliation issue**: Issue #1.
- **ADR required**: NO — alignment to documented architecture.

No other genuine contradictions were identified in record identity, import/sync semantics, soft-deactivation, View 2 authority, vaccine-rule ownership, or the core EPI read-scope behavior already enforced by `getAuthorizedEpiData`; task.md's divergent wording there is staleness (§6), not conflict.

## 6. Superseded legacy behavior

| Legacy behavior | Canonical replacement | Why no implementation issue |
|---|---|---|
| Upsert by `cid` (1.10 sub-behavior) | Composite key `fiscal_year + hoscode + (pid\|cid) + sex + birth + check_vhid`; masked CID forbidden as a person key (`docs/features.md:16`, `docs/hdc-column-upgrade.md:10-13`, `Upload.js:1-11`) | Code and docs agree; only task.md wording is old |
| Unconditional soft-delete-on-upload (1.10 sub-behavior) | Additive by default; soft-deactivation only on a completed sync-mode batch, scoped to the validated year × facilities-in-batch (`docs/features.md:18`, `docs/hdc-column-upgrade.md:23`, `Upload.js:157-171`); canonical term **soft-deactivation**, `is_active` storage (`CONTEXT.md` §30) | Implemented and tested (`hdc-import.test.cjs:115-135`) |
| Hard-coded View 1 schedules + Rota special case (4.3, 4.4) | Backend-owned `vaccine_rules`, `evaluateDynamicV1`, `BRANCH` logic (ADR-0003, `docs/hdc-column-upgrade.md:32`) | Implemented and tested |
| Computed Fully Immunized as the displayed result (4.8) | Imported HDC `result` is authoritative for displayed View 2 per-child records; internal computation is retained only for summaries, documented as such (`CONTEXT.md:202-204`, `docs/hdc-record-display.md:5,21`, ADR-0002:98-106, ADR-0003:117-131) | Deliberate, documented; residual internal-V2 test debt is Issue #9 |
| Six-sheet / per-sheet-header design (1.1, 1.2) | Current 10+ sheet schema incl. multi-year, rules, receipts (`docs/schema.md` §1–10) | One-time setup superseded |
| `CoverageBarChart` monthly bar (5.2) | `CumulativeCoverageChart` + gauge/radar set (commit cafbb0d) | UI evolution recorded in git history |
| `formatEpi1AllVaccines` in shared chartUtils (7.1c) | `formatCompleteDataForChart` in `frontend/src/features/opendata/utils/chartUtils.ts:114` post-redesign | Same |

## 7. Candidate GitHub Issues (#1–#18)

Proposed only — none created. Continuous numbering; priority groups are ordering guidance, not labels.

### P0 — correctness / security / data-integrity

**#1 — Close server-side authorization and audit-identity gaps** [C2 + VG6]
Unauthenticated `forceSyncOpenData` and `setupOpenDataTrigger` (public actions that mutate/schedule server-side state); public mutating `updateLastLogin` accepting a caller-supplied `googleId` — review/fix; cross-facility `saveAiAnalysis`/`analyzeVaccineData` authorization (facility-scope check against `authResult` before writing the caller-supplied composite-key record); authenticated actor identity in audit entries must come from `authResult` rather than the caller-supplied `adminEmail`; `deleteSession` session-ownership enforcement (verify the authenticated user owns the supplied session id); public `getVaccineRules` inactive-rule disclosure as a review point. Regression tests required (VG6).

**#2 — `upsertEpiData` must write an `audit_logs` entry** [C1]
Per the `docs/schema.md:82-90` audit contract; finalization logging (`cleanup_epi_data`) is not import audit coverage.

### P1 — production readiness / verification

**#3 — CI pipeline**
Independently actionable now, not blocked on any hosting decision: `cd frontend && npm test && npm run lint && npm run build`; `cd backend && npm test` (canonical commands, `CLAUDE.md` §11). No `.github/` exists today.

**#4 — Hosting/deployment decision + configuration** [8.6]
GitHub Pages vs Cloudflare Pages (`docs/spec.md:7` permits both; `frontend/public/_redirects` suggests Cloudflare configured out-of-band); `vite.config.ts` lacks `base`; no deploy configuration in-repo.

**#5 — Execute production-migration runbook**
`docs/hdc-column-upgrade.md:61-68`: backup, deploy order preserving the `/exec` URL, `setupDatabase()`/admin setup, additive re-import, dashboard reprocessing, QA. Kept in production-readiness because #6/#4 depend on it.

**#6 — Real-file UAT import E2E** [8.1 + 8.2 residual + VG1]
`วัคซีน 1 ปี.xlsx` through parse → chunk → import; live-sheet leading-zero spot-check; VG1 (assert `'@'` application in backend tests).

**#7 — UI/UAT verification pass** [reclassified 7.1g + 7.2e]
Dashboard layout and data-accuracy verification against current dashboards; absorbs both legacy verify items.

**#8 — GAS↔OpenData live integration verification** [8.5]
Scope: verify the deployed GAS proxy can reach the live MOPH OpenData endpoint successfully through the browser/application path, including expected CORS behavior and response handling. **Out of scope:** cache-fallback, retention-on-failure, and nightly-ETL automated coverage — those remain VG4 under Issue #17.

**#9 — FI HBV regression tests — internal V2 only** [8.4] — *ready-for-agent*
Test the internal V2 summary/rule-evaluation path (`evaluateDynamicV2`): hbv1+hbv2+hbv4 → pass; hbv1+hbv2 → fail; hbv3-present-without-hbv4 → fail; include the HOSxP hbv3/hbv4 column-swap caveat (`docs/hdc-column-upgrade.md:45`). **Non-goal (explicit):** this issue must not change or challenge the View 2 per-child display authority — imported HDC `result` remains authoritative for displayed View 2 records.

### P2 — functional gaps

**#10 — Individual vs OpenData comparison view** [5.4]
Provenance-explicit per ADR-0002:57,77,96 — must identify both data sources, never present a merged value with unclear provenance.

**#11 — View 1 missing-vaccine-type filter** [4.6]
Facility scope and FY/quarter filters exist; the vaccine-type filter is absent.

**#12 — `getAvailableYears` / FY-selector consistency with the fiscal_year-column model**
`backend/src/Data.js:311-318` still scans for year-suffixed sheet names (`_(\d{4})$`), but year-suffixed sheets were removed in favor of a `fiscal_year` column (`Router.js:84` comment, `Data.js:93`); `useAvailableYears` drives the OpenData FY selector (`OpenDataDashboard.tsx:218-227`) while the upload FY dropdown is a static five-year select (`useUploadManager.ts:31-33`). Verify FY selectors still populate correctly; fix to derive years from distinct `fiscal_year` values (or remove and use configured years); add a regression test.

**#13 — OpenData month filter — decide or close** [5.3]
No month selector after the CumulativeCoverageChart redesign; decide whether month filtering is still wanted, else close as wontfix.

**#14 — Facility rename/edit UI** [6.2]
Add + `is_active` toggle exist; no edit form.

**#15 — Resolve `getAuditLogs` filtering contract** [1.13]
Decide whether server-side email/action filtering is still required by the audit contract, then implement it — or record the canonical decision that frontend search suffices and remove the dead parameters. No silent supersession.

### P3 — cleanup / documentation / maintainability

**#16 — Remove dead `amp` filter branch**
`backend/src/Router.js:44` — the ternary always yields `'all'`.

**#17 — Close automated verification gaps VG2/VG3/VG4/VG5** (one checklist issue)
`getAgeInMonths` unit test; auth-flow tests; `OpenData.js` unit tests (cache fallback, retention-on-failure, nightly ETL); `getFacilities`/`getAuditLogs` minimal tests.

**#18 — Add `frontend/.env.example`** [0.5 residual]
Completes the compound requirement.

**Total: 18 candidate issues** (P0: 2, P1: 7, P2: 6, P3: 3).

## 8. Documented Pending / External Domain Confirmation

Tracked separately from the 86 legacy classifications. These are **not** legacy STILL NEEDED items and are **not** automatically implementation work; they require confirmation from the data owner first. They may later become one grouped `needs-info` GitHub Issue if tracking is useful.

| Item | Status | Source |
|---|---|---|
| OPV 6-month mapping | unconfirmed — both `opv1_date` and `opv3_date` shown as evidence, neither auto-selected | `docs/hdc-column-upgrade.md:42-49` |
| PCV 1-year mapping | unknown — no guessing permitted ("ไม่เดา") | `docs/hdc-column-upgrade.md:42-49` |
| JE3 | absent from 3/5-year source files | `docs/hdc-column-upgrade.md:42-49` |

The production-migration runbook is deliberately **not** in this section — it stays in production-readiness work (Issue #5) because current UAT/deployment depends on it.

## 9. Documentation follow-up: schema.md terminology

`docs/schema.md:44` uses the legacy label "Soft Delete" in the `last_seen_batch` description where `CONTEXT.md` §30 canonically defines **soft-deactivation** (`is_active` storage; "Inactive does not necessarily mean deleted"). Behavior is identical; this is glossary drift, not a contradiction.

- **Action**: a minimal, explicit wording alignment ("Soft Delete" → soft-deactivation phrasing) is recorded as a documentation follow-up.
- **Constraint**: `docs/schema.md` is **not modified** in this reconciliation pass. The docs-only change will be proposed and approved separately.
- No standalone GitHub Issue is created for this wording change.

## 10. Migration recommendation and proposed priority order

### What migrates to GitHub Issues

All 18 candidates in §7, in this order:

1. **#1** (P0, security — recommended first issue: live fail-open behavior in a health-data system)
2. **#2** (P0, audit/data-integrity)
3. **#3** (CI — unblocks all other verification work; independently actionable)
4. **#5** (runbook — prerequisite for #4/#6 end states)
5. **#6, #7, #8** (verification pass)
6. **#4** (hosting/deploy — after CI exists)
7. **#9** (ready-for-agent; can start any time after CI)
8. **#12** (quick correctness check — FY selectors may be silently affected)
9. **#10, #11, #13, #14, #15** (functional gaps, product-priority order to be decided)
10. **#16, #17, #18** (cleanup)

### What remains historical only

All 65 DONE, 7 SUPERSEDED, and 1 OBSOLETE items — recorded here, never issued.

### What must be resolved before new feature development

- **#1 and #2** (P0 — security and data-integrity outrank features per `CLAUDE.md` §15).
- A quick verification pass on **#12** (FY-selector consistency) because dashboards may depend on it.
- A timing decision on **#3/#4**.

### Boundary statements preserved

- Imported HDC `result` remains authoritative for displayed View 2 per-child records (`CONTEXT.md:202-204`, ADR-0002, `docs/hdc-record-display.md:5`).
- Issue #9 covers only internal V2 summary/rule-evaluation regression tests and must not change that authority.
