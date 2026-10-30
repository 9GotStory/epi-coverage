const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function setup() {
  const sheets = new Map();
  const numberFormats = [];
  let locked = false;
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
          setNumberFormat(format) { numberFormats.push({ sheet: name, row, column, height, width, format }); return this; },
          setFontWeight() { return this; }, setBackground() { return this; },
        };
      },
      appendRow(values) { cells.push([...values]); return this; },
      deleteRow(n) { cells.splice(n - 1, 1); return this; },
    };
    if (sheet.getLastColumn() > maxColumns) maxColumns = sheet.getLastColumn();
    sheets.set(name, sheet);
    return sheet;
  }
  const ss = { getSpreadsheetTimeZone: () => 'Asia/Bangkok', getSheetByName: name => sheets.get(name), getSheets: () => [...sheets.values()], insertSheet: name => createSheet(name) };
  const context = vm.createContext({
    getSpreadsheet: () => ss, console, logAction() {},
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: { flush() {} },
    Utilities: { formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value), getUuid: () => 'uuid', DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, data) => crypto.createHash('sha256').update(data).digest(), base64Encode: data => Buffer.from(data).toString('base64') },
  });
  for (const file of ['SheetText.js', 'Setup.js', 'Upload.js', 'Data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  context.logAction = () => {};
  const read = (table = 'Epi_1_Year') => {
    const values = sheets.get(table).getDataRange().getValues();
    return values.slice(1).map(row => Object.fromEntries(values[0].map((field, index) => [field, row[index]])));
  };
  return { context, sheets, createSheet, read, isLocked: () => locked, numberFormats };
}
const person = (overrides = {}) => ({ hoscode: '00588', hosname: 'ทดสอบ', pid: '0001', cid: '0000000000001', name: 'ข้อมูล', lname: 'จำลอง', birth: '2025-01-01', bcg_date: '2025-01-01', ...(overrides.cid ? { pid: String(Number(overrides.cid) || 1) } : {}), ...overrides });
const upload = (c, rows, batch, year = 2569, table = 'Epi_1_Year', options = {}) => c.upsertEpiData(rows, batch, 'admin', year, table, options);
const finish = (c, batch, year = 2569) => c.cleanupEpiData(batch, ['99999'], 'admin', year, 'Epi_1_Year');

test('every dose has both facility columns and all ages preserve HDC fields', () => {
  const { context: c, read } = setup();
  for (const age of [1, 2, 3, 5]) {
    const table = `Epi_${age}_Year`, schema = c.getEpiSchemas()[table];
    for (const date of schema.filter(field => field.endsWith('_date'))) {
      assert.ok(schema.includes(date.replace('_date', '_hospcode')));
      assert.ok(schema.includes(date.replace('_date', '_input_hosp')));
    }
    assert.equal(upload(c, [person({ addr: '001/2', check_typearea: '1', bcg_hospcode: '00001', bcg_input_hosp: '00002', g_hbv: '1' })], `age-${age}`, 2569, table).success, true);
    const row = read(table)[0];
    assert.equal(row.bcg_input_hosp, '00002'); assert.equal(row.addr, '001/2'); assert.equal(row.g_hbv, '1');
  }
});

test('legacy migration is append-only, repeatable and expands columns', () => {
  const { context: c, createSheet, sheets, read } = setup();
  createSheet('Epi_1_Year', [['hoscode', 'cid', 'fiscal_year', 'addr', 'pid', 'birth'], ['00588', '0000000000001', '2569', 'old', '0001', '2025-01-01']]);
  assert.equal(upload(c, [person()], 'migrate').success, true);
  assert.deepEqual(sheets.get('Epi_1_Year').cells[0].slice(0, 4), ['hoscode', 'cid', 'fiscal_year', 'addr']);
  assert.equal(read()[0].addr, 'old');
  const count = sheets.get('Epi_1_Year').getLastColumn();
  upload(c, [person()], 'again');
  assert.equal(sheets.get('Epi_1_Year').getLastColumn(), count);
});

test('missing columns preserve data, explicit blanks clear it and provenance survives legacy uploads', () => {
  const { context: c, read } = setup();
  upload(c, [person({ bcg_input_hosp: '00002', addr: '001', check_typearea: '3' })], 'full');
  assert.equal(upload(c, [person({ name: 'ชื่อแก้ไข' })], 'legacy').updated, 1);
  assert.equal(read().length, 1); assert.equal(read()[0].bcg_input_hosp, '00002');
  assert.ok(JSON.parse(read()[0].source_columns).includes('bcg_input_hosp'));
  upload(c, [person({ bcg_input_hosp: null })], 'clear');
  assert.equal(read()[0].bcg_input_hosp, ''); assert.equal(read()[0].addr, '001');
});

test('same CID is isolated by year and facility; duplicate records do not create rows', () => {
  const { context: c, read } = setup();
  upload(c, [person(), person()], 'a');
  upload(c, [person()], 'b', 2570);
  upload(c, [person({ hoscode: '00002' })], 'c');
  assert.equal(read().length, 3);
  assert.equal(c.getEpiData('00588', 'Epi_1_Year', 2569).length, 2);
});

test('replayed chunks are idempotent and changed replays are rejected', () => {
  const { context: c, read } = setup();
  upload(c, [person()], 'retry');
  assert.equal(upload(c, [person()], 'retry').replayed, true);
  assert.equal(upload(c, [person({ addr: 'changed' })], 'retry').success, false);
  assert.equal(read().length, 1);
});

test('incomplete batch cannot cleanup; complete sync uses validated facility scope only', () => {
  const { context: c, read } = setup();
  upload(c, [person(), person({ cid: '0000000000002' }), person({ hoscode: '99999' })], 'old');
  upload(c, [person()], 'other-year', 2570);
  upload(c, [person()], 'sync', 2569, 'Epi_1_Year', { mode: 'sync', chunkIndex: 0, totalChunks: 2 });
  assert.equal(finish(c, 'sync').success, false);
  assert.equal(read().every(row => row.is_active), true);
  upload(c, [person({ cid: '0000000000003' })], 'sync', 2569, 'Epi_1_Year', { mode: 'sync', chunkIndex: 1, totalChunks: 2 });
  assert.equal(finish(c, 'sync').deactivated, 1);
  assert.equal(read().find(row => row.hoscode === '99999').is_active, true);
  assert.equal(read().find(row => row.fiscal_year === '2570').is_active, true);
  assert.equal(finish(c, 'sync').replayed, true);
});

test('merge finalization never deactivates missing people', () => {
  const { context: c, read } = setup();
  upload(c, [person(), person({ cid: '0000000000002' })], 'old');
  upload(c, [person()], 'merge');
  assert.equal(finish(c, 'merge').deactivated, 0);
  assert.equal(read().every(row => row.is_active), true);
});

test('older overlapping batches cannot overwrite or deactivate newer imports', () => {
  const { context: c } = setup();
  upload(c, [person()], 'old', 2569, 'Epi_1_Year', { mode: 'sync', totalChunks: 2 });
  upload(c, [person()], 'new');
  assert.equal(upload(c, [person()], 'old', 2569, 'Epi_1_Year', { mode: 'sync', totalChunks: 2, chunkIndex: 1 }).success, false);
  assert.equal(finish(c, 'old').success, false);
});

test('invalid records and non-EPI tables are rejected before a sheet write', () => {
  for (const change of [{ bcg_input_hosp: 588 }, { birth: '2025-02-30' }, { ai_analysis: 'injected' }, { extra_column: 'lost' }]) {
    const { context: c, sheets } = setup();
    assert.equal(upload(c, [person(change)], 'invalid').success, false);
    assert.equal(sheets.size, 0);
  }
  const { context: c, sheets } = setup();
  assert.equal(upload(c, [person()], 'invalid', 2569, 'Users').success, false);
  assert.equal(sheets.size, 0);
});

test('reads enforce account facility scope even when request claims district access', () => {
  const { context: c } = setup();
  upload(c, [person(), person({ hoscode: '00002' })], 'read');
  assert.equal(c.getAuthorizedEpiData({ role: 'user', hoscode: '00002' }, '00588', 'Epi_1_Year', 2569).length, 1);
  assert.equal(c.getAuthorizedEpiData({ role: 'admin', hoscode: '00002' }, '00588', 'Epi_1_Year', 2569).length, 2);
  assert.throws(() => c.getAuthorizedEpiData({ role: 'user', hoscode: '' }, '00588', 'Epi_1_Year', 2569));
});

test('PII endpoints and schema migration are not public routes', () => {
  const { context: c } = setup();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), c);
  c.responseJson = (data, status = 200) => ({ data, status });
  c.validateTokenAndGetRole = () => ({ valid: false, error: 'No session' });
  for (const action of ['getEpiData', 'debugGetEpiData', 'debugBounds', 'setup']) {
    assert.equal(c.handleRequest('GET', { parameter: { action, hoscode: '00588' } }).status, 401);
  }
});

