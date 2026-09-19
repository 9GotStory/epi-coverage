/**
 * Issue #22 RED contracts — canonical annual summaries, comparison-usable
 * years, and honest no-data (backend seams).
 *
 * Seams under test (agreed in Issue #22 and docs/specs/comparison-page-improvement.md,
 * not prescribed privately by these tests):
 *   1. The existing annual-summary readers in `DashboardCache.js`
 *      (`getDashboardSummariesMultiYear`, `getDashboardSummaries`) must resolve
 *      canonical annual precedence in ONE place (backend): `<Table>_<FY>_all`
 *      wins; legacy `<Table>_<FY>` is returned only when `_all` is absent;
 *      never both. Precedence is by row identity, NOT by `updated_at` — a
 *      legacy row with a newer timestamp must still lose to `_all`.
 *   2. A minimal public comparison-usable-years read (`getDashboardSummaryYears`)
 *      returning, per target table, the ascending numeric fiscal years whose
 *      precedence-selected annual row is USABLE: parseable `summaryData` whose
 *      required base Comparison fields (`total`, `view2Coverage`, `view2Passed`)
 *      are present and valid numbers. A parseable `{}`, invalid JSON, or
 *      missing/invalid base fields must NOT advertise a year as usable.
 *   3. The router public boundary: the summary-years read must be reachable
 *      without authentication (public aggregate-only exposure class).
 *
 * All data is synthetic aggregate summary material. No production Sheet IDs,
 * secrets, or person-level data appear in this file.
 *
 * Ticket boundary: nothing here asks for new persisted fields (#23), the
 * executive UX (#24), or generic `getAvailableYears()` repairs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const YEARS_HELPER_MISSING =
  'comparison-usable summary years helper is not implemented (Issue #22: expected a public getDashboardSummaryYears contract)';

const SUMMARY_HEADER = ['id', 'targetTable', 'fiscalYear', 'summaryData', 'updated_at'];

/** Synthetic, structurally valid base summary payload for usable-year cases. */
function validBaseSummary({ total = 10, view2Coverage = 55.5, view2Passed = 5 } = {}) {
  return { total, view2Coverage, view2Passed };
}

/** Build one synthetic Dashboard_Summaries row. `summaryData` may be a pre-stringified value. */
function summaryRow(id, targetTable, fiscalYear, summaryData, updatedAt) {
  return [id, targetTable, fiscalYear, typeof summaryData === 'string' ? summaryData : JSON.stringify(summaryData), updatedAt];
}

function createDashboardCacheHarness({ rows = [] } = {}) {
  const cells = [[...SUMMARY_HEADER], ...rows.map(row => [...row])];
  const sheet = {
    cells,
    getName: () => 'Dashboard_Summaries',
    getLastRow: () => cells.length,
    setFrozenRows() {}, setFontWeight() {},
    getDataRange() { return this.getRange(1, 1, Math.max(1, cells.length), SUMMARY_HEADER.length); },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) =>
          Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? '')),
        setValues(values) {
          values.forEach((entry, i) => {
            entry.forEach((value, j) => { cells[row - 1 + i] ||= []; cells[row - 1 + i][column - 1 + j] = value; });
          });
          return this;
        },
      };
    },
    appendRow(values) { cells.push([...values]); return this; },
  };
  const sheets = new Map([['Dashboard_Summaries', sheet]]);
  const ss = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => {
      const created = { getName: () => name, getDataRange() { return { getValues: () => [[...SUMMARY_HEADER]] }; }, getRange() { return { setValues() {}, getValues: () => [[]] }; }, setFrozenRows() {}, appendRow() {} } ;
      sheets.set(name, created);
      return created;
    },
  };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/DashboardCache.js'), 'utf8'), context);
  return { context, sheet };
}

