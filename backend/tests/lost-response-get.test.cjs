/**
 * Issue #156 — a Lost Response (CONTEXT.md §50) must not look like an expired session.
 *
 * Google sometimes answers a POST with a redirect that the browser follows as a body-less GET.
 * The router therefore refuses every GET with one fixed 405, before any token lookup, action
 * dispatch or spreadsheet access, so a 401 can only come from a POST that arrived with its body.
 *
 * Seam: Router.js `doGet(e)` / `doPost(e)` in a vm context with stubbed globals.
 * All fixtures are synthetic; no real accounts, tokens, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROUTED = [
  'verifyGoogleToken', 'loginWithGoogle', 'createUser', 'getTargetConfig',
  'getDashboardSummaries', 'getDashboardSummariesMultiYear', 'getDashboardSummaryYears',
  'getVaccineRules', 'getAvailableYears', 'validateOpenDataRequest', 'getCachedOpenData',
  'getAllUsers', 'setupDatabase', 'syncOpenData', 'setupOpenDataTrigger', 'preflightEpiImport',
  'confirmEpiImport', 'upsertEpiData', 'cleanupEpiData', 'previewEpiImportUndo', 'undoEpiImport',
  'getFacilities', 'getAuditLogs', 'upsertFacility', 'getAuthorizedEpiData', 'updateUserStatus',
  'updateUserFacility', 'deleteSession', 'saveDashboardSummary', 'saveAiAnalysis',
  'analyzeVaccineData', 'seedVaccineRules', 'saveVaccineRule', 'cloneRulesFromYear',
  'batchSaveRules', 'suggestRuleTargetAges', 'suggestRuleDateChecks', 'getLatestImportTime',
  'migrateVaccineMetricKeys',
];

function routerHarness(authResult = { valid: true, role: 'admin', email: 'admin@example.test' }) {
  const calls = [];
  const logs = [];
  const record = level => (...args) => logs.push({ level, text: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') });
  const context = vm.createContext({
    console: { log: record('log'), info: record('info'), warn: record('warn'), error: record('error') },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }),
    },
    validateTokenAndGetRole: token => { calls.push({ name: 'validateTokenAndGetRole', args: [token] }); return authResult; },
    getSpreadsheet: () => { calls.push({ name: 'getSpreadsheet' }); throw new Error('no spreadsheet in a GET'); },
    SpreadsheetApp: { openById: () => { calls.push({ name: 'openById' }); throw new Error('no spreadsheet in a GET'); } },
  });
  for (const name of ROUTED) context[name] = (...args) => { calls.push({ name, args }); return { success: true, stub: name }; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), context);
  return { context, calls, logs };
}

const TOKEN = 'synthetic-session-token-0001';

test('#156 doGet: every GET gets the one fixed 405, whatever its parameters', () => {
  for (const parameter of [
    {},
    { action: 'upsertEpiData' },
    { action: 'getDashboardSummaries', fiscalYear: '2569' },
    { action: 'getEpiData', hoscode: '00588', auth_token: TOKEN },
  ]) {
    const { context } = routerHarness();
    const out = context.doGet({ parameter, parameters: {}, queryString: '' });
    assert.equal(out.status, 405, `GET ${JSON.stringify(parameter)} is refused`);
    assert.deepEqual(out.data, { error: 'GET is not supported' });
  }
});

test('#156 doGet: no token check, no handler and no spreadsheet run for any GET', () => {
  for (const action of [undefined, 'upsertEpiData', 'getDashboardSummaries', 'getEpiData', 'setup']) {
    const { context, calls } = routerHarness();
    context.doGet({ parameter: action ? { action, auth_token: TOKEN } : {} });
    assert.deepEqual(calls, [], `GET ${action} touched nothing`);
  }
});

test('#156 doGet: logs the parameter names and the action value, never a token value', () => {
  const { context, logs } = routerHarness();
  context.doGet({ parameter: { action: 'upsertEpiData', auth_token: TOKEN, hoscode: '00588' } });
  const text = logs.map(l => l.text).join('\n');
  assert.match(text, /auth_token/);
  assert.match(text, /hoscode/);
  assert.match(text, /upsertEpiData/);
  assert.doesNotMatch(text, new RegExp(TOKEN), 'the token value is never logged');
  assert.doesNotMatch(text, /00588/, 'no parameter value other than action is logged');
});

test('#156 doGet: a GET with no parameter object is still refused with 405', () => {
  const { context, calls } = routerHarness();
  assert.equal(context.doGet(undefined).status, 405);
  assert.equal(context.doGet({}).status, 405);
  assert.deepEqual(calls, []);
});

test('#156 doPost: a public and a protected action behave as before', () => {
  const post = (h, action, body = {}) => h.context.doPost({
    parameter: { action },
    postData: { contents: JSON.stringify({ action, auth_token: TOKEN, ...body }) },
  });

  // getDashboardSummaries checks a token it is given since Issue #200 (facility-breakdown-access.test.cjs)
  const pub = routerHarness();
  const years = post(pub, 'getDashboardSummaryYears');
  assert.equal(years.status, 200);
  assert.deepEqual(pub.calls.map(c => c.name), ['getDashboardSummaryYears'], 'a public action needs no token check');

  const admin = routerHarness();
  const preview = post(admin, 'previewEpiImportUndo', { targetTable: 'Epi_1_Year', fiscalYear: '2569' });
  assert.equal(preview.status, 200);
  assert.deepEqual(admin.calls.map(c => c.name), ['validateTokenAndGetRole', 'previewEpiImportUndo']);
  assert.equal(admin.calls[0].args[0], TOKEN);

  const expired = routerHarness({ valid: false, error: 'Session expired' });
  const refused = post(expired, 'previewEpiImportUndo', { targetTable: 'Epi_1_Year', fiscalYear: '2569' });
  assert.equal(refused.status, 401, 'a POST with a bad session still gets 401');
});
