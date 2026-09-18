# Spec — Comparison Page Improvement (`/dashboard/comparison`)

| | |
|---|---|
| Status | Ready for review (awaiting `/to-tickets`) |
| Baseline | `main @ 773480d61217015dc608062742bfbd9c7cc8aff6` |
| Date | 2026-09-18 |
| Input | Grill result for Comparison Page Improvement (discovery pass, same date) |
| Scope | Phase 1 only; follow-on tickets defined but not specified here |

---

## 1. Problem

The Year Comparison page (`frontend/src/pages/YearComparison.tsx`) is intended to let a district-level user compare annual Fully Immunized (View 2) coverage across fiscal years. Today it is not trustworthy:

1. A selected fiscal year with no stored annual summary renders as **0% coverage and 0 children** (`summaryData?.total || 0`, `YearComparison.tsx:34-38`). Combined with a year selector that advertises years which cannot have summaries (see §8), the page fabricates zeros in a public-health report.
2. The count chart plots `total` ("เป้าหมายทั้งหมด") against `view2Passed`, mixing the **cohort total** with the **View 2 applicable denominator** — two different populations on one axis.
3. The true View 2 denominator is computed inside `calcGroupSummary()` (`dashboardLogic.ts:36,84,119`) but **never persisted** (`dashboardLogic.ts:157-169`), so neither Comparison nor Dashboard can state passed / failed / pending from the cache.
4. `getDashboardSummariesMultiYear` returns **both** canonical `<Table>_<FY>_all` and legacy `<Table>_<FY>` rows (`DashboardCache.js:143`); each frontend independently re-sorts by `updated_at` (`YearComparison.tsx:28`, `Dashboard.tsx:201-203`) — duplicate, divergent precedence logic.
5. Default year selection is `[currentFY-1, currentFY]` from the browser clock, blind to summary availability.
6. `getAvailableYears()` (`Data.js:317-363`) guarantees nothing about summaries: it scans a nonexistent `dashboard_cache` sheet (dead block), dead year-suffixed sheet names, and every year present in `vaccine_rules`.
7. Upload/regeneration invalidates `['dashboardSummaries']` but the comparison query key is `['dashboardSummariesMultiYear', …]` (`useDashboardSummariesMultiYear.ts:14`) — not prefix-matched, so Comparison serves stale data for the normal React Query stale window.
8. Each fiscal year's summary is a **frozen snapshot** computed with `evaluationDate = new Date()` at write time; different years carry different computation timestamps. The page presents them as one comparable series with no honesty about this.
9. FY-specific coverage targets exist (`useTargetSettings`) but are not shown.
10. The summary's `updated_at` (last recomputation) is invisible; when shown it must not be mislabeled as source-upload time.
11. The page uses a small subset of the summary contract and types it as `any`.
12. The page uses its own visual grammar (slate palette, no `SubNav`) instead of the Dashboard's (zinc, `SubNav`, `DESIGN.md` tokens).

Net effect: the page is "two historical bar charts", not a trustworthy cross-year analytical surface.

## 2. Goals

Let an authorized district-level user answer, **on one page**:

> สำหรับกลุ่มอายุที่เลือก ปีงบประมาณล่าสุดมี Fully Immunized coverage เท่าไร เปลี่ยนจากปีก่อนกี่ percentage points ถึงเป้าหมายหรือไม่ เด็กที่เข้าเกณฑ์ประเมินมีกี่คน ผ่านกี่คน ไม่ผ่านกี่คน และข้อมูลสรุปของแต่ละปีถูกคำนวณเมื่อใด

Concretely, Phase 1 delivers:

- **Data correctness**: no-data ≠ zero; single backend-owned annual-summary precedence; persisted View 2 applicable denominator and pending count; typed summary consumption; comparison-usable year discovery from summary data; correct cache invalidation.
- **Executive Comparison UX**: Dashboard-consistent page; age-group + FY multi-select (default latest two usable FYs, max 5); latest-year KPI area; annual coverage trend with FY-specific targets; passed/failed/pending composition where the contract supports it; detailed comparison table; per-year summary timestamps; distinct loading / no-data / error states.

