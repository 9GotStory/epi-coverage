/**
 * Issue #200 (#197, ADR-0014) — the Facility Breakdown (CONTEXT.md §57) is not public.
 *
 * `getDashboardSummaries` and `getDashboardSummariesMultiYear` stay public. With no token they
 * return the summaries without `facilityBreakdownV1/V2`; with a valid token they return them
 * unchanged; with a token the server no longer accepts they answer 401 (a Session End, §51).
 *
 * Seam: Router.js `doPost(e)` with the real DashboardCache.js over a synthetic
 * Dashboard_Summaries sheet, and `validateTokenAndGetRole` stubbed.
 * All fixtures are synthetic aggregates; no real facilities, accounts, tokens or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SUMMARY_HEADER = ['id', 'targetTable', 'fiscalYear', 'summaryData', 'updated_at'];
const TOKEN = 'synthetic-session-token-0200';

const FACILITY_V1 = [{ hoscode: '00001', hosname: 'รพ.สต.ทดสอบหนึ่ง', total: 12, passed: 9, coverage: 75 }];
const FACILITY_V2 = [
  { hoscode: '00001', hosname: 'รพ.สต.ทดสอบหนึ่ง', total: 3, passed: 2, coverage: 66.7 },
  { hoscode: '07002', hosname: 'รพ.สต.ทดสอบสอง', total: 4, passed: 4, coverage: 100 },
];

/** A synthetic summary with every district-level field and a Facility Breakdown per view. */
function summaryData(overrides = {}) {
  return {
    total: 7,
    view1Coverage: 75, view1PassedDoses: 9, view1TotalDoses: 12, view1UnknownDoses: 0, view1ReviewDoses: 0,
    view2Coverage: 85.7, view2Passed: 6, view2ApplicableTotal: 7, view2PendingCount: 0,
    view2NotEvaluableCount: 0, view2ReviewCount: 0,
    view1Breakdown: [{ name: 'BCG', passed: 7, total: 7, coverage: 100, metric_key: 'bcg' }],
    view2Breakdown: [{ name: 'BCG', passed: 7, total: 7, coverage: 100, metric_key: 'bcg' }],
    facilityBreakdownV1: FACILITY_V1,
    facilityBreakdownV2: FACILITY_V2,
    ...overrides,
  };
}

const ROWS = [
  ['Epi_1_Year_2569_all', 'Epi_1_Year', 2569, JSON.stringify(summaryData()), '2026-11-01T00:00:00.000Z'],
  ['Epi_1_Year_2569_1', 'Epi_1_Year', 2569, JSON.stringify(summaryData({ total: 2 })), '2026-11-01T00:00:00.000Z'],
  // Legacy annual row (no `_all` sibling for this table and year)
  ['Epi_2_Year_2568', 'Epi_2_Year', 2568, JSON.stringify(summaryData({ total: 5 })), '2025-11-01T00:00:00.000Z'],
];

function harness(authResult) {
  const calls = [];
  const cells = [[...SUMMARY_HEADER], ...ROWS.map(row => [...row])];
  const sheet = { getDataRange: () => ({ getValues: () => cells.map(row => [...row]) }) };
  const context = vm.createContext({
    console,
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }),
    },
    getSpreadsheet: () => ({ getSheetByName: name => (name === 'Dashboard_Summaries' ? sheet : null) }),
    validateTokenAndGetRole: token => { calls.push(token); return authResult; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/DashboardCache.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), context);
  return { context, calls };
}

function post(context, action, body) {
  return context.doPost({ parameter: { action }, postData: { contents: JSON.stringify({ action, ...body }) } });
}

const REQUESTS = [
  ['getDashboardSummaries', { fiscalYear: 2569, quarter: 'all' }],
  ['getDashboardSummaries', { fiscalYear: 2569, quarter: '1' }],
  ['getDashboardSummaries', { fiscalYear: 2568, quarter: 'all' }],
  ['getDashboardSummariesMultiYear', { fiscalYears: [2568, 2569] }],
];

test('#200 no token: the summaries come back without a Facility Breakdown, district fields intact', () => {
  for (const [action, body] of REQUESTS) {
    const { context } = harness({ valid: false, error: 'No token provided' });
    const out = post(context, action, body);
    assert.equal(out.status, 200, `${action} ${JSON.stringify(body)} stays public`);
    assert.equal(out.data.success, true);
    assert.ok(out.data.summaries.length > 0, `${action} ${JSON.stringify(body)} returns summaries`);
    for (const summary of out.data.summaries) {
      const { facilityBreakdownV1, facilityBreakdownV2, ...districtFields } = summaryData({ total: summary.summaryData.total });
      assert.ok(!('facilityBreakdownV1' in summary.summaryData), `${summary.id} has no View 1 Facility Breakdown`);
      assert.ok(!('facilityBreakdownV2' in summary.summaryData), `${summary.id} has no View 2 Facility Breakdown`);
      assert.deepEqual(summary.summaryData, districtFields, `${summary.id} keeps every district-level field`);
    }
  }
});

test('#200 valid token: the summaries come back with the Facility Breakdown unchanged', () => {
  for (const [action, body] of REQUESTS) {
    const { context, calls } = harness({ valid: true, role: 'user', email: 'user@example.test', hoscode: '00001' });
    const out = post(context, action, { ...body, auth_token: TOKEN });
    assert.equal(out.status, 200);
    assert.deepEqual(calls, [TOKEN], `${action} checks the token it was given`);
    for (const summary of out.data.summaries) {
      assert.deepEqual(summary.summaryData.facilityBreakdownV1, FACILITY_V1, `${summary.id} View 1`);
      assert.deepEqual(summary.summaryData.facilityBreakdownV2, FACILITY_V2, `${summary.id} View 2, every Facility`);
      assert.equal(summary.summaryData.facilityBreakdownV2[1].hoscode, '07002', 'hoscode keeps its leading zero as a string');
    }
  }
});

test('#200 rejected token: 401 (a Session End) and no summary in the body', () => {
  for (const error of ['Token expired', 'Account is not approved', 'Invalid token or session not found']) {
    for (const [action, body] of REQUESTS) {
      const { context, calls } = harness({ valid: false, error });
      const out = post(context, action, { ...body, auth_token: TOKEN });
      assert.equal(out.status, 401, `${action} with a rejected token (${error}) is a Session End`);
      assert.deepEqual(calls, [TOKEN]);
      assert.ok(!('summaries' in out.data), 'no summary leaves the server');
      assert.doesNotMatch(JSON.stringify(out), /00001|07002|facilityBreakdown/);
    }
  }
});