/** Minimal Router.js harness: only the globals the public-action boundary can reach. */
function createRouterHarness() {
  // Provided so that GREEN only needs to wire the action into the public list;
  // the marker value proves the router actually dispatched to the seam.
  const summaryYearsMarker = { success: true, tables: { Epi_1_Year: [2567] } };
  const context = vm.createContext({
    console,
    validateTokenAndGetRole: () => ({ valid: false, error: 'harness: no token supplied' }),
    getDashboardSummaryYears: () => summaryYearsMarker,
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => ({ payload: text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), context);
  return { context, summaryYearsMarker };
}

function callRouterAction(context, action) {
  const output = context.handleRequest('POST', {
    parameter: { action },
    postData: { contents: JSON.stringify({ action }) },
  });
  return JSON.parse(output.payload);
}

// ---------------------------------------------------------------------------
// Group A — backend annual precedence (Issue #22.A)
// ---------------------------------------------------------------------------

test('#22.A1 multi-year reader returns ONLY the canonical _all annual row when legacy also exists (id precedence, not newest-wins)', () => {
  // Legacy row deliberately carries the NEWER timestamp — today the frontend
  // picks it by updated_at, which is exactly the duplicate-authority defect.
  const { context: c } = createDashboardCacheHarness({
    rows: [
      summaryRow('Epi_1_Year_2567', 'Epi_1_Year', 2567, { ...validBaseSummary({ total: 111 }) }, '2026-09-18T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, { ...validBaseSummary({ total: 222 }) }, '2026-08-01T10:00:00Z'),
    ],
  });
  const result = c.getDashboardSummariesMultiYear([2567]);
  assert.equal(result.success, true);
  assert.equal(result.summaries.length, 1, 'exactly one annual row per (targetTable, fiscalYear) — never competing canonical+legacy rows');
  assert.equal(result.summaries[0].id, 'Epi_1_Year_2567_all', 'canonical _all must win by row identity');
  assert.equal(result.summaries[0].summaryData.total, 222, 'the returned values must come from the _all snapshot, not the newer legacy row');
});

test('#22.A2 single-year annual reader (quarter "all") returns ONLY the canonical _all row when legacy also exists', () => {
  const { context: c } = createDashboardCacheHarness({
    rows: [
      summaryRow('Epi_1_Year_2567', 'Epi_1_Year', 2567, { ...validBaseSummary({ total: 111 }) }, '2026-09-18T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, { ...validBaseSummary({ total: 222 }) }, '2026-08-01T10:00:00Z'),
    ],
  });
  const result = c.getDashboardSummaries(2567, 'all');
  assert.equal(result.success, true);
  assert.equal(result.summaries.length, 1, 'annual read must resolve to one row per table/FY');
  assert.equal(result.summaries[0].id, 'Epi_1_Year_2567_all');
  assert.equal(result.summaries[0].summaryData.total, 222);
});

test('#22.A3 legacy fallback: when _all is absent a valid legacy annual row is still returned (preservation)', () => {
  const { context: c } = createDashboardCacheHarness({
    rows: [summaryRow('Epi_1_Year_2566', 'Epi_1_Year', 2566, validBaseSummary(), '2026-05-01T10:00:00Z')],
  });
  const multi = c.getDashboardSummariesMultiYear([2566]);
  assert.equal(multi.success, true);
  assert.equal(multi.summaries.length, 1);
  assert.equal(multi.summaries[0].id, 'Epi_1_Year_2566');

  const single = c.getDashboardSummaries(2566, 'all');
  assert.equal(single.summaries.length, 1);
  assert.equal(single.summaries[0].id, 'Epi_1_Year_2566');
});

test('#22.A4 quarter isolation: annual precedence must not swallow Q1–Q4 rows (preservation)', () => {
  const { context: c } = createDashboardCacheHarness({
    rows: [
      summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, validBaseSummary(), '2026-08-01T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_1', 'Epi_1_Year', 2567, validBaseSummary({ total: 3 }), '2026-05-01T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_2', 'Epi_1_Year', 2567, validBaseSummary({ total: 4 }), '2026-05-02T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_3', 'Epi_1_Year', 2567, validBaseSummary({ total: 5 }), '2026-05-03T10:00:00Z'),
      summaryRow('Epi_1_Year_2567_4', 'Epi_1_Year', 2567, validBaseSummary({ total: 6 }), '2026-05-04T10:00:00Z'),
    ],
  });
  const multi = c.getDashboardSummariesMultiYear([2567]);
  assert.equal(multi.summaries.length, 1, 'annual read must still resolve to exactly the _all row');
  assert.equal(multi.summaries[0].id, 'Epi_1_Year_2567_all');

  for (const q of [1, 2, 3, 4]) {
    const quarterRead = c.getDashboardSummaries(2567, q);
    assert.equal(quarterRead.success, true);
    assert.equal(quarterRead.summaries.length, 1, `quarter ${q} read must keep returning its own row`);
    assert.equal(quarterRead.summaries[0].id, `Epi_1_Year_2567_${q}`);
  }
});

// ---------------------------------------------------------------------------
// Group B — comparison-usable years (Issue #22.B)
// ---------------------------------------------------------------------------

function readUsableYears(harnessRows) {
  const { context: c } = createDashboardCacheHarness({ rows: harnessRows });
  assert.equal(typeof c.getDashboardSummaryYears, 'function', YEARS_HELPER_MISSING);
  return c.getDashboardSummaryYears();
}

test('#22.B1/B2 usable years: per-table ascending numeric FYs with usable annual summaries; quarter-only rows never make a year usable', () => {
  const result = readUsableYears([
    // Deliberately seeded out of chronological order to prove ascending output.
    summaryRow('Epi_1_Year_2568_all', 'Epi_1_Year', 2568, validBaseSummary(), '2026-08-03T10:00:00Z'),
    summaryRow('Epi_1_Year_2566_all', 'Epi_1_Year', 2566, validBaseSummary(), '2026-08-01T10:00:00Z'),
    summaryRow('Epi_2_Year_2567_all', 'Epi_2_Year', 2567, validBaseSummary(), '2026-08-02T10:00:00Z'),
    // 2569 exists ONLY as a quarter row — it has no annual summary.
    summaryRow('Epi_1_Year_2569_1', 'Epi_1_Year', 2569, validBaseSummary(), '2026-08-04T10:00:00Z'),
  ]);
  assert.equal(result.success, true);
  assert.ok(result.tables, 'result must expose a per-table years map');
  assert.deepEqual(Array.from(result.tables.Epi_1_Year), [2566, 2568], 'ascending numeric years, quarter-only 2569 excluded');
  assert.deepEqual(Array.from(result.tables.Epi_2_Year), [2567]);
  for (const year of result.tables.Epi_1_Year) {
    assert.equal(typeof year, 'number', 'years must be numbers, not sheet strings');
  }
});

test('#22.B3 precedence applies before usability: an invalid legacy row must not disqualify a valid _all row for the same FY', () => {
  const result = readUsableYears([
    summaryRow('Epi_1_Year_2567', 'Epi_1_Year', 2567, {}, '2026-05-01T10:00:00Z'), // legacy = parseable {}
    summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, validBaseSummary(), '2026-08-01T10:00:00Z'),
  ]);
  assert.deepEqual(Array.from(result.tables.Epi_1_Year), [2567], 'the selected _all row is usable, so the FY is usable');
});

test('#22.B3 (inverse) an unusable _all row must not fall back to a valid legacy row — precedence decides first', () => {
  const result = readUsableYears([
    summaryRow('Epi_1_Year_2567', 'Epi_1_Year', 2567, validBaseSummary(), '2026-05-01T10:00:00Z'), // legacy valid
    summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, {}, '2026-08-01T10:00:00Z'), // selected row = parseable {}
  ]);
  const years = result.tables.Epi_1_Year || [];
  assert.equal(years.includes(2567), false, 'once _all is selected it is the only candidate; legacy must not rescue the FY');
});

test('#22.B4 legacy fallback counts as usable when _all is absent', () => {
  const result = readUsableYears([
    summaryRow('Epi_1_Year_2566', 'Epi_1_Year', 2566, validBaseSummary(), '2026-05-01T10:00:00Z'),
  ]);
  assert.deepEqual(Array.from(result.tables.Epi_1_Year), [2566]);
});

test('#22.B5 invalid JSON summaryData does NOT make a year usable', () => {
  const result = readUsableYears([
    summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, '{not-valid-json', '2026-08-01T10:00:00Z'),
  ]);
  const years = result.tables.Epi_1_Year || [];
  assert.equal(years.includes(2567), false);
});

