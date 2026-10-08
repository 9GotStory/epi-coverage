# HDC OpenData reference in EPI Coverage Dashboard

## Roles of the two sources

**HDC OpenData** is a preaggregated annual standard-report reference. **EPI Coverage** imports HDC person-level exports and evaluates these data using active `vaccine_rules`. These are complementary sources; equal data origin does not guarantee identical numerator definitions, source dates, or eligible denominators.

The optional comparison is **read-only**, nested under `/dashboard` → age 1 / 2 / 3 / 5 → annual `View 1`. The card remains collapsed by default and fetches from existing GAS `getOpenData` only when expanded. The main Dashboard EPI scores, View 1/2, source records, upload procedures, threshold targets, historical snapshots, facility leaderboards, and Tracking UI remain unchanged.

### Single source of vaccine identity

Vaccine rows and labels are rendered from the **selected EPI annual `Dashboard_Summaries.view1Breakdown`**, which is generated from `vaccine_rules` at processing time. For cross-source mapping, compare the **persisted `metric_key`** with exactly one active View 1 rule in `vaccine_rules` for that fiscal year and age, then check the **exact** HDC code, vaccine group, physical required fields, rule branch fields, and evaluation logic. No fuzzy display-name joins, no hand-entered UI vaccine list, no fabrication for an older summary lacking metric identity.

Because the OpenData API has its own metric column names, a small **age-report crosswalk** is required in `frontend/src/shared/utils/hdcAnnualReference.ts`. This crosswalk is only for the relationship between confirmed HDC aggregate columns and EPI rule fields; it is **not** a parallel Vaccine Rules Engine.

| Age | OpenData table | Exact report ID | View 1 metrics linked to EPI rules |
| --- | --- | --- | --- |
| 1 year | `s_epi1` | `c88658f4d09acb8c76e6c06ffb58ebaf` | BCG; HBV 1–4 (including the verified HOSxP physical field swap); DTP 1–3 (HDC third dose = `dtp_hb3`); Hib 1–3; IPV 1–2 (HDC second dose = `ipv`); OPV 3; MMR 1; PCV 1–3 when present in the EPI summary; Rota first/complete (with exact alternative-field contracts) |
| 2 years | `s_epi2` | `71e49e4b61aafee17761601c506d5f85` | MMR 1–2; DTP 4; OPV 4; LAJE/JE first-course branch (`je2` source) |
| 3 years | `s_epi3` | `267ce09f2a704eb7783997e25d1f18ba` | LAJE/JE second-course branch (`je3` source) |
| 5 years | `s_epi5` | `c47283d3c2c1e6528ddcf88c254f21b3` | DTP 5; OPV 5 |

**FY2569 empirical reconciliation completed for the three previously withheld metrics:** DTP3 → HDC `dtp_hb3` (178/181), IPV2 → HDC `ipv` (172/181), and OPV3 → HDC `opv3` (178/181). We independently compared HDC OpenData monthly aggregate counters with person-level HDC export dates in the selected 1-year birth cohort, month by month: all **12 of 12 months** matched for target, these three vaccines, and IPV1 (`ipv1_date` → `ipv1`). The matched annual counters are snapshot evidence, **not** a claim that HDC vaccine indicator algorithms and EPI date-validation rules are identical for every future year. These crosswalk entries still require matching active yearly `vaccine_rules` (code, group, fields, logic, metric_key). Unknown or changed mapping remains unavailable rather than 0%. Branch mappings such as JE/Rota establish a field/report pairing, not clinical rule equivalence.

### Verified underlying snapshot (FY2569)

| Source report | OpenData records in district | HDC target | EPI summary total |
| --- | ---: | ---: | ---: |
| 1 year | 63 | 181 | 181 |
| 2 years | 73 | 203 | 203 |
| 3 years | 70 | 230 | 231 |
| 5 years | 78 | 262 | 264 |

These are source-snapshot examples from October 2026, **not timeless fixed assertions**. In particular, a difference in age 3/5 target populations is an expected comparison **blocker**: the UI may display each source separately, but not a percentage-point gap until the eligible denominators are reconciled. For 3-year EPI, an individual vaccine's applicable denominator may differ from its group total.

### Aggregation contract

Read `getOpenData` with `{ payload: { tableName: ageReport.table, year: String(selectedFiscalYear) } }`. The backend serves existing `opendata_cache` rows, possibly falling back to upstream. The frontend independently checks:

- Exact HDC standard report `id` and selected `b_year`; district prefix `5406` only.
- Five-digit `hospcode`, eight-digit `areacode`, unique `(hospcode,areacode)` pair.
- Uniform valid `date_com` (1-year report uses `YYYYMMDDHHMMSS`; 2/3/5-year reports use `YYYYMMDDHHMM`).
- Every month, all mapped HDC source numerator keys and `targetMM` exist and contain nonnegative safe integers; numerator cannot exceed that month’s denominator. Reject duplicates, mixed snapshots, malformed counters, and zero total denominator.
- Aggregation uses **sum of monthly counts across eligible rows**; never mean of per-area percentages. API errors and unavailable years are surfaced as unavailable, not fabricated zeros or substituted EPI values.
- A signed **HDC − EPI** percentage-point gap appears only for matching fiscal-year/age, confirmed metric, and when **HDC target = EPI group total = EPI vaccine item total**. When denominators differ, show each source with a warning and **no gap**. Even with equal denominators, HDC and EPI source timestamp/indicator semantics can differ.

### Test/release contract

- Synthetic tests for all 4 reports, 12-month accumulation, cross-year/cross-area exclusions, duplicate/mixed cycles, malformed columns, strict rule identity and branch matching, and missing-data behavior.
- Lazy UI tests confirm that all 4 ages fetch their own `s_epi*` table, never fetch before expansion, do not replace EPI scorecards, and suppress invalid gap comparisons.
- CI tests/lint/build, backend/relay checks, code review, draft PR before any merge/deployment.
- **Never automatically update `vaccine_rules`, Google Sheets, or historical `Dashboard_Summaries`.**



## View 2: follow-up by HDC dose (annual, four age groups)

The original View 2 HDC Fully Immunized comparison repeated exactly the same
`result/target` score that EPI already presents in the main completion card.
This is redundant and does not answer which dose should be followed up.
The source `s_epi_complete` has only **Fully Immunized totals** — no
per-vaccine numerator fields; never imply that its `result` can be broken
into doses.

Instead, the **collapsed-by-default** View 2 control is
**ดูความครอบคลุมรายเข็มจาก HDC**. It reuses the existing
`useHdcAgeAnnualReference` for the selected fiscal year and matching
same-age per-dose report (`s_epi1/2/3/5`), with all source-identity, district,
snapshot, and 12-month count-integrity protections from View 1.

- Rows are anchored to EPI's selected-year `view1Breakdown` and a uniquely
  matched active `vaccine_rules` entry. The EPI list and vaccine names remain
  the source of UI identity; no duplicated frontend vaccine metadata.
- Show only confirmed mappings. Exclude rules marked `is_required_for_v2=false`
  or `display_only=true`, so out-of-plan doses such as PCV do not dominate
  follow-up priorities. Unknown mappings are counted in a small explanatory
  note, **never displayed as zero coverage**.
- Sort by **ascending HDC dose coverage**, display five lowest-coverage items,
  and provide an explicit control to reveal all. Each row shows the HDC dose
  numerator, target, percentage, and count not met in this *dose indicator*.
- No new HDC Complete scorecard, no duplicate HDC-versus-EPI total pair, no
  new menu/tab, no writes to HDC/EPI/snapshots/rules. View 1 is unchanged.
- **Critical interpretation:** HDC dose-level deficits are **not distinct
  children who failed Fully Immunized**. The same child may be absent in
  multiple dose indicators. The HDC age-3 and age-5 per-dose denominators
  for FY2569 (230/262) differ from HDC Fully Immunized (231/264); never
  use one source's denominator with another metric, nor automatically compare
  same age-dose coverage to accumulated EPI View 2 vaccine breakdowns.
- HDC report provenance and processing timestamp remain visible. Matching
  HDC Fully Immunized and EPI View 2 results in FY2569 partly reflect EPI's
  existing `record.result` HDC status override; such agreement is not an
  independent clinical validation.

The official HDC Fully Immunized report for age 1 remains available at
`https://hdc.moph.go.th/pre/public/standard-report-detail/28dd2c7955ce926456240b2ff0100bde?subcatalogId=4df360514655f79f13901ef1181ca1c7`;
its **single all-or-nothing score is already covered by the main dashboard card**.

### Review contract

- Test lazy loading for all four ages, exact `getOpenData` per-dose table choice,
  ascending sort, initial top-five limit, reveal-all control, exclusion of
  out-of-plan/unknown mappings, and clean unavailable/error states.
- Confirm frontend test/lint/build and Backend/Relay CI before merge.