test('masked duplicate CIDs remain distinct by PID across repeated imports', () => {
  const { context: c, read } = setup();
  const rows = [person({ cid: '123456*******', pid: '001' }), person({ cid: '123456*******', pid: '002' })];
  assert.equal(upload(c, rows, 'masked').inserted, 2);
  assert.equal(upload(c, rows, 'masked-again').updated, 2);
  assert.equal(read().length, 2);
  assert.equal(upload(c, [person({ cid: '123456*******', pid: '' })], 'no-pid').success, false);
});

test('a complete older sync cannot deactivate a newer overlapping import', () => {
  const { context: c, read } = setup();
  upload(c, [person()], 'old-complete', 2569, 'Epi_1_Year', { mode: 'sync' });
  upload(c, [person({ cid: '0000000000002' })], 'newer');
  assert.equal(finish(c, 'old-complete').success, false);
  assert.equal(read().every(row => row.is_active), true);
});

test('conflicting unmasked identity is rejected without overwriting the person', () => {
  const { context: c, read, isLocked } = setup();
  upload(c, [person()], 'initial');
  assert.throws(() => upload(c, [person({ cid: '0000000000002', pid: '0001' })], 'conflict'), /different unmasked CID/);
  assert.equal(read()[0].cid, '0000000000001');
  assert.equal(isLocked(), false);
  assert.equal(finish(c, 'conflict').success, false);
});