test('#22.B6 parseable {} does NOT make a year usable', () => {
  const result = readUsableYears([
    summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, {}, '2026-08-01T10:00:00Z'),
  ]);
  const years = result.tables.Epi_1_Year || [];
  assert.equal(years.includes(2567), false, 'an empty object has none of the required base Comparison fields');
});

test('#22.B7 parseable summaries missing any required base field do NOT make a year usable', () => {
  const cases = [
    { view2Coverage: 55.5, view2Passed: 5 },              // missing total
    { total: 10, view2Passed: 5 },                        // missing view2Coverage
    { total: 10, view2Coverage: 55.5 },                   // missing view2Passed
  ];
  for (const payload of cases) {
    const result = readUsableYears([
      summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, payload, '2026-08-01T10:00:00Z'),
    ]);
    const years = result.tables.Epi_1_Year || [];
    assert.equal(years.includes(2567), false, `summary missing a base field must not be usable: ${JSON.stringify(payload)}`);
  }
});

test('#22.B8 non-numeric required base fields do NOT make a year usable (never coerced to zero to force usability)', () => {
  const cases = [
    { total: 'ไม่ใช่ตัวเลข', view2Coverage: 55.5, view2Passed: 5 },
    { total: 10, view2Coverage: 'N/A', view2Passed: 5 },
    { total: 10, view2Coverage: 55.5, view2Passed: null },
    { total: 10, view2Coverage: 55.5, view2Passed: '' },
  ];
  for (const payload of cases) {
    const result = readUsableYears([
      summaryRow('Epi_1_Year_2567_all', 'Epi_1_Year', 2567, payload, '2026-08-01T10:00:00Z'),
    ]);
    const years = result.tables.Epi_1_Year || [];
    assert.equal(years.includes(2567), false, `invalid base field must not be usable or zero-coerced: ${JSON.stringify(payload)}`);
  }
});

// ---------------------------------------------------------------------------
// Group B9 — router public boundary (Issue #22.B)
// ---------------------------------------------------------------------------

test('#22.B9 router boundary: getDashboardSummaryYears is reachable as a public action without authentication', () => {
  const { context: c, summaryYearsMarker } = createRouterHarness();
  const parsed = callRouterAction(c, 'getDashboardSummaryYears');
  assert.equal(parsed.status, 200, 'a public action must not fall through to the 401 authorization gate');
  assert.deepEqual(parsed.data, summaryYearsMarker, 'the router must dispatch to the summary-years seam and return its aggregate payload');
});

test('#22.B9 (control) unauthenticated callers still get 401 for a non-public protected action (preservation)', () => {
  const { context: c } = createRouterHarness();
  const parsed = callRouterAction(c, 'saveDashboardSummary');
  assert.equal(parsed.status, 401, 'the authorization gate itself must remain fail-closed');
});
