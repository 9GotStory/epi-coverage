/**
 * Issue #72 RED contracts — public self-registration can never mint privilege.
 *
 * `createUser` is a PUBLIC, unauthenticated Router action (backend/src/Router.js).
 * Before this fix it mapped client-supplied `userData` verbatim across every
 * `Users` sheet column, so `POST createUser {role:'superadmin', status:'approved'}`
 * followed by a legitimate Google login yielded a full-privilege session.
 *
 * Contract under test, through the real `createUser` on a synthetic Users sheet:
 *   - `role` and `status` are SERVER-decided: every registration enters as
 *     `role='user'`, `status='pending'`, no matter what the client sends.
 *   - Legitimate registration data (google_id/email/name/hoscode) still maps
 *     through, and the leading-zero hoscode text protection is unchanged.
 *
 * All fixtures are synthetic; no real accounts, tokens, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USERS_HEADER = ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'];

function setup() {
  const sheets = new Map();
  const numberFormats = [];
  const audit = [];
  function createSheet(name, initial = []) {
    const cells = initial.map(row => [...row]);
    let maxRows = Math.max(2, cells.length), maxColumns = 10;
    const sheet = {
      cells, getName: () => name, getLastRow: () => cells.length,
      getLastColumn: () => Math.max(0, ...cells.map(row => row.length)),
      getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
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
        };
      },
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
    getSpreadsheet: () => ss,
    console: { error() {}, log() {} },
    logAction: (userId, email, action, details) => audit.push({ userId, email, action, details }),
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
    Utilities: { getUuid: () => 'uuid' },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), context);
  createSheet('Users', [USERS_HEADER]);
  const readUsers = () => {
    const rows = sheets.get('Users').cells.slice(1);
    return rows.map(row => Object.fromEntries(USERS_HEADER.map((field, i) => [field, row[i] ?? ''])));
  };
  return { context, audit, readUsers, numberFormats };
}

test('createUser ignores client-supplied role/status — registration always enters as a pending user (Issue #72)', () => {
  const h = setup();
  // Hostile shape: exactly the payload an attacker posts to mint superadmin.
  const result = h.context.createUser({
    id: 'attacker-id', google_id: 'attacker-sub', email: 'attacker@example.test', name: 'ข้อมูลจำลอง',
    hoscode: '00588', role: 'superadmin', status: 'approved', created_at: '2026-10-30T00:00:00Z', last_login: '',
  });
  assert.equal(result.success, true, 'registration itself still succeeds');
  const stored = h.readUsers()[0];
  assert.ok(stored, 'exactly one user row written');
  assert.equal(stored.role, 'user', 'client-supplied role is discarded — always user');
  assert.equal(stored.status, 'pending', 'client-supplied status is discarded — always pending');
  assert.notEqual(stored.role, 'superadmin');
  assert.notEqual(stored.status, 'approved');
});

test('createUser keeps legitimate registration data and hoscode text protection (Issue #72)', () => {
  const h = setup();
  // The exact payload shape FirstTimeSetup sends — must keep working unchanged.
  const result = h.context.createUser({
    id: 'new-id', google_id: 'new-sub', email: 'nurse@example.test', name: 'ข้อมูลจำลอง',
    hoscode: '06422', role: 'user', status: 'pending', created_at: '2026-10-30T00:00:00Z', last_login: '',
  });
  assert.equal(result.success, true, 'legitimate registration succeeds');
  const stored = h.readUsers()[0];
  assert.equal(stored.google_id, 'new-sub', 'registration identity maps through');
  assert.equal(stored.email, 'nurse@example.test', 'email maps through');
  assert.equal(stored.role, 'user', 'role stays user');
  assert.equal(stored.status, 'pending', 'status stays pending');
  assert.ok(String(stored.hoscode).startsWith("'"), 'leading-zero hoscode keeps its text-forcing apostrophe');
  assert.ok(h.numberFormats.some(f => f.sheet === 'Users' && f.format === '@'),
    'the written row is still text-formatted');
  assert.ok(h.audit.some(a => a.action === 'create_user'), 'create_user audit still emitted');
});