## 3. Non-goals (Phase 1)

- Quarter cross-year comparison mode (quarter summaries already exist; separate future behavior mode).
- HDC OpenData / View 3 comparison; any merging of person-level summary metrics with aggregate OpenData into one unqualified series (ADR-0002 provenance rule stands).
- Vaccine heatmap / vaccine cross-year analysis (Follow-on B).
- Facility cross-year analysis (Follow-on A).
- PDF/Excel export from Comparison; AI-generated interpretation; causal analysis.
- Full Dashboard redesign; global navigation redesign.
- Rule-engine redesign or changes to `evaluateDynamicV2()` semantics (see §11).
- Automatic historical recomputation or summary migration/backfill (see §6, Decision B).
- Changing per-record View 2 display authority.
- Replacing Recharts; new state-management library.
- Redesigning `getAvailableYears()` for its other consumers (OpenData FY selector etc.) — recorded as separate follow-up (§20).

## 4. Current behavior (baseline evidence)

**Data path.** `Dashboard_Summaries` rows are written **client-side at upload time**: `useUploadManager.handleUpload` → `getEpiData({targetTable, fiscalYear, hoscode:'00588'})` (active-only, FY-filtered, district-wide; `Data.js:109-125`) → `getVaccineRules(fiscalYear, ageGroup)` (exact FY match, no fallback; `VaccineRules.js:187-218`) → `calcGroupSummary(cohort, evaluateDynamicV1, evaluateDynamicV2)` over the FY birth-cohort range (`dateUtils.ts:59-95`) → `saveDashboardSummary(..., 'all')` **plus Q1–Q4 rows** (`useUploadManager.ts:125-141`). `handleSyncAll` regenerates all five rows × four tables for the selected FY **without any new upload** (`useUploadManager.ts:172-214`). Writes are admin-gated; multi-year reads are public (`Router.js:29,38,61,85`).

**Annual `_all` cohort** = active records in `Epi_<Age>_Year` with `fiscal_year == FY`, all facilities, whose `birth` falls in `[ (FY-1-age)-10-01, (FY-age)-09-30 ]`. Records with no usable `birth` are excluded upstream and are therefore not in `total`.

**Row identity.** `saveDashboardSummary` upserts by id `<targetTable>_<fiscalYear>_<quarter|all>` (`DashboardCache.js:35-59`). The pre-quarter writer (git `0bce952`) wrote `<targetTable>_<fiscalYear>`; no code since git `8678c30` writes or updates legacy ids, so legacy rows can only be stale in place.

**View 2 in summaries.** `evaluateDynamicV2` (`ruleEngine.ts:224-305`) evaluates local rules first, then applies imported HDC `result` as an override: `'ผ่าน'` → forced PASS (pending cleared); `'ไม่ผ่าน'` → FAIL **unless local status is PENDING** (pending retained, `ruleEngine.ts:291-301`). Absent/empty `result` → local rules alone decide. This divergence from per-record display is documented (`docs/hdc-record-display.md:21`): Executive Summary, Year Comparison, and upload-time View 2 summaries deliberately remain "ระบบเดิม" and must not be described as directly counting `result`.

**Denominator semantics inside one `calcGroupSummary` pass.**