test('session validation provides stored facility and rejects expired or unapproved accounts', () => {
  const { context: c, createSheet } = setup();
  const session = createSheet('sessions', [['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at'],
    ['session', 'user', '', '', '', '2099-01-01', '2026-01-01']]);
  const users = createSheet('Users', [['id', 'role', 'status', 'hoscode', 'email'], ['user', 'user', 'approved', '00002', 'test@example.test']]);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), c);
  assert.equal(c.validateTokenAndGetRole('session').hoscode, '00002');
  users.cells[1][2] = 'pending';
  assert.equal(c.validateTokenAndGetRole('session').valid, false);
  users.cells[1][2] = 'approved'; session.cells[1][5] = 'invalid';
  assert.equal(c.validateTokenAndGetRole('session').valid, false);
  session.cells[1][5] = '2000-01-01';
  assert.equal(c.validateTokenAndGetRole('session').valid, false);
});


test('all ages keep identical PID/CID records separate when sex, birth or village differs', () => {
  for (const age of [1, 2, 3, 5]) {
    for (const cid of ['0000000000001', '123456*******']) {
      const { context: c, read } = setup();
      const table = `Epi_${age}_Year`;
      const base = person({ pid: '001', cid, sex: '1', check_vhid: '00123456' });
      const variants = [base, { ...base, sex: '2' }, { ...base, birth: '2025-01-02' }, { ...base, check_vhid: '00123457' }];
      assert.equal(upload(c, variants, 'variants', 2569, table).inserted, 4);
      assert.equal(upload(c, variants.map((row, i) => ({ ...row, addr: `address-${i}` })), 'updates', 2569, table).updated, 4);
      assert.equal(read(table).length, 4);
      assert.deepEqual(read(table).map(row => row.addr), ['address-0', 'address-1', 'address-2', 'address-3']);
      assert.equal(upload(c, [{ ...base, pid: '002' }], 'new-pid', 2569, table).inserted, 1);
    }
  }
});

test('calendar birth dates from native Sheets Date cells match normalized imports', () => {
  const { context: c, createSheet, read } = setup();
  createSheet('Epi_1_Year', [['hoscode', 'pid', 'cid', 'sex', 'birth', 'check_vhid', 'fiscal_year'],
    ['00588', '0001', '0000000000001', 1, new Date('2024-12-31T17:00:00.000Z'), '', 2569]]);
  assert.equal(upload(c, [person({ sex: '1', check_vhid: null })], 'date-normalized').updated, 1);
  assert.equal(read().length, 1);
  assert.equal(read()[0].birth, '2025-01-01');
});

