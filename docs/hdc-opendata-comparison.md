# HDC OpenData reference in EPI Coverage Dashboard (read-only)

## Purpose and authoritative boundaries

- **HDC OpenData / `s_epi1`** is an upstream **aggregate report reference**. Source report ID: `c88658f4d09acb8c76e6c06ffb58ebaf`, `https://hdc.moph.go.th/pre/public/standard-report-detail/c88658f4d09acb8c76e6c06ffb58ebaf?subcatalogId=4df360514655f79f13901ef1181ca1c7`.
- **EPI Coverage / `Dashboard_Summaries`** is a separately generated **rule-based assessment** of imported HDC person-level exports. EPI vaccine date validation, View 1/2, targets, upload and persistence are unchanged.
- Equal source origin does not prove equal indicator semantics: each percentage must retain its own numerator/denominator and source date.
- The comparison is an on-demand, subordinate, read-only detail under `/dashboard` → 1-year group → View 1; it is **not** a return of the removed OpenData Tracking tab.

## Supported mapping and scope

First release: **age group 1 year, fiscal year selected, annual quarter=`all` only**. The selected-year OpenData reference is fetched when the user expands “เปรียบเทียบกับ HDC OpenData”, not during normal Dashboard rendering.

The following mappings must be proven by exact `hdc_code`, `required_fields`, vaccine group, active View 1 rule for the **selected fiscal year**, and the summary's `metric_key` identity matching **exactly one rule**. A display label alone must never establish cross-source identity.

| EPI breakdown | Vaccine Rules Engine | OpenData `s_epi1` |
| --- | --- | --- |
| BCG | code `010`, `bcg_date` | `bcg_10` … `bcg_09` |
| DTP 2 months | code `031`, `dtp1_date` | `dtp1_10` … `dtp1_09` |
| DTP 4 months | code `032`, `dtp2_date` | `dtp2_10` … `dtp2_09` |

**Not yet mapped:** EPI DTP 6 months / `dtp3_date` and the HDC `dtp_hb3_*` combined indicator. Other vaccines and groups await independent source-code and definition verification. Never infer from similarity of labels or equal rates.

## Aggregation and failure behavior

Read public `getOpenData` with `{payload: {tableName: 's_epi1', year: '<selectedFY>'}}` via existing GAS API. The backend reads `opendata_cache` or may return upstream results on cache-miss. Client must always validate the **exact report id**, **selected `b_year`**, and **areacode prefix `5406`**, regardless of source. Sum all twelve month counts for the eligible district rows, using counts (not averaging monthly percentages):

- `target = Σ month × row targetMM`
- `numerator_metric = Σ month × row metric_MM`
- `coverage_metric = numerator_metric / target × 100`

Reject missing/non-integer/negative counts, duplicate `(hospcode, areacode)`, mixed `date_com` upstream processing snapshots, numerator above its month's target, and total zero. Missing/unsupported years show unavailable, **never fake 0%**; no fallback to a different year or derived EPI figure. A source failure must not hide or overwrite EPI values.

When EPI's `summary.total` **or** an EPI per-vaccine `item.total` differs from the HDC reference `target`, present both sources with a warning **without a directly comparable percentage-point gap**. Source timestamps must be visible; identical denominators alone do not prove equal source refresh times.

The old `/dashboard` summary card numbers and unit/facility leaderboards remain **rule-assessed EPI results**; the reference never changes pass/fail targets, imported individuals, historical snapshots, or GAS/Relay writes.

## Review/UAT gate

1. Baseline FY2569 `s_epi1` district totals checked against aggregate cache: target **181**, BCG **180**, DTP1 **178**, DTP2 **179**; FY2569 EPI values (same denominator) BCG **178**, DTP1 **175**, DTP2 **175**.
2. All frontend tests, lint and build green; synthetic tests cover a province-wide fallback response, rejected duplicate/mixed/malformed snapshots, no current-FY data, and strict unambiguous rule identity.
3. No data mutations. Before merge/deploy, review the named report mapping and verify the UI with real non-person-level aggregate responses; do not claim other vaccine codes are already equivalent.