- `total` = cohort size (birth-range-filtered).
- A record is **applicable** iff `pendingVaccines` is empty after the HDC override; applicable records either pass (`view2Passed`) or not.
- The complement — records with non-empty `pendingVaccines` post-override — is exactly the **pending** bucket.
- Therefore, within one snapshot: `view2Passed ≤ view2ApplicableTotal ≤ total`, and `view2ApplicableTotal + view2PendingCount == total` (exact partition of the snapshot's own `total`).
- `view2Total` exists only as a local variable and is not returned (`dashboardLogic.ts:36,84,119,157-169`).

**Known upstream data-quality risk (recorded, not fixed here).** A FY with no seeded view-2 rules and empty HDC `result` strings auto-passes every applicable record (`ruleEngine.ts:231-277` vacuous loop) — such a year would show 100% coverage. See §19 Risks and §20 follow-up.

**Dashboard inconsistency.** Dashboard's View 2 card shows "ตกหล่น = `total − view2Passed`" (`Dashboard.tsx:143`) next to `view2Coverage` computed over the applicable total — mixed denominators on one card.

## 5. Domain constraints

- **View 2 authority** (CONTEXT.md §12, §13; ADR-0002; `docs/hdc-record-display.md`): imported HDC `result` is authoritative for per-record display; summaries use the existing engine. This spec changes neither.
- **Identifiers**: Facility Codes and `hoscode`-like fields are strings; never numerically normalized; leading zeroes preserved (CLAUDE.md §5). Comparison renders facility codes only in Follow-on A, which inherits this rule.
- **Fiscal Year**: Thai FY (Oct–Sep); age-group birth-cohort semantics per `getBirthDateRangeForQuarter`. Do not substitute calendar-year behavior.
- **Coverage**: any coverage figure must have an identifiable numerator, denominator, age group, FY scope, and data source (CONTEXT.md §18). Comparison's coverage is person-level View 2 from individual-record summaries — never mixed with dose-level View 1 or aggregate OpenData.
- **As-of Date vs summary timestamp** (CONTEXT.md §31; features.md §2): `Dashboard_Summaries.updated_at` is summary recomputation time, not source-upload time. Wording rules in §14.
- **Sensitive data**: Comparison consumes pre-aggregated summaries only; no individual records. The summary read endpoints are public by design (PDPA-safe aggregation); any new endpoint in this class must expose aggregates only.
- **Design system**: `DESIGN.md` tokens; Dashboard's zinc/light grammar; single Action Blue accent; no second accent, no decorative gradients, no shadow-heavy card design (see §16).

## 6. Product-owner decisions (LOCKED)

**Decision A — Historical snapshot policy.** Comparison compares **stored annual summary snapshots**. It does not recompute historical FYs against a common reference date. Each year preserves its own actual summary-computation timestamp, communicated honestly (§14). No silent rewriting of historical results for comparability.

**Decision B — No automatic historical backfill.** No re-sync/recompute of historical annual summaries solely to add the new denominator fields. Historical rows without the new fields remain valid legacy snapshots: supported metrics may display; denominator-dependent metrics display unavailable; missing values are never converted to `0`; `failed` is never derived as `total − passed`; pending is never inferred from incomplete fields. If a historical FY is later regenerated by an authorized operational action, it simply becomes a new snapshot with a new timestamp — outside this feature's automatic behavior.

**Decision C — Forward summary contract.** New/recomputed summaries persist `view2ApplicableTotal` and `view2PendingCount`. `view2Failed` is **not** persisted; it is derived as `view2ApplicableTotal − view2Passed` only where the contract guarantees both describe the same applicable population (current-contract snapshots).

**Decision D — Field terminology.** Canonical denominator field is **`view2ApplicableTotal`** — "records that participate in the View 2 coverage denominator for that summary snapshot". Generic `view2Total` is not used (collides with the reading "total records"; the code's own vocabulary is "applicable" — `dashboardLogic.ts:36,55`).

## 7. Data contract

### 7.1 Annual summary precedence (single authority: backend)

Backend annual-summary readers resolve, per `(targetTable, fiscalYear)`:

1. canonical `<TargetTable>_<FY>_all`;
2. legacy `<TargetTable>_<FY>` **only if** the canonical `_all` row is absent.

**Never return both as competing annual candidates.** Frontend consumers do not decide annual precedence and do not re-sort competing rows. This applies to `getDashboardSummariesMultiYear` and to the `q === 'all'` path of `getDashboardSummaries` (`DashboardCache.js:88-93`). Stored legacy rows are left untouched (Decision B). Quarter rows (Q1–Q4) are unaffected.

*Residual risk accepted:* in the pathological case of a legacy row somehow written *after* an `_all` row (stale pre-upgrade browser bundle or manual edit), `_all`-precedence returns the `_all` snapshot. Deterministic id-based precedence is preferred over trusting `updated_at`.

### 7.2 Comparison-usable fiscal years

A **usable Comparison fiscal year** for an age group = a FY for which the summary store contains a usable annual summary for that `targetTable`, after §7.1 precedence (existence of `_all`, else legacy).

Minimal contract — one new read-only public action:

- `getDashboardSummaryYears` (name may be adjusted to codebase conventions)
- Input: none.
- Output: `{ success: true, tables: { [targetTable: string]: number[] } }` — distinct fiscal years with a usable annual summary per table, ascending. `fiscalYear` values normalized to numbers.
- Reads `Dashboard_Summaries` only. Rows with unparseable `summaryData` are not usable (existing reader behavior silently drops them; such years are simply absent — acceptable and honest).
- `useAvailableYears()` is **not** the source for Comparison defaults. Its defects for other consumers are recorded as separate follow-up (§20), not fixed here.

### 7.3 Summary payload contract (typed, replaces `any`)

```ts
interface DashboardSummaryData {
  total: number;

  view1Coverage?: number;
  view1PassedDoses?: number;
  view1TotalDoses?: number;
  view1UnknownDoses?: number;

  view2Coverage: number;
  view2Passed: number;

  view2ApplicableTotal?: number; // current contract only
  view2PendingCount?: number;    // current contract only

  view1Breakdown?: { name: string; passed: number; total: number; coverage: number }[];
  view2Breakdown?: { name: string; passed: number; total: number; coverage: number }[];
  facilityBreakdownV1?: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];
  facilityBreakdownV2?: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];
}
```

- Required in both generations: `total`, `view2Coverage`, `view2Passed` (verified against the legacy writer, git `0bce952`).
- Optional because legacy rows may lack them: `view1UnknownDoses` (absent in legacy writer), `view2ApplicableTotal`, `view2PendingCount`, breakdowns.
- The wrapper (`MultiYearSummary`) keeps `id`, `targetTable`, `fiscalYear: number`, `summaryData: DashboardSummaryData`, `updated_at: string`.
- Ownership: defined once in `frontend/src/shared` (types or the summary hooks' module — fit existing structure); both `useDashboardSummaries` and `useDashboardSummariesMultiYear` consume it. No schema-validation framework introduced; TypeScript types only.

### 7.4 Current-contract invariants (enforced by tests)

For every newly computed/recomputed summary snapshot:

- `0 <= view2Passed <= view2ApplicableTotal <= total`
- `view2ApplicableTotal + view2PendingCount == total` — exact partition of the snapshot's own `total` (which is the birth-cohort-filtered count; records without usable `birth` are excluded upstream by design). If a future exclusion state is added to `calcGroupSummary`, the partition contract and its test must be revised explicitly — never silently.
- `view2Failed := view2ApplicableTotal - view2Passed` (derived, not stored); `view2Failed >= 0`.

## 8. Legacy compatibility

Two summary-contract generations are supported:

**Legacy snapshot** — may contain `total`, `view1Coverage`, `view1PassedDoses`, `view1TotalDoses`, `view2Coverage`, `view2Passed`, generation-dependent breakdowns; never `view2ApplicableTotal` / `view2PendingCount`.

- Coverage may display if present and valid (a real `0` displays as `0%`).
- Passed count may display.
- Applicable count, failed, pending: display unavailable (`—` / `ไม่มีข้อมูลรายละเอียดสำหรับ summary รุ่นนี้`); composition visualization must not fabricate those buckets for that FY.
- No derivation of `failed = total - passed`; no inference of pending.

**Current snapshot** — persists `total`, `view2ApplicableTotal`, `view2PendingCount`, `view2Passed`, `view2Coverage`, and the existing View 1 / breakdown fields, satisfying §7.4.

A row is treated as current-contract iff both `view2ApplicableTotal` and `view2PendingCount` are present numbers (per-field optionality exists only for typing; the writer always writes both).

## 9. Backend behavior

1. **Precedence resolution** in `getDashboardSummariesMultiYear` and the `'all'` path of `getDashboardSummaries`: return at most one annual row per `(targetTable, fiscalYear)` per §7.1. Invalid-JSON rows remain dropped (existing behavior).
2. **`getDashboardSummaryYears`** per §7.2, added to the public actions list (aggregate-only exposure class).
3. **No storage migration.** No row is rewritten, backfilled, or deleted by this feature.
4. **No change** to `saveDashboardSummary` id scheme, sheet schema, or write authorization in Ticket 1; Ticket 2 changes only the `summaryData` JSON contents produced by the frontend writer (`calcGroupSummary` return), which requires no backend storage change (column already free-form JSON).

## 10. Frontend behavior

### 10.1 Data correctness (Ticket 1)

- Comparison consumes `getDashboardSummaryYears` for year discovery; per selected FYs it consumes the precedence-resolved `getDashboardSummariesMultiYear`.
- Missing annual summary for a selected age-group/FY renders a no-data state; never `0` / `0%` (§12).
- `useDashboardSummariesMultiYear` / `useDashboardSummaries` typed per §7.3; no `any` in the Comparison-facing contract.
- Query invalidation (§15) fixed.

### 10.2 Summary writer (Ticket 2)

- `calcGroupSummary` returns and the upload/re-sync flows persist `view2ApplicableTotal` and `view2PendingCount` (invariants §7.4). No other engine semantics change.
- Dashboard View 2 card: "ตกหล่น" becomes `view2ApplicableTotal − view2Passed` when the contract fields exist; for legacy snapshots it displays `—` instead of `total − view2Passed`. Showing the pending count on the Dashboard card is optional (should, only if it fits the current card without redesign).

### 10.3 Comparison page (Ticket 3)

Controls:

- **Age Group selector**: 1 ปี / 2 ปี / 3 ปี / 5 ปี (existing Select grammar). Changing age group resets the FY selection to the default for that group.
- **FY multi-select** from the age group's usable years (chips per existing grammar): default = latest 2 usable FYs; if only 1 exists, select it; if none, select none and show the page-level no-data state. Max 5 selected: a sixth selection is prevented with clear feedback (disable unselected chips at the cap and/or a visible message); never silently drop an already-selected year. Selection UI may list newest-first; visualizations order FY ascending.

KPI area (latest selected FY with a usable summary):

1. **Fully Immunized Coverage** — e.g. `92.40%` (real zero renders `0%`).
2. **Change from previous selected usable FY** — e.g. `+3.10 pp`, chronological order, no causality implied; `—` when no previous comparable FY. Percentage points, never "percent growth".
3. **Gap to Target** — `gapToTarget = view2Coverage - target` in `pp` (e.g. `+2.40 pp`); `ไม่ได้กำหนดเป้าหมาย` when the FY has no configured target. Never `0` as fallback target.
4. **Passed / Applicable** — `194 / 210 คน` for current contract; legacy shows passed with `—` denominator.

Trend visualization (primary):

- Recharts **LineChart**: X = fiscal year (ascending), Y = coverage 0–100%.
- Only actual available coverage is plotted; a missing summary is **not** a zero point.
- Two selected years → a line with two visible points; do not switch visualization solely because n=2.
- Target: per-FY target values as a series/points (e.g. dashed target line with markers). If targets differ across the selected years, do not imply one fixed horizontal target.
- Tooltip: FY, coverage, passed/applicable (where available), target, gap, summary timestamp.

View 2 composition visualization:

- Stacked bar per FY: Passed (`view2Passed`) / Failed (`view2ApplicableTotal − view2Passed`) / Pending (`view2PendingCount`); stack total equals cohort `total`.
- Legacy FY without contract fields: unavailable state for that FY (e.g. hatched/empty segment with `ไม่มีข้อมูลรายละเอียดสำหรับ summary รุ่นนี้`), never an all-zero stack.
- Numeric labels/tooltip; meaning never carried by color alone.

Comparison table (core):

Columns: Fiscal Year · Total cohort records · View 2 applicable · View 2 passed · View 2 failed · Pending / not applicable · Coverage · Target · Gap to target · Difference from previous selected usable FY (pp) · Summary timestamp. Unavailable legacy metrics render `—`, never `0`.

Snapshot interpretation:

- Concise help text/tooltip near the trend chart: each FY point is the **stored summary snapshot** for that FY and may have a different computation timestamp; the series is not a single common-date recalculation.

## 11. UX behavior

- Page uses `SubNav` (title e.g. "เปรียบเทียบข้ามปีงบประมาณ"), the Dashboard's zinc/light surface grammar, existing card/table/Select/chip primitives, `DESIGN.md` spacing/radius tokens, single Action Blue accent, no decorative gradients, no shadow-heavy card design, responsive per existing breakpoints.
- Numeric meaning is always available without hover: KPI cards + comparison table mirror every chart value; tooltips add detail, not essentials.
- Mobile: single-column stacking; touch-friendly selection controls (existing chip/Select grammar).
- Pending bucket wording: primary label **`ยังไม่เข้าเกณฑ์ประเมิน`** with a clarifying tooltip — the bucket is "records excluded from the View 2 denominator by current View 2 pending semantics" (predominantly age-not-reached; per engine behavior, HDC-`ไม่ผ่าน` records that are locally pending also remain in this bucket). Do **not** categorically label the bucket `อายุยังไม่ถึง`.
- Freshness wording per §14.

## 12. Error / no-data / loading states (distinct, never conflated)

| State | Definition | Rendering |
|---|---|---|
| Real zero | Summary exists; metric is numerically 0 | `0%` / `0` as appropriate |
| Missing annual summary | No usable canonical/legacy summary for age group/FY | `ไม่มีข้อมูลสรุป`; no zero plotted; table row shows `—` metrics |
| Legacy missing new fields | Summary exists; denominator-dependent details unavailable | `—` / `ไม่มีข้อมูลรายละเอียดสำหรับ summary รุ่นนี้`; no fabricated values |
| Page-level no-data | Selected age group has zero usable years | Page-level empty state; no charts |
| Loading | Query in flight | Existing skeleton/spinner grammar |
| API failure | Request failed or error envelope | Error state; never converted to an empty dataset |

## 13. Target semantics

- Annual Comparison uses the existing repository convention equivalent to `getTarget('all', 2, undefined, fiscalYear)`, where `'all'` resolves to **Q4** target semantics (`useTargetSettings.ts:35`; Dashboard precedent `Dashboard.tsx:193-195`).
- Precedence remains the system's: `target_<vac>_q4_<FY>` → `target_<vac>_q4` → `target_view2_q4_<FY>` → `target_view2_q4` → `target_q4_<FY>` → `target_q4` → undefined.
- Per FY: target exists → display; missing → `ไม่ได้กำหนดเป้าหมาย`; never `0` fallback.
- `gapToTarget = view2Coverage − target`, unit **percentage points (pp)**; not percent growth.
- The annual → Q4 convention is documented in canonical business docs (§17).

## 14. Snapshot / freshness semantics

- `Dashboard_Summaries.updated_at` = the time that summary row was last recomputed/written (upload-triggered or data-less re-sync). It is **not** necessarily source-file upload time (As-of Date is derived from audit/import info; CONTEXT.md §31, features.md §2).
- Per-year label: `ข้อมูลสรุป ณ วันที่ …` or `คำนวณสรุปล่าสุดเมื่อ …` (existing `formatDateTimeStr`). Never `ข้อมูลอัปเดตล่าสุด` for this field.
- The page communicates snapshot semantics via the concise help text (§10.3); no implementation-heavy UI.

## 15. Cache behavior

- Successful summary write/regeneration must invalidate the Comparison queries so users do not see an avoidable stale multi-year result for the normal React Query stale window.
- Smallest coherent change, either: (a) key the multi-year query under the `dashboardSummaries` prefix (e.g. `['dashboardSummaries', 'multiYear', fiscalYears]`) so the existing invalidations in `useUploadManager` (both `handleUpload` and `handleSyncAll` sites) cover it automatically; or (b) add explicit invalidation of `dashboardSummariesMultiYear` at those two regeneration sites.
- Must not invalidate unrelated OpenData / `availableYears` queries.

## 16. Documentation impact (expected edits during implementation)

| Document | Change |
|---|---|
| `CONTEXT.md` | Add recurring concept **View 2 Applicable Total** (population included in the summary's View 2 coverage denominator); link View 2 / Fully Immunized entries |
| `docs/features.md` | Year Comparison behavior; annual stored-snapshot semantics; `_all` > legacy precedence; missing data ≠ zero; View 2 applicable/pending semantics incl. partition and failed derivation; annual target uses Q4 convention; legacy degradation behavior |
| `docs/schema.md` | Document `Dashboard_Summaries`: id format (`_all`, Q1–Q4, legacy), `targetTable`, `fiscalYear`, `summaryData` JSON contract (incl. `view2ApplicableTotal`, `view2PendingCount`), `updated_at` meaning; document the `configs_system` target key scheme (current canonical ownership) |
| `docs/spec.md` | No change expected (no new integration boundary; the new read action follows existing GAS public-read patterns) |
| `DESIGN.md` | No change (reuse existing system) |
| `docs/adr/` | Not expected — additive contract evolution with backend precedence ownership; reversible; canonical docs suffice |

## 17. Acceptance criteria

Correctness (each testable; numbered for traceability):

1. A selected FY with no summary never displays `0%`/`0` merely because data is absent — a no-data state renders.
2. A real `0` in an existing summary still displays `0%`/`0`.
3. Canonical `_all` wins over a legacy annual row for the same table+FY.
4. Backend returns at most one annual row per `(targetTable, fiscalYear)` from both summary readers.
5. Default selection = latest two usable FYs for the selected age group (from summary-derived years; 1 if only one; none + page-level no-data if zero).
6. At most 5 FYs selectable; the cap produces visible feedback; no silent deselection.
7. Current-contract summaries persist `view2ApplicableTotal`.
8. Current-contract summaries persist `view2PendingCount`.
9. `view2Passed <= view2ApplicableTotal <= total` holds for every computed snapshot (unit-tested).
10. Composition chart uses passed / (applicable − passed) / pending with the §7.4 identities.
11. Legacy summaries never fabricate applicable/failed/pending (unavailable state; no zero-stack; no `total − passed` derivation).
12. Target resolution uses FY-specific configuration with existing fallback precedence.
13. A missing target renders `ไม่ได้กำหนดเป้าหมาย`, never `0`.
14. Year-over-year difference and gap metrics use percentage points.
15. Summary timestamp renders as summary-computation timestamp with §14 wording.
16. Upload/sync regeneration invalidates Comparison query data (no stale multi-year result beyond the normal stale window).
17. API errors remain visually and logically distinct from no-data.
18. Per-record View 2 display authority is unchanged (`evaluateDynamicV2` semantics unchanged except the returned contract fields).
19. No automatic historical backfill/recompute occurs.
20. No unrelated OpenData behavior changes (queries, selectors, endpoints untouched).

UX (§29 of the direction, encoded): from the page alone, for a current-contract latest FY and previous FY, a user can read: latest coverage; change from previous FY; annual target; target gap; total cohort; applicable denominator; passed; failed; pending; each FY's summary-computation timestamp. For a legacy FY, supported coverage displays without pretending unavailable denominator details are zero.

## 18. Testing strategy

- **Backend** (`cd backend && npm test`, existing `.test.cjs` GAS-mock style): precedence resolution (both readers; `_all` present, legacy only, both, invalid-JSON row); `getDashboardSummaryYears` output shape/normalization; no write-path changes.
- **Frontend** (`cd frontend && npm test`): `calcGroupSummary` unit tests (new) — persisted fields, `passed <= applicable <= total`, exact partition `applicable + pending == total`, real-zero vs missing distinction; typed contract compiles (`npm run build`); hook/component tests for no-data vs error vs loading, default year selection, 5-year cap; invalidation coverage where feasible.
- Gates per CLAUDE.md §11: relevant suites + `npm run lint` + `npm run build` for frontend; backend `npm test`. Each gate reported independently.

## 19. Risks

1. **Public endpoint contract change**: `getDashboardSummariesMultiYear` becomes single-row-per-(table,FY); any consumer expecting competing rows must be updated (only Dashboard + Comparison consume it today; Dashboard's re-sort becomes a no-op and is removed in Ticket 1).
2. **Snapshot misinterpretation**: users may still read the trend as a common-date series; mitigated by per-year timestamps + help text, never by rewriting history.
3. **Rules-empty historical FYs auto-passing** (§4): a legacy year could show inflated (100%) coverage. Not fixed by this feature; surfaced for a dedicated upstream correctness ticket before such years are trusted analytically (§20). Comparison must not special-case them.
4. **Breakdown `display_name` drift across years**: affects Follow-on B; requires a stable join key (`rule_id` / `vaccine_group`) decided in that ticket.
5. **Pathological newer-legacy-row case** returns the `_all` snapshot (accepted, §7.1).
6. **Silently dropped invalid-JSON rows** mean those years are absent from usable years (existing reader behavior; honest absence).

## 20. Explicit out-of-scope items / separate follow-ups

- **Follow-on A — Facility cross-year analysis** (uses `facilityBreakdownV1/V2`; Facility Code stays string; missing ≠ 0).
- **Follow-on B — Vaccine cross-year analysis** (stable cross-year join key required — not `display_name` alone; decide `rule_id` vs `vaccine_group` vs another repository-defined identifier in that spec).
- **Later — Same-quarter comparison** (Q1–Q4 rows exist; separate behavior mode).
- **Later — OpenData / View 3 comparison** (provenance-explicit per ADR-0002; never merged with person-level metrics).
- **Separate ticket — `getAvailableYears()` defects** for its other consumers (dead `dashboard_cache` scan, dead sheet-name scan, rules-derived years) — explicitly not widened into this feature.
- **Possible separate ticket — rules-empty-FY auto-pass correctness** (Risk 3), to be raised if affected historical years matter analytically.

## 21. Recommended ticket decomposition

| Ticket | Owns | Depends on |
|---|---|---|
| **1 — Comparison Data Correctness** | Backend `_all` precedence + one annual row per table/FY (both readers); `getDashboardSummaryYears`; frontend no-data ≠ zero; typed Comparison summary consumption (both hooks); multi-year query invalidation; remove now-redundant frontend precedence sorts; regression tests. No UX redesign. | — |
| **2 — Summary Contract v2** | `view2ApplicableTotal` + `view2PendingCount` in `calcGroupSummary`/`GroupSummary` and persisted by the writer; arithmetic invariants + tests; Dashboard "ตกหล่น" correction (`—` for legacy); backward compatibility; **no** historical automatic backfill. | — (independent of 1) |
| **3 — Executive Comparison UX** | SubNav/design alignment; controls (age group, FY multi-select, defaults, cap); KPI cards; trend line with per-FY targets; target gap; composition chart; comparison table; timestamps; loading/no-data/error states; snapshot help text. | 1 + 2 |
| **4 — Facility Cross-year Analysis** | Follow-on A. | 1–3 |
| **5 — Vaccine Cross-year Analysis** | Follow-on B + stable join identity. | 1–3 |
| **Later** | Same-quarter comparison; OpenData/View 3 comparison. | — |

Dependencies are acyclic (1 ∥ 2 → 3 → {4, 5}). No umbrella implementation issue required.

---

## Final readiness check

- View 2 authority preserved? **Yes** — §5, §11 (AC 18); engine untouched except returned contract fields.
- Missing ≠ zero guaranteed? **Yes** — §12, AC 1–2, 11.
- Canonical annual precedence singular? **Yes** — §7.1 backend-only ownership (AC 3–4).
- Historical recomputation prohibited by default? **Yes** — Decision B, AC 19.
- Legacy degradation explicit? **Yes** — §8, §12.
- Applicable/pending semantics unambiguous? **Yes** — §4, §7.4, §10.3 wording rules.
- Summary timestamp meaning honest? **Yes** — §14 (AC 15).
- Annual target semantics explicit? **Yes** — §13 + features.md documentation task (AC 12–13).
- Comparison isolated from OpenData? **Yes** — §3, §15, AC 20.
- Dependencies between tickets acyclic? **Yes** — §21.
- Unresolved product decisions? **None** — Decisions A–D locked; no new decisions discovered during specification.
