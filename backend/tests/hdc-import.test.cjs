const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function setup() {
  const sheets = new Map();
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
          setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
        };
      },
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
    Utilities: { formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value), DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, data) => crypto.createHash('sha256').update(data).digest(), base64Encode: data => Buffer.from(data).toString('base64') },
  });
  for (const file of ['Setup.js', 'Upload.js', 'Data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  context.logAction = () => {};
  const read = (table = 'Epi_1_Year') => {
    const values = sheets.get(table).getDataRange().getValues();
    return values.slice(1).map(row => Object.fromEntries(values[0].map((field, index) => [field, row[index]])));
  };
  return { context, sheets, createSheet, read, isLocked: () => locked };
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
