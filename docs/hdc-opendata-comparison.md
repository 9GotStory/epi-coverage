# HDC OpenData reference in EPI Coverage Dashboard

## Roles of the two sources

**HDC OpenData** is a preaggregated annual standard-report reference. **EPI Coverage** imports HDC person-level exports and evaluates these data using active `vaccine_rules`. These are complementary sources; equal data origin does not guarantee identical numerator definitions, source dates, or eligible denominators.

The optional per-dose panel, "ความครอบคลุมรายวัคซีนตาม HDC", shows HDC Dose Coverage (`CONTEXT.md` §56) beside the View 1 evaluation. It is **read-only**, nested under `/dashboard` → age 1 / 2 / 3 / 5 → annual `View 1`; View 2 has its own Fully Immunized reference panel (see below). The card remains collapsed by default and fetches from existing GAS `getOpenData` only when expanded. The main Dashboard EPI scores, View 1/2, source records, upload procedures, threshold targets, historical snapshots, facility leaderboards, and Tracking UI remain unchanged.

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

These are source-snapshot examples from October 2026, **not timeless fixed assertions**. In particular, the age 3/5 Targets differ between the two sources; the panel shows each source with its own denominator. For 3-year EPI, an individual vaccine's applicable denominator may differ from its group total.

### Aggregation contract

Read `getOpenData` with `{ payload: { tableName: ageReport.table, year: String(selectedFiscalYear) } }`. The backend serves existing `opendata_cache` rows, possibly falling back to upstream. The frontend independently checks:

- Exact HDC standard report `id` and selected `b_year`; district prefix `5406` only.
- Five-digit `hospcode`, eight-digit `areacode`, unique `(hospcode,areacode)` pair.
- Uniform valid `date_com` (1-year report uses `YYYYMMDDHHMMSS`; 2/3/5-year reports use `YYYYMMDDHHMM`).
- Every month, all mapped HDC source numerator keys and `targetMM` exist and contain nonnegative safe integers; numerator cannot exceed that month’s denominator. Reject duplicates, mixed snapshots, malformed counters, and zero total denominator.
- Aggregation uses **sum of monthly counts across eligible rows**; never mean of per-area percentages. API errors and unavailable years are surfaced as unavailable, not fabricated zeros or substituted EPI values.
- Each row shows the HDC rate with its own `result/target` beside the View 1 result with its own `passed/total`. **No HDC − EPI difference is computed**, not even when the denominators are equal, and differing denominators raise no warning: HDC indicator criteria and the year's Vaccine Rules can differ (#126), so a gap would mix a difference in criteria with a difference in data. This is the same rule as the View 2 panel (#90 Q9). A note below the table says that HDC uses the Ministry's criteria, denominators and processing rounds.

**Removed difference (Issue #188).** Until #188 the panel showed a signed HDC − EPI percentage-point gap when HDC target = EPI group total = EPI vaccine item total, and a Target-mismatch warning otherwise.

### Test/release contract

- Synthetic tests for all 4 reports, 12-month accumulation, cross-year/cross-area exclusions, duplicate/mixed cycles, malformed columns, strict rule identity and branch matching, and missing-data behavior.
- Lazy UI tests confirm that all 4 ages fetch their own `s_epi*` table, never fetch before expansion, do not replace EPI scorecards, and never show an HDC − EPI difference or a Target-mismatch warning, even when the denominators are equal.
- CI tests/lint/build, backend/relay checks, code review, draft PR before any merge/deployment.
- **Never automatically update `vaccine_rules`, Google Sheets, or historical `Dashboard_Summaries`.**



## View 2: HDC Fully Immunized reference panel (Issue #186)

- **View 1** owns the on-demand per-dose HDC panel (HDC Dose Coverage, `s_epi1/2/3/5`).
- **View 2** keeps its Fully Immunized score, rule-based vaccine details and facility performance. Below the rule results it has one collapsed panel, "ความครอบคลุมตาม HDC (Fully Immunized)", that shows HDC Coverage (`CONTEXT.md` §53) from `s_epi_complete`: the percentage, `result/target คน` and the processing round (`date_com`), for the selected age and fiscal year, district `5406` only, whole fiscal year only. It fetches from `getOpenData` only when expanded.
- The panel shows the HDC figure alone. It computes no HDC − View 2 difference and no Coverage Goal comparison: `s_epi_complete` is a single all-or-nothing numerator/denominator under the Ministry's criteria, and the View 2 rules can differ from them (see #126), so a gap would mix different criteria with different data. In FY2569 its 3/5-year denominators also differed from the corresponding HDC dose reports; do not mix denominators across indicator families.
- Validation follows the per-dose aggregation contract above, using the annual `target`/`result` columns: exact report `id` and `b_year`, district prefix `5406`, five-digit `hospcode` and eight-digit `areacode` strings, unique `(hospcode,areacode)`, one `date_com` round, non-negative integer counts with `result ≤ target` per row, and a positive total target. Any failure shows "ข้อมูล HDC ไม่ถูกต้อง"; no eligible row shows "ยังไม่มีข้อมูลจาก HDC"; a failed request shows its own error. None of these shows a number, and an EPI value never stands in.
- The View 2 result is decided by the configured View 2 Vaccine Rules; the imported HDC `record.result` is supporting information and never changes it (ADR-0006, #101). Matching percentages with HDC are not independent evidence that the clinical validation algorithms are identical.
- This is **frontend-only**. It does not modify `vaccine_rules`, `Dashboard_Summaries`, `s_epi_complete` source history, GAS, HDC imports, or the existing View 1 mapping and source checks. The age-1 source report is also at [HDC Fully Immunized age 1](https://hdc.moph.go.th/pre/public/standard-report-detail/28dd2c7955ce926456240b2ff0100bde?subcatalogId=4df360514655f79f13901ef1181ca1c7).

**Reversed decision.** View 2 previously had no HDC panel at all, to keep a single HDC comparison location. #90 brought back one panel for the Fully Immunized figure only: it does not repeat the per-dose figures, so View 1 is still the only per-dose comparison.

### `s_epi_complete` report IDs by age group (restored 2026-10-31)

The single `s_epi_complete` table carries one report `id` (hash) per age cohort — the same per-report pattern as `s_epi1/2/3/5`. All four IDs were established empirically in October 2026 (FY2569 numerator/target parity with EPI View 2 per group; originally recorded in commit `fb0fe98`) and re-verified against live `report_data` on 2026-10-31 (four distinct IDs, province 54):

| Group | HDC report ID | FY2569 HDC result/target (parity evidence) |
| --- | --- | ---: |
| 1 year | `28dd2c7955ce926456240b2ff0100bde` | 142/181 |
| 2 years | `35f4a8d465e6e1edc05f3d8ab658c551` | 72/203 |
| 3 years | `d1fe173d08e959397adf34b1d77e88d7` | 28/231 |
| 5 years | `f033ab37c30201f73f142449d037028d` | 26/264 |

These IDs are evidence from the FY2569 snapshot, not a timeless guarantee; a future HDC re-key would surface as an unknown ID (fail closed, never a wrong-group number). Re-verified 2026-10-31 against the day's HDC round (`date_com` 202610310301) and the same-day recomputed EPI summaries: numerators matched exactly for all four groups (142 / 72 / 28 / 26); denominators matched 3 of 4 — HDC 3-year target was 230 vs EPI 231 (the known group-age denominator divergence above), and HDC targets move between processing rounds (5-year was 264 on 2026-10-08, 263 on 2026-10-31). See docs/features.md §3.2.2 for the table contract.