test('AI composite key matches native Sheets Date-cell births without UTC-offset skew (Issue #75)', () => {
  const { c, call, read, sheets } = routerContext(ordinary);
  const own = person({ hoscode: '00002', cid: '0000000000002', sex: '1', check_vhid: '00123456' });
  upload(c, [own], 'ai-date');
  const sheet = sheets.get('Epi_1_Year');
  const birthCol = sheet.cells[0].indexOf('birth');
  // A native Sheets Date cell holds the calendar date at spreadsheet-timezone (Bangkok) midnight —
  // 2025-01-01T00:00+07:00 === 2024-12-31T17:00:00Z. Before Issue #75 the key comparison parsed the
  // client's '2025-01-01' as UTC midnight, so the instants never matched and every Date-cell row
  // came back "Record not found" for saveAiAnalysis/analyzeVaccineData.
  sheet.cells[1][birthCol] = new Date('2024-12-31T17:00:00.000Z');

  const key = { hoscode: own.hoscode, pid: own.pid, cid: own.cid, sex: own.sex, birth: '2025-01-01', check_vhid: own.check_vhid };
  assert.equal(call('saveAiAnalysis', { recordKey: key, targetTable: 'Epi_1_Year', aiAnalysis: 'date-cell ok' }).data.success, true,
    'a Date-typed birth cell must match the same calendar day from the client key');
  assert.equal(read()[0].ai_analysis, 'date-cell ok');

  // A genuinely different calendar day must remain a mismatch (the fix adds no tolerance).
  const wrongDay = { ...key, birth: '2025-01-02' };
  assert.equal(call('saveAiAnalysis', { recordKey: wrongDay, targetTable: 'Epi_1_Year', aiAnalysis: 'should not land' }).data.success, false,
    'a different calendar day stays a composite-key mismatch');
  assert.equal(read()[0].ai_analysis, 'date-cell ok');
});

function routerContext(auth, extra = {}) {
  const harness = setup();
  const { context: c } = harness;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), c);
  c.responseJson = (data, status = 200) => ({ data, status });
  let current = auth;
  c.validateTokenAndGetRole = () => current;
  c.setAuth = next => { current = next; };
  Object.assign(c, extra);
  return { ...harness, c, setAuth: c.setAuth, call: (action, body = {}) => c.handleRequest('POST', { parameter: { action }, postData: { contents: JSON.stringify({ action, ...body }) } }) };
}

const ordinary = { valid: true, userId: 'u1', role: 'user', hoscode: '00002', email: 'user@example.test' };
const administrator = { valid: true, userId: 'a1', role: 'admin', hoscode: '00002', email: 'admin@example.test' };
const superAdministrator = { valid: true, userId: 's1', role: 'superadmin', hoscode: '00002', email: 'sa@example.test' };
const districtUser = { valid: true, userId: 'd1', role: 'user', hoscode: '00588', email: 'district@example.test' };
const anonymous = { valid: false, error: 'No session' };
const noAccess = { valid: true, userId: 'u2', role: 'user', hoscode: '99999', email: 'other@example.test' };

test('OpenData admin actions are closed to the public and gated by role', () => {
  let syncs = 0, triggers = 0;
  const { c, call, setAuth } = routerContext(anonymous, { syncOpenData: () => { syncs++; return { synced: true }; }, setupOpenDataTrigger: () => { triggers++; return { installed: true }; }, getVaccineRules: () => [] });
  for (const action of ['forceSyncOpenData', 'setupOpenDataTrigger']) {
    setAuth(anonymous); assert.equal(call(action).status, 401);
    setAuth(ordinary); assert.equal(call(action).status, 403);
    setAuth(administrator); assert.equal(call(action).status, 200);
    setAuth(superAdministrator); assert.equal(call(action).status, 200);
  }
  assert.equal(syncs, 2); assert.equal(triggers, 2); // only the two district roles reach the actions
  // Unrelated public read posture is unchanged (observation-only per Issue #3).
  setAuth(anonymous); assert.equal(call('getVaccineRules', { fiscalYear: 2569 }).status, 200);
});

