/**
 * Issue #162 / #167 contracts — an admin user update stores only an Approval Status
 * or Role that exists.
 *
 * Before this fix `updateUserStatus` wrote whatever `status`/`role` text it received,
 * so `Approved` or `super-admin` reached the `Users` sheet and silently locked the
 * User out (#158) with nothing telling the admin why.
 *
 * Contract under test, through the real `updateUserStatus` on a synthetic `Users`
 * sheet and a recorded audit log:
 *   - An Approval Status is exactly one of pending/approved/rejected and a Role is
 *     exactly one of user/admin/superadmin (CONTEXT.md §34/§35). Anything else
 *     supplied refuses the whole request: no cell written, no audit entry.
 *   - An absent, null or '' field leaves that column unchanged.
 *
 * All fixtures are synthetic; no real accounts, tokens, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USERS_HEADER = ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'];
const ADMIN = { userId: 'admin-1', role: 'admin', hoscode: '00588', email: 'admin@example.test' };

function setup({ role = 'user', status = 'pending' } = {}) {
  const cells = [USERS_HEADER, ['id-1', 'sub-1', 'target@example.test', 'ข้อมูลจำลอง', '06422', role, status, '', '']];
  const audit = [];
  const users = {
    getDataRange: () => ({ getValues: () => cells.map(row => [...row]) }),
    getRange: (row, column) => ({ setValue(value) { cells[row - 1][column - 1] = value; return this; } }),
  };
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: name => (name === 'Users' ? users : undefined) }),
    console: { error() {}, log() {} },
    logAction: (userId, email, action, details) => audit.push({ userId, email, action, details }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), context);

  return {
    update: (googleId, newStatus, newRole) => ({ ...context.updateUserStatus(googleId, newStatus, newRole, ADMIN) }),
    row: () => Object.fromEntries(USERS_HEADER.map((field, i) => [field, cells[1][i]])),
    audit,
  };
}

test('an Approval Status outside pending/approved/rejected is refused and nothing is written (Issue #162)', () => {
  const h = setup();

  const result = h.update('sub-1', 'Approved', null);

  assert.equal(result.success, undefined);
  assert.match(result.error, /status/);
  assert.equal(h.row().status, 'pending');
  assert.deepEqual(h.audit, []);
});

test('a Role outside user/admin/superadmin is refused and nothing is written (Issue #162)', () => {
  const h = setup();

  const result = h.update('sub-1', null, 'super-admin');

  assert.equal(result.success, undefined);
  assert.match(result.error, /role/);
  assert.equal(h.row().role, 'user');
  assert.deepEqual(h.audit, []);
});

test('near-miss text and non-text values are not an Approval Status or Role — no normalization (Issue #162)', () => {
  const cases = [
    ['status', ' approved'], ['status', 'APPROVED'], ['status', 'approved '], ['status', true], ['status', 1], ['status', false], ['status', 0],
    ['role', 'Admin'], ['role', 'admin '], ['role', 'super admin'], ['role', true], ['role', 1], ['role', false], ['role', 0],
  ];
  for (const [field, value] of cases) {
    const h = setup();
    const label = `${field}=${JSON.stringify(value)}`;

    const result = field === 'status' ? h.update('sub-1', value, undefined) : h.update('sub-1', undefined, value);

    assert.match(String(result.error), new RegExp(field), label);
    assert.deepEqual(h.row(), setup().row(), label);
    assert.deepEqual(h.audit, [], label);
  }
});

test('one valid and one invalid field change nothing — no half-updated User row (Issue #162)', () => {
  for (const [newStatus, newRole] of [['approved', 'super-admin'], ['Approved', 'admin']]) {
    const h = setup();
    const label = `status=${newStatus} role=${newRole}`;

    const result = h.update('sub-1', newStatus, newRole);

    assert.ok(result.error, label);
    assert.deepEqual(h.row(), setup().row(), label);
    assert.deepEqual(h.audit, [], label);
  }
});

test('every Approval Status and Role is written and audited as before (Issue #162)', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    for (const role of ['user', 'admin', 'superadmin']) {
      const h = setup({ role: 'user', status: 'pending' });
      const label = `status=${status} role=${role}`;

      const result = h.update('sub-1', status, role);

      assert.equal(result.success, true, label);
      assert.equal(h.row().status, status, label);
      assert.equal(h.row().role, role, label);
      assert.equal(h.audit.length, 1, label);
      assert.equal(h.audit[0].action, 'update_user_status', label);
      assert.equal(h.audit[0].email, ADMIN.email, label);
    }
  }
});

test('an absent, null or empty field leaves that column unchanged — promote keeps the Approval Status (Issue #162)', () => {
  for (const absent of [undefined, null, '']) {
    const promote = setup({ role: 'user', status: 'approved' });
    assert.equal(promote.update('sub-1', absent, 'admin').success, true);
    assert.deepEqual([promote.row().status, promote.row().role], ['approved', 'admin']);

    const reject = setup({ role: 'admin', status: 'approved' });
    assert.equal(reject.update('sub-1', 'rejected', absent).success, true);
    assert.deepEqual([reject.row().status, reject.row().role], ['rejected', 'admin']);
  }
});

test('an unknown User: an invalid value is refused as invalid, valid values still get User not found (Issue #162)', () => {
  const h = setup();

  assert.match(h.update('sub-unknown', 'Approved', null).error, /status/);
  assert.deepEqual(h.update('sub-unknown', 'approved', null), { error: 'User not found.' });
  assert.deepEqual(h.row(), setup().row());
  assert.deepEqual(h.audit, []);
});
