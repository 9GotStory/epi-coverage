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


## View 2: Fully Immunized (annual, four age groups)

The supplied HDC report (28dd2c7955ce926456240b2ff0100bde) is for age 1.
The existing opendata_cache dataset **s_epi_complete** holds four **different**
HDC report IDs in one table. The client MUST select exactly the age-specific ID:

| Group | HDC report ID | FY2569 HDC result/target | FY2569 EPI View 2 |
| --- | --- | ---: | ---: |
| 1 year | 28dd2c7955ce926456240b2ff0100bde | 142/181 | 142/181 |
| 2 years | 35f4a8d465e6e1edc05f3d8ab658c551 | 72/203 | 72/203 |
| 3 years | d1fe173d08e959397adf34b1d77e88d7 | 28/231 | 28/231 |
| 5 years | f033ab37c30201f73f142449d037028d | 26/264 | 26/264 |

These are October 2026 FY2569 snapshots, NOT fixed values for future years.
Importantly, the HDC complete age-3/age-5 targets (231/264) match EPI,
whereas the HDC per-vaccine age-3/age-5 targets (230/262) do not.
Never substitute per-vaccine denominators into Fully Immunized.

### View 2 aggregation and provenance

- The existing public GAS getOpenData action reads tableName=s_epi_complete and
  the selected fiscal year on demand, only after expanding the View 2 control.
- Independently filter every returned row by the exact age report ID, selected
  fiscal year, and district area prefix 5406. Reject duplicate hospcode/areacode
  pairs and mixed HDC processing timestamps within the chosen report.
- Read top-level target and result totals. Verify each equals the sum of its
  12 monthly targetMM and resultMM counters. Reject missing, invalid, negative,
  non-integer, overflowing, or impossible numerator/denominator pairs.
- Display HDC result/target beside EPI view2Passed/view2ApplicableTotal.
  The signed HDC-minus-EPI gap is allowed ONLY if HDC target equals EPI total
  AND EPI view2ApplicableTotal, and the EPI coverage is consistent with its own
  numerator/denominator. Older snapshots missing applicable denominator
  may show EPI's rate but MUST NOT show an unsupported gap.
- Collapsed by default, inside annual View 2. No duplicate vaccine rows,
  new chart, scorecard replacement, person-level disclosure, backend change,
  spreadsheet writes, or modification to EPI's evaluation rules.

### Interpreting matching View 2 scores

The current evaluateDynamicV2 rule engine has a safety-net override
for person-level HDC record.result. Agreement of the FY2569 HDC aggregate
and EPI View 2 scores therefore does NOT independently prove that their
clinical rule logic or processing cycle is identical. The additional UI
is intended as a transparent reporting reconciliation, not a second
independent clinical validation.