test('standalone updateLastLogin is closed while loginWithGoogle still updates last_login', () => {
  const { context: c, createSheet } = setup();
  const users = createSheet('Users', [['id', 'google_id', 'email', 'hoscode', 'role', 'status', 'last_login'],
    ['u1', 'g-1', 'user@example.test', '00002', 'user', 'approved', '']]);
  createSheet('sessions', [['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at']]);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), c);
  c.responseJson = (data, status = 200) => ({ data, status });
  c.validateTokenAndGetRole = () => ({ valid: false, error: 'No session' });
  c.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: 'g-1' }) }) };
  assert.equal(c.handleRequest('POST', { parameter: { action: 'updateLastLogin' }, postData: { contents: JSON.stringify({ action: 'updateLastLogin', googleId: 'g-1' }) } }).status, 401);
  assert.equal(users.cells[1][6], '');
  assert.equal(c.loginWithGoogle('access-token', '127.0.0.1', 'agent').success, true);
  assert.notEqual(users.cells[1][6], '');
});

test('AI analysis is facility-scoped with server-derived audit identity and rejects before Gemini', () => {
  const { c, call, read } = routerContext(ordinary);
  const audit = [];
  c.logAction = (userId, email, action, details) => audit.push({ userId, email, action, details });
  let geminiCalls = 0;
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'test-key' }) };
  c.UrlFetchApp = { fetch: () => { geminiCalls++; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'synthetic analysis' }] } }] }) }; } };
  const own = person({ hoscode: '00002', cid: '0000000000002', sex: '1', check_vhid: '00123456' });
  const foreign = person({ sex: '1', check_vhid: '00123456' });
  upload(c, [own, foreign], 'ai');
  const keyOf = row => ({ hoscode: row.hoscode, pid: row.pid, cid: row.cid, sex: row.sex, birth: row.birth, check_vhid: row.check_vhid });
  const rows = read();
  const ownIndex = rows.findIndex(row => row.hoscode === '00002'), foreignIndex = rows.findIndex(row => row.hoscode === '00588');

  // saveAiAnalysis: own facility allowed with server-derived audit actor (caller adminEmail/userId ignored).
  assert.equal(call('saveAiAnalysis', { recordKey: keyOf(own), targetTable: 'Epi_1_Year', aiAnalysis: 'ok', adminEmail: 'spoof@example.test', userId: 'spoofed-id' }).data.success, true);
  assert.equal(read()[ownIndex].ai_analysis, 'ok');
  assert.equal(audit.at(-1).userId, 'u1');
  assert.notEqual(audit.at(-1).userId, 'SYSTEM');
  assert.notEqual(audit.at(-1).userId, 'spoofed-id');
  assert.equal(audit.at(-1).email, 'user@example.test');
  assert.notEqual(audit.at(-1).email, 'spoof@example.test');

  // saveAiAnalysis: foreign facility refused with no write and no audit entry.
  assert.equal(call('saveAiAnalysis', { recordKey: keyOf(foreign), targetTable: 'Epi_1_Year', aiAnalysis: 'nope' }).data.success, false);
  assert.equal(read()[foreignIndex].ai_analysis, '');
  assert.equal(audit.length, 1);

  // saveAiAnalysis: district scope allowed on any facility.
  c.setAuth(administrator);
  assert.equal(call('saveAiAnalysis', { recordKey: keyOf(foreign), targetTable: 'Epi_1_Year', aiAnalysis: 'district' }).data.success, true);
  assert.equal(read()[foreignIndex].ai_analysis, 'district');

  // analyzeVaccineData: unauthorized target fails closed before any Gemini call or write.
  c.setAuth(noAccess);
  assert.equal(call('analyzeVaccineData', { prompt: 'p', recordKey: keyOf(own), targetTable: 'Epi_1_Year', adminEmail: 'spoof@example.test', userId: 'spoofed-id' }).data.success, false);
  assert.equal(geminiCalls, 0);
  assert.equal(read()[ownIndex].ai_analysis, 'ok'); // unchanged by the rejected request

  // analyzeVaccineData: nonexistent own-facility composite key fails closed before Gemini — recordKey.hoscode alone proves nothing.
  const auditBeforeGhost = audit.length;
  const ghost = { hoscode: '00002', pid: '9999', cid: '0000000000999', sex: '1', birth: '2025-01-01', check_vhid: '00123456' };
  c.setAuth(ordinary);
  assert.equal(call('analyzeVaccineData', { prompt: 'p', recordKey: ghost, targetTable: 'Epi_1_Year' }).data.success, false);
  assert.equal(geminiCalls, 0);
  assert.equal(audit.length, auditBeforeGhost);

  // analyzeVaccineData: authorized caller invokes Gemini once and persists with server-derived actor.
  c.setAuth(ordinary);
  assert.equal(call('analyzeVaccineData', { prompt: 'p', recordKey: keyOf(own), targetTable: 'Epi_1_Year', adminEmail: 'spoof@example.test', userId: 'spoofed-id' }).data.success, true);
  assert.equal(geminiCalls, 1);
  assert.equal(read()[ownIndex].ai_analysis, 'synthetic analysis');
  assert.equal(audit.at(-1).userId, 'u1');
  assert.notEqual(audit.at(-1).userId, 'SYSTEM');
  assert.equal(audit.at(-1).email, 'user@example.test');
  assert.notEqual(audit.at(-1).email, 'spoof@example.test');

  // 00588 ordinary-role account: district scope by facility code alone, with its own audit identity.
  c.setAuth(districtUser);
  assert.equal(call('saveAiAnalysis', { recordKey: keyOf(own), targetTable: 'Epi_1_Year', aiAnalysis: 'district-user' }).data.success, true);
  assert.equal(read()[ownIndex].ai_analysis, 'district-user');
  assert.equal(audit.at(-1).userId, 'd1');
  assert.equal(audit.at(-1).email, 'district@example.test');
  const geminiBeforeDistrict = geminiCalls;
  assert.equal(call('analyzeVaccineData', { prompt: 'p', recordKey: keyOf(foreign), targetTable: 'Epi_1_Year' }).data.success, true);
  assert.equal(geminiCalls, geminiBeforeDistrict + 1);
  assert.equal(read()[foreignIndex].ai_analysis, 'synthetic analysis');
  assert.equal(audit.at(-1).userId, 'd1');
  assert.equal(audit.at(-1).email, 'district@example.test');
});

