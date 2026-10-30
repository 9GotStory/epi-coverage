/**
 * Issue #80 RED contracts — minor findings batch from the system review.
 *
 * Backend seams under test, through the real public functions:
 *   1. Router no longer dispatches the dead admin action `getUsers` (defined
 *      nowhere → ReferenceError/500). It must fall through to the ordinary
 *      "Unknown action" 400 for an authenticated admin.
 *   2. `createSession` persists a SHA-256 digest of the Google access token,
 *      never the live credential (docs/schema.md §8 contract).
 *   3. `getEpiData` treats blank/missing `is_active` as NOT active (fail closed
 *      for hand-edited rows) — only an explicit TRUE is active.
 *   4. Public `getVaccineRules` projects out the admin-only `updated_by` column.
 *   5. Audit identity comes from the authenticated session (`authResult`),
 *      not client-supplied `body.adminEmail` or hardcoded 'Admin'/'SYSTEM'.
 *   6. `saveAiAnalysis` audit details carry no individual CID (data minimization).
 *   7. `getLatestImportTime` returns ONLY the newest `cleanup_epi_data`
 *      timestamp so regular `user` roles can render the as-of date without
 *      access to the full audit log.
 *   8. `saveVaccineRule`/`batchSaveRules` reject duplicate ACTIVE display_name
 *      within (fiscal_year, age_group, view_type) — evaluation results are
 *      keyed by display_name, so duplicates double-count doses and can push
 *      View 1 coverage past 100%.
 *
 * All fixtures are synthetic; no real accounts, tokens, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const src = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Harness A — Router.js with stubbed actions and a recorded dispatch log
// ─────────────────────────────────────────────────────────────────────────────
function routerHarness(authResult) {
  const calls = [];
  const outputs = [];
  const stub = name => (...args) => { calls.push({ name, args }); return { success: true, stub: name }; };
  const context = vm.createContext({
    console: { error() {}, log() {}, warn() {} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => { outputs.push(JSON.parse(text)); return {}; } }),
    },
    validateTokenAndGetRole: () => authResult,
  });
  for (const name of [
    'verifyGoogleToken', 'loginWithGoogle', 'createUser', 'getTargetConfig',
    'getDashboardSummaries', 'getDashboardSummariesMultiYear', 'getDashboardSummaryYears',
    'getVaccineRules', 'getAvailableYears', 'validateOpenDataRequest', 'getCachedOpenData',
    'getAllUsers', 'setupDatabase', 'syncOpenData', 'setupOpenDataTrigger', 'upsertEpiData',
    'cleanupEpiData', 'getFacilities', 'getAuditLogs', 'upsertFacility', 'getAuthorizedEpiData',
    'updateUserStatus', 'updateUserFacility', 'deleteSession', 'saveDashboardSummary',
    'saveAiAnalysis', 'analyzeVaccineData', 'seedVaccineRules', 'saveVaccineRule',
    'cloneRulesFromYear', 'batchSaveRules', 'suggestRuleTargetAges', 'suggestRuleDateChecks',
    'getLatestImportTime',
  ]) context[name] = stub(name);
  // NOTE: `getUsers` is deliberately NOT defined anywhere — that is the dead action.
  vm.runInContext(src('Router.js'), context);
  const post = (action, body = {}) => context.handleRequest('POST', {
    parameter: { action },
    postData: { contents: JSON.stringify({ action, ...body }) },
  });
  return { calls, outputs, post, lastOutput: () => outputs[outputs.length - 1] };
}

const ADMIN_AUTH = { valid: true, userId: 'admin-1', role: 'admin', hoscode: '00588', email: 'real-admin@example.test' };
const USER_AUTH = { valid: true, userId: 'user-1', role: 'user', hoscode: '06422', email: 'user@example.test' };

test('#80-1 Router: the dead getUsers action is gone — admins get the ordinary 400, not a ReferenceError 500', () => {
  const h = routerHarness(ADMIN_AUTH);
  h.post('getUsers');
  const out = h.lastOutput();
  assert.equal(out.status, 400, 'unknown action falls through to 400, never a 500 crash');
  assert.match(out.data.error, /Unknown action/);
  assert.equal(h.calls.find(c => c.name === 'getAllUsers'), undefined, 'user listing still requires the real getAllUsers action');
});

test('#80-5 Router: mutating admin actions attribute the authenticated session, never body.adminEmail', () => {
  const h = routerHarness(ADMIN_AUTH);
  const spoof = 'spoofed@example.test';
  h.post('upsertFacility', { hoscode: '06422', hosname: 'x', isActive: true, adminEmail: spoof });
  h.post('updateUserStatus', { googleId: 'g', status: 'approved', adminEmail: spoof });
  h.post('updateUserFacility', { googleId: 'g', hoscode: '06422', adminEmail: spoof });
  h.post('seedVaccineRules', { fiscalYear: 2569, adminEmail: spoof });
  h.post('saveVaccineRule', { rule: { rule_id: 'r' }, adminEmail: spoof });
  h.post('cloneVaccineRules', { fromYear: 2568, toYear: 2569, adminEmail: spoof });
  h.post('batchSaveRules', { fiscalYear: 2569, ageGroup: '1yr', rules: [], adminEmail: spoof });

  const arg = (name, n) => h.calls.find(c => c.name === name).args[n];
  assert.equal(arg('upsertFacility', 3), ADMIN_AUTH.email);
  assert.deepEqual(arg('updateUserStatus', 3), ADMIN_AUTH);
  assert.deepEqual(arg('updateUserFacility', 2), ADMIN_AUTH);
  assert.equal(arg('seedVaccineRules', 1), ADMIN_AUTH.email);
  assert.equal(arg('saveVaccineRule', 1), ADMIN_AUTH.email);
  assert.equal(arg('cloneRulesFromYear', 2), ADMIN_AUTH.email);
  assert.equal(arg('batchSaveRules', 3), ADMIN_AUTH.email);
});

test('#80-8 Router: getLatestImportTime is reachable by a regular user (no admin gate)', () => {
  const h = routerHarness(USER_AUTH);
  h.post('getLatestImportTime');
  assert.equal(h.lastOutput().status, 200);
  assert.equal(h.calls.find(c => c.name === 'getLatestImportTime') !== undefined, true);
  // The full audit log stays admin-gated for the same caller.
  const sameUser = routerHarness(USER_AUTH);
  sameUser.post('getAuditLogs');
  assert.equal(sameUser.lastOutput().status, 403);
});

// ─────────────────────────────────────────────────────────────────────────────
// Harness B — Auth.js / Data.js / Upload.js over synthetic sheets
// ─────────────────────────────────────────────────────────────────────────────
function sheetHarness() {
  const sheets = new Map();
  const audit = [];
  function createSheet(name, initial = []) {
    const cells = initial.map(row => [...row]);
    let maxRows = Math.max(2, cells.length), maxColumns = 10;
    const sheet = {
      cells, getName: () => name, getLastRow: () => cells.length,
      getLastColumn: () => Math.max(0, ...cells.map(row => row.length)),
      getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
      insertColumnsAfter(_, count) { maxColumns += count; },
      insertRowsAfter(_, count) { maxRows += count; },
      getDataRange() { return this.getRange(1, 1, Math.max(1, cells.length), Math.max(1, this.getLastColumn())); },
      getRange(row, column, height = 1, width = 1) {
        assert.ok(column + width - 1 <= maxColumns, 'must expand columns before writing');
        assert.ok(row + height - 1 <= maxRows, 'must expand rows before writing');
        return {
          getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? '')); },
          setValues(values) {
            assert.equal(values.length, height);
            values.forEach((entry, i) => {
              assert.equal(entry.length, width);
              cells[row - 1 + i] ||= [];
              entry.forEach((value, j) => { cells[row - 1 + i][column - 1 + j] = value; });
            });
            return this;
          },
          setValue(value) { cells[row - 1][column - 1] = value; return this; },
          setNumberFormat() { return this; }, setFontWeight() { return this; },
        };
      },
      appendRow(values) { cells.push([...values]); if (cells.length > maxRows) maxRows = cells.length; return this; },
      deleteRow(n) { cells.splice(n - 1, 1); },
    };
    if (sheet.getLastColumn() > maxColumns) maxColumns = sheet.getLastColumn();
    sheets.set(name, sheet);
    return sheet;
  }
  const ss = {
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: name => sheets.get(name), getSheets: () => [...sheets.values()],
    insertSheet: name => createSheet(name),
  };
  const context = vm.createContext({
    getSpreadsheet: () => ss, console: { error() {}, log() {}, warn() {} },
    logAction: (userId, email, action, details) => audit.push({ userId, email, action, details }),
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
    Utilities: {
      formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value),
      getUuid: () => 'uuid',
      DigestAlgorithm: { SHA_256: 'sha256' },
      // GAS computeDigest returns a plain number array (not a Buffer — Buffer#join would
      // decode bytes instead of concatenating the mapped hex strings)
      computeDigest: (_, data) => Array.from(crypto.createHash('sha256').update(String(data)).digest()),
      base64Encode: data => Buffer.from(data).toString('base64'),
    },
  });
  for (const file of ['SheetText.js', 'Setup.js', 'Auth.js', 'Data.js', 'Upload.js']) vm.runInContext(src(file), context);
  // Data.js re-declares logAction — reinstate the capturing recorder AFTER loading (same pattern as hdc-import.test.cjs).
  context.logAction = (userId, email, action, details) => audit.push({ userId, email, action, details });
  return { context, sheets, createSheet, audit };
}

test('#80-2 createSession stores a token digest, never the live Google access token', () => {
  const h = sheetHarness();
  h.createSheet('sessions', [['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at']]);
  const secret = 'ya29.a0ARrdaM-synthetic-secret';
  const result = h.context.createSession('user-1', secret, '1.2.3.4', 'test-agent');
  assert.equal(result.success, true);
  const stored = h.sheets.get('sessions').cells[1];
  assert.notEqual(stored[2], secret, 'the raw credential must never be at rest');
  assert.ok(stored[2].length >= 40, 'a substantial one-way digest is stored for inspection');
  assert.equal(crypto.createHash('sha256').update(secret).digest('hex'), stored[2], 'the digest is the SHA-256 hex of the token');
});

test('#80-2b migrateSessionsTokenDigest scrubs raw tokens already persisted before the fix (run-once)', () => {
  const h = sheetHarness();
  h.createSheet('sessions', [['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at']]);
  const legacyRaw = 'ya29.legacy-raw-secret';
  const alreadyDigested = crypto.createHash('sha256').update('ya29.done').digest('hex');
  h.sheets.get('sessions').appendRow(['s-1', 'u-1', legacyRaw, '1.1.1.1', 'agent', '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z']);
  h.sheets.get('sessions').appendRow(['s-2', 'u-2', alreadyDigested, '2.2.2.2', 'agent', '2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
  h.sheets.get('sessions').appendRow(['s-3', 'u-3', '', '3.3.3.3', 'agent', '2026-10-03T00:00:00.000Z', '2026-10-02T00:00:00.000Z']);

  const result = h.context.migrateSessionsTokenDigest();
  assert.equal(result.success, true);
  assert.equal(result.migrated, 1, 'only the raw legacy credential is rewritten');
  const rows = h.sheets.get('sessions').cells;
  assert.equal(crypto.createHash('sha256').update(legacyRaw).digest('hex'), rows[1][2], 'raw token becomes its digest');
  assert.equal(rows[2][2], alreadyDigested, 'an already-digested token is untouched');
  assert.equal(rows[3][2], '', 'empty tokens stay empty');
  assert.equal(rows[1][0], 's-1', 'surrounding columns are preserved by the single batch write');
  // Idempotent: a second run finds nothing to migrate.
  assert.equal(h.context.migrateSessionsTokenDigest().migrated, 0);
});

test('#80-3 getEpiData fails closed: blank is_active is NOT active — only explicit TRUE is', () => {
  const h = sheetHarness();
  const headers = h.context.getEpiSchemas().Epi_1_Year;
  const epiRow = overrides => headers.map(field => ({
    hoscode: '06422', hosname: 'รพ.สต.จำลอง', pid: '0000', cid: '0000000000000',
    name: 'ข้อมูล', lname: 'จำลอง', sex: '1', birth: '2025-01-01', check_vhid: '',
    fiscal_year: '2569', ...overrides,
  }[field] ?? ''));
  h.createSheet('Epi_1_Year', [headers,
    epiRow({ pid: '0001', is_active: true }),
    epiRow({ pid: '0002', is_active: '' }),
    epiRow({ pid: '0003', is_active: false }),
    epiRow({ pid: '0004', is_active: 'TRUE' }),
  ]);
  // Spread into a host array — the VM realm's array prototype fails deepStrictEqual.
  const pids = [...h.context.getEpiData('06422', 'Epi_1_Year', null).map(r => r.pid)];
  assert.deepEqual(pids, ['0001', '0004'], 'boolean true and the string TRUE stay active; blank and FALSE do not');
});

test('#80-6 saveAiAnalysis audit carries no individual CID', () => {
  const h = sheetHarness();
  const headers = h.context.getEpiSchemas().Epi_1_Year;
  const cid = '0000000000009';
  const epiRow = overrides => headers.map(field => ({
    hoscode: '06422', hosname: 'รพ.สต.จำลอง', pid: '0009', cid,
    name: 'ข้อมูล', lname: 'จำลอง', sex: '1', birth: '2025-01-01', check_vhid: '',
    fiscal_year: '2569', is_active: true, ...overrides,
  }[field] ?? ''));
  h.createSheet('Epi_1_Year', [headers, epiRow()]);
  const auth = { userId: 'user-1', role: 'user', hoscode: '06422', email: 'user@example.test' };
  const result = h.context.saveAiAnalysis(
    { hoscode: '06422', pid: '0009', cid, sex: '1', birth: '2025-01-01', check_vhid: '' },
    'Epi_1_Year', 'ผลวิเคราะห์จำลอง', auth,
  );
  assert.equal(result.success, true);
  const entry = h.audit.find(a => a.action === 'save_ai_analysis');
  assert.ok(entry, 'the audit event exists');
  assert.ok(!entry.details.includes(cid), 'audit details must not persist an individual CID');
});

test('#80-5 Auth/Data/Upload: audit attribution uses the authenticated identity, not hardcoded Admin', () => {
  const h = sheetHarness();
  h.createSheet('Users', [['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'],
    ['u-2', 'g-2', 'target@example.test', 'เป้าหมาย', '06423', 'user', 'pending', '', '']]);
  const admin = { userId: 'admin-1', role: 'admin', hoscode: '00588', email: 'real-admin@example.test' };
  h.context.updateUserStatus('g-2', 'approved', null, admin);
  let entry = h.audit.at(-1);
  assert.equal(entry.email, admin.email);
  assert.equal(entry.userId, admin.userId);
  assert.ok(!String(entry.email).includes('Admin'), 'no generic Admin attribution');

  h.context.updateUserFacility('g-2', '06499', admin);
  entry = h.audit.at(-1);
  assert.equal(entry.email, admin.email);

  h.createSheet('facilities', [['hoscode', 'hosname', 'is_active']]);
  h.context.upsertFacility('06499', 'รพ.สต.จำลอง', true, admin.email);
  entry = h.audit.find(a => a.action === 'add_facility');
  assert.equal(entry.email, admin.email, 'facility audit attributes the email the Router authenticated');
});

test('#80-7 getLatestImportTime returns only the newest cleanup timestamp — no emails, no details', () => {
  const h = sheetHarness();
  h.createSheet('audit_logs', [['log_id', 'user_id', 'email', 'action', 'details', 'timestamp'],
    ['l1', 'u1', 'a@example.test', 'cleanup_epi_data', 'Batch b1: 0 deactivated (merge).', '2026-10-01T02:00:00.000Z'],
    ['l2', 'u1', 'a@example.test', 'upload_excel', 'Batch b2 chunk 1/1', '2026-10-02T02:00:00.000Z'],
    ['l3', 'u1', 'a@example.test', 'cleanup_epi_data', 'Batch b3: 2 deactivated (sync).', '2026-10-03T02:00:00.000Z'],
  ]);
  const result = h.context.getLatestImportTime();
  assert.equal(result.success, true);
  assert.equal(result.timestamp, '2026-10-03T02:00:00.000Z');
  assert.deepEqual(Object.keys(result).sort(), ['success', 'timestamp'], 'the payload is data-minimized: nothing else leaks');

  const empty = sheetHarness();
  empty.createSheet('audit_logs', [['log_id', 'user_id', 'email', 'action', 'details', 'timestamp']]);
  assert.equal(empty.context.getLatestImportTime().timestamp, null, 'no imports yet → null, not a fabricated date');
});

// ─────────────────────────────────────────────────────────────────────────────
// Harness C — VaccineRules.js over the synthetic rules sheet
// ─────────────────────────────────────────────────────────────────────────────
const RULES_HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

function rulesHarness() {
  const cells = [RULES_HEADERS.slice()];
  const events = [];
  const lock = { acquired: 0, released: 0 };
  const sheet = {
    getName: () => 'vaccine_rules',
    getLastRow: () => cells.length,
    getDataRange() { events.push('sheet:read'); return { getValues: () => cells.map(row => Array.from({ length: RULES_HEADERS.length }, (_, i) => row[i] ?? '')) }; },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? '')); },
        setNumberFormat() { return this; },
        setValues(values) {
          values.forEach((entry, i) => { cells[row - 1 + i] = Array.from({ length: RULES_HEADERS.length }, (_, j) => entry[j] ?? ''); });
          return this;
        },
      };
    },
  };
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: name => (name === 'vaccine_rules' ? sheet : null) }),
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((key, i) => [key, row[i]])),
    logAction() {},
    console: { error() {}, log() {}, warn() {} },
    Utilities: { getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    LockService: {
      getScriptLock: () => ({
        waitLock() { lock.acquired++; events.push('lock:acquire'); },
        releaseLock() { lock.released++; events.push('lock:release'); },
      }),
    },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(src('SheetText.js'), context);
  vm.runInContext(src('VaccineRules.js'), context);
  return {
    context, cells, events, lock,
    readRules: (fy, age) => context.getVaccineRules(fy, age),
  };
}

const ruleFixture = (overrides = {}) => ({
  rule_id: 'r-1', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV',
  display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], branch_alt_fields: [],
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0, ...overrides,
});

test('#80-4 public getVaccineRules projects out the admin-only updated_by column', () => {
  const h = rulesHarness();
  assert.equal(h.context.saveVaccineRule(ruleFixture(), 'admin@example.test').success, true);
  const rules = h.readRules(2569, '1yr');
  assert.equal(rules.length, 1);
  assert.equal('updated_by' in rules[0], false, 'admin emails never leave through the public read');
  assert.equal(rules[0].display_name, 'HBV เข็ม 1', 'engine fields still project through');
});

test('#80-9a saveVaccineRule rejects a duplicate ACTIVE display_name within (year, age_group, view_type)', () => {
  const h = rulesHarness();
  assert.equal(h.context.saveVaccineRule(ruleFixture(), 'admin@example.test').success, true);
  // The duplicate decision must be made UNDER the rules lock on the same snapshot
  // being written (Issue #76 discipline) — deciding before the lock lets two
  // concurrent saves both pass validation and write the duplicate anyway.
  const lockBefore = h.lock.acquired;
  const clash = h.context.saveVaccineRule(ruleFixture({ rule_id: 'r-2' }), 'admin@example.test');
  assert.equal(clash.success, false);
  assert.match(clash.error, /display_name/);
  assert.equal(h.lock.acquired, lockBefore + 1, 'the duplicate check runs inside withRulesLock_');
  assert.equal(h.lock.released, h.lock.acquired, 'lock released after the rejected save');
  assert.equal(h.readRules(2569, '1yr').length, 1, 'nothing extra was written');

  // A whitespace-only rename is the SAME name (frontend/modal compares trimmed).
  const spaced = h.context.saveVaccineRule(ruleFixture({ rule_id: 'r-3', display_name: '  HBV เข็ม 1  ' }), 'admin@example.test');
  assert.equal(spaced.success, false, 'name comparison is trim-normalized on the backend too');
  assert.match(spaced.error, /display_name/);

  // Distinct view_type, an inactive duplicate, and renaming the same rule all stay legal.
  assert.equal(h.context.saveVaccineRule(ruleFixture({ rule_id: 'r-v2', view_type: 2 }), 'admin@example.test').success, true);
  assert.equal(h.context.saveVaccineRule(ruleFixture({ rule_id: 'r-off', is_active: false, display_name: 'ซ้ำชื่อ' }), 'admin@example.test').success, true);
  assert.equal(h.context.saveVaccineRule(ruleFixture({ rule_id: 'r-off', is_active: false, display_name: 'ซ้ำชื่อ' }), 'admin@example.test').success, true);
  assert.equal(h.context.saveVaccineRule(ruleFixture({ display_name: 'HBV เข็ม 1 (แก้ชื่อ)' }), 'admin@example.test').success, true);
});

test('#80-9b batchSaveRules rejects a set containing duplicate ACTIVE display_names in one view', () => {
  const h = rulesHarness();
  const batch = [ruleFixture({ rule_id: 'r-a' }), ruleFixture({ rule_id: 'r-b' })];
  const result = h.context.batchSaveRules(2569, '1yr', batch, 'admin@example.test');
  assert.equal(result.success, false);
  assert.match(result.error, /display_name/);
  assert.equal(h.cells.length, 1, 'the sheet stays header-only — the batch never landed');

  // Same name across different views is fine (evaluation keys per view).
  const okBatch = [
    ruleFixture({ rule_id: 'r-a', display_name: 'ชื่อเดียวกัน' }),
    ruleFixture({ rule_id: 'r-b', view_type: 2, display_name: 'ชื่อเดียวกัน' }),
    ruleFixture({ rule_id: 'r-c', is_active: false, display_name: 'ชื่อเดียวกัน' }),
  ];
  assert.equal(h.context.batchSaveRules(2569, '1yr', okBatch, 'admin@example.test').success, true);
});