test('logout deletes only the authenticated session, never a caller-supplied foreign token', () => {
  const { sheets, createSheet, call } = routerContext(ordinary);
  createSheet('sessions', [['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at'],
    ['sess-A', 'u1', '', '', '', '2099-01-01', ''], ['sess-B', 'u2', '', '', '', '2099-01-01', '']]);
  const response = call('deleteSession', { token: 'sess-B', auth_token: 'sess-A' });
  assert.equal(response.status, 200);
  assert.deepEqual(sheets.get('sessions').cells.slice(1).map(row => row[0]), ['sess-B']);
});

function auditSheet(createSheet) {
  return createSheet('audit_logs', [['log_id', 'user_id', 'email', 'action', 'details', 'timestamp']]);
}
const importer = { userId: 'u1', email: 'importer@example.test' };

test('accepted chunks audit one logical upload_excel event with server-derived identity and durable repair metadata', () => {
  const { context: c, createSheet, sheets, read } = setup();
  const auditLogs = auditSheet(createSheet);
  const audit = [];
  c.logAction = (userId, email, action, details) => {
    audit.push({ userId, email, action, details });
    auditLogs.appendRow(['uuid', userId, email, action, details, new Date().toISOString()]);
  };
  assert.equal(c.upsertEpiData([person()], 'audit-1', importer, 2569).success, true);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'upload_excel');
  assert.equal(audit[0].userId, 'u1');
  assert.equal(audit[0].email, 'importer@example.test');
  const details = audit[0].details;
  assert.ok(details.includes('audit-1') && details.includes('chunk 1/1') && details.includes('inserted 1') && details.includes('updated 0'), details);
  // Privacy: operational metadata only.
  assert.equal(/\d{13}/.test(details), false);
  assert.equal(details.includes('ข้อมูล') || details.includes('จำลอง'), false);
  // Receipt carries the durable repair metadata of the original import.
  const receipt = JSON.parse(sheets.get('epi_import_batches').cells[1][5]);
  assert.equal(receipt[0].audit.userId, 'u1');
  assert.equal(receipt[0].audit.email, 'importer@example.test');
  assert.equal(receipt[0].audit.inserted, 1);
  assert.equal(receipt[0].audit.updated, 0);
  // Normal replay after successful audit: no duplicate logical event.
  const replay = c.upsertEpiData([person()], 'audit-1', importer, 2569);
  assert.deepEqual([replay.inserted, replay.updated, replay.replayed], [0, 0, true]);
  assert.equal(audit.length, 1);
  assert.equal(read().length, 1);
});

test('audit append failure after durable receipt is repaired on exact retry with the ORIGINAL actor', () => {
  const { context: c, createSheet, sheets, read } = setup();
  auditSheet(createSheet);
  const audit = [];
  c.logAction = () => { throw new Error('audit append failed'); };
  assert.throws(() => c.upsertEpiData([person()], 'repair-1', importer, 2569), /audit append failed/);
  // Data and receipt are durable despite the audit failure; the request did not report an audited success.
  assert.equal(read().length, 1);
  const receipt = JSON.parse(sheets.get('epi_import_batches').cells[1][5]);
  assert.equal(receipt[0].audit.email, 'importer@example.test');
  assert.equal(receipt[0].audit.inserted, 1);
  // A DIFFERENT authenticated user retries the exact chunk: no re-mutation, original actor and counts restored.
  c.logAction = (userId, email, action, details) => audit.push({ userId, email, action, details });
  const retry = c.upsertEpiData([person()], 'repair-1', { userId: 'u2', email: 'retry@example.test' }, 2569);
  assert.deepEqual([retry.inserted, retry.updated, retry.replayed], [0, 0, true]);
  assert.equal(read().length, 1);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].userId, 'u1');
  assert.equal(audit[0].email, 'importer@example.test');
  assert.ok(audit[0].details.includes('inserted 1'));
});

test('an audit append that physically succeeded but threw is deduplicated on retry', () => {
  const { context: c, createSheet } = setup();
  const auditLogs = auditSheet(createSheet);
  // The append physically happens, then the caller observes an error.
  c.logAction = (userId, email, action, details) => {
    auditLogs.appendRow(['uuid', userId, email, action, details, new Date().toISOString()]);
    throw new Error('ambiguous append failure');
  };
  assert.throws(() => c.upsertEpiData([person()], 'ambig-1', importer, 2569), /ambiguous append failure/);
  assert.equal(auditLogs.cells.length, 2);
  c.logAction = () => { throw new Error('must not append again'); };
  const retry = c.upsertEpiData([person()], 'ambig-1', importer, 2569);
  assert.deepEqual([retry.inserted, retry.updated, retry.replayed], [0, 0, true]);
  assert.equal(auditLogs.cells.length, 2); // exactly one logical upload_excel event remains
});

test('legacy index+fingerprint receipts replay without fabricating audit history', () => {
  const { context: c, createSheet, sheets } = setup();
  auditSheet(createSheet);
  const audit = [];
  c.logAction = (...entry) => audit.push(entry);
  assert.equal(c.upsertEpiData([person()], 'legacy-1', importer, 2569).success, true);
  const batchSheet = sheets.get('epi_import_batches');
  const completed = JSON.parse(batchSheet.cells[1][5]);
  batchSheet.cells[1][5] = JSON.stringify([{ index: completed[0].index, fingerprint: completed[0].fingerprint }]); // legacy shape
  audit.length = 0;
  const replay = c.upsertEpiData([person()], 'legacy-1', { userId: 'u2', email: 'other@example.test' }, 2569);
  assert.deepEqual([replay.inserted, replay.updated, replay.replayed], [0, 0, true]);
  assert.equal(audit.length, 0); // nothing fabricated for legacy receipts
});

test('rejections never audit; sync finalize stays a separate cleanup_epi_data event', () => {
  const { context: c, createSheet } = setup();
  auditSheet(createSheet);
  const audit = [];
  c.logAction = (...entry) => audit.push(entry);
  assert.equal(c.upsertEpiData([person({ birth: '2025-02-30' })], 'bad', importer, 2569).success, false);        // invalid record
  assert.equal(c.upsertEpiData([person()], 'bad2', importer, '20X9').success, false);                            // invalid scope
  assert.equal(audit.length, 0);
  assert.equal(c.upsertEpiData([person()], 'mm', importer, 2569).success, true);                                 // merge import (no finalize)
  assert.equal(c.upsertEpiData([person({ addr: 'changed' })], 'mm', importer, 2569).success, false);             // fingerprint mismatch
  assert.equal(c.upsertEpiData([person()], 'mm', importer, 2569, 'Epi_1_Year', { mode: 'sync' }).success, false); // batch scope mismatch
  assert.equal(c.upsertEpiData([person()], 'sync-1', importer, 2569, 'Epi_1_Year', { mode: 'sync' }).success, true);
  c.cleanupEpiData('sync-1', [], 'admin', 2569);
  assert.equal(audit.filter(entry => entry[2] === 'upload_excel').length, 2);   // only the two accepted chunks
  assert.equal(audit.filter(entry => entry[2] === 'cleanup_epi_data').length, 1); // finalization remains separate
});

test('a finalized batch rejects unseen chunks at the finalized guard without auditing', () => {
  const { context: c, createSheet, sheets } = setup();
  auditSheet(createSheet);
  const audit = [];
  c.logAction = (...entry) => audit.push(entry);
  // Finalized two-chunk batch with only chunk 0 recorded: chunk 1 misses the replay lookup
  // and must be refused by the finalized guard (normal finalize requires completeness,
  // so the guard is exercised through this smallest coherent fixture).
  createSheet('epi_import_batches', [
    ['batch_id', 'target_table', 'fiscal_year', 'mode', 'total_chunks', 'completed_chunks', 'hoscodes', 'status', 'updated_at'],
    ['done-1', 'Epi_1_Year', '2569', 'merge', 2, JSON.stringify([{ index: 0, fingerprint: 'AAAA' }]), '["00002"]', 'complete', '2026-01-01T00:00:00Z'],
  ]);
  const result = c.upsertEpiData([person()], 'done-1', importer, 2569, 'Epi_1_Year', { chunkIndex: 1, totalChunks: 2 });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Batch is already finalized.');
  assert.equal(sheets.has('Epi_1_Year'), false); // no data sheet write happened
  assert.equal(audit.length, 0);                 // no upload_excel audit entry
});

test('an overlap-refused chunk creates no upload_excel audit event', () => {
  const { context: c, createSheet } = setup();
  auditSheet(createSheet);
  const audit = [];
  c.logAction = (...entry) => audit.push(entry);
  assert.equal(c.upsertEpiData([person()], 'older', importer, 2569, 'Epi_1_Year', { mode: 'sync', totalChunks: 2 }).success, true); // incomplete accepted chunk
  assert.equal(c.upsertEpiData([person()], 'newer', importer, 2569).success, true);                                                 // overlapping newer import
  const uploads = () => audit.filter(entry => entry[2] === 'upload_excel').length;
  assert.equal(uploads(), 2); // only the two accepted chunks audited so far
  const refused = c.upsertEpiData([person()], 'older', importer, 2569, 'Epi_1_Year', { mode: 'sync', totalChunks: 2, chunkIndex: 1 });
  assert.equal(refused.success, false);
  assert.equal(refused.error, 'A newer import overlaps this batch. Start a new import.');
  assert.equal(uploads(), 2); // the rejected request audits nothing
});

test('import writes apply plain-text formatting to every canonical identifier column for all EPI schemas', () => {
  // Canonical contract (schema.md header note + identifier rules), stated independently of the write-path predicate:
  // the responsible facility code, every per-dose facility/recording-unit code, the person identifiers,
  // and the text classification columns must be stored as text. PID is a digit string of no fixed length —
  // formatting only, never padding.
  const isIdentifierColumn = field => field === 'hoscode' || field === 'cid' || field === 'pid'
    || ['addr', 'check_vhid', 'check_typearea', 'nation', 'discharge'].includes(field)
    || field.endsWith('_hospcode') || field.endsWith('_input_hosp');
  const tables = Object.keys(setup().context.getEpiSchemas());
  assert.deepEqual(tables.sort(), ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year']);
  for (const table of tables) {
    const { context: c, sheets, numberFormats } = setup();
    assert.equal(upload(c, [person({ addr: '001/2', check_typearea: '1', bcg_hospcode: '00001', bcg_input_hosp: '00002' })], `fmt-${table}`, 2569, table).success, true);
    const headers = sheets.get(table).cells[0];
    const written = sheets.get(table).cells.length;
    for (const [index, field] of headers.entries()) {
      if (!isIdentifierColumn(field)) continue;
      const column = index + 1;
      // Creation-time hardening may add its own '@' call; the contract to prove is that the
      // import write itself formats the identifier column across the entire written range.
      const covering = numberFormats.some(call => call.sheet === table && call.column === column
        && call.format === '@' && call.row === 1 && call.height === written);
      assert.ok(covering, `${table}: identifier column '${field}' lacks '@' formatting covering the full written range`);
    }
  }
});
