/**
 * Issue #162 / #167 contracts — an admin user update stores only an Approval Status
 * or Role that exists. Issue #166 / #169 — and only who may change which row.
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
 *   - Issue #166 (ADR-0013), also through `updateUserFacility`: only a superadmin
 *     changes a Role; an admin changes only rows whose Role is exactly `user`; no
 *     one changes their own row. A refusal writes nothing and audits nothing.
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
const SUPERADMIN = { userId: 'superadmin-1', role: 'superadmin', hoscode: '00588', email: 'superadmin@example.test' };

// Row 2 is the target ('sub-1'); the caller's own row follows ('sub-self'), so own-row requests can be made.
function setup({ role = 'user', status = 'pending', caller = ADMIN } = {}) {
  const cells = [
    USERS_HEADER,
    ['id-1', 'sub-1', 'target@example.test', 'ข้อมูลจำลอง', '06422', role, status, '', ''],
    [caller.userId, 'sub-self', caller.email, 'ผู้ดูแลจำลอง', caller.hoscode, caller.role, 'approved', '', ''],
  ];
  const audit = [];
  const users = {
    getDataRange: () => ({ getValues: () => cells.map(row => [...row]) }),
    getRange: (row, column) => ({
      setValue(value) { cells[row - 1][column - 1] = value; return this; },
      setNumberFormat() { return this; },
    }),
  };
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: name => (name === 'Users' ? users : undefined) }),
    console: { error() {}, log() {} },
    logAction: (userId, email, action, details) => audit.push({ userId, email, action, details }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), context);

  return {
    update: (googleId, newStatus, newRole) => ({ ...context.updateUserStatus(googleId, newStatus, newRole, caller) }),
    updateFacility: (googleId, hoscode) => ({ ...context.updateUserFacility(googleId, hoscode, caller) }),
    row: () => Object.fromEntries(USERS_HEADER.map((field, i) => [field, cells[1][i]])),
    ownRow: () => Object.fromEntries(USERS_HEADER.map((field, i) => [field, cells[2][i]])),
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
      const h = setup({ role: 'user', status: 'pending', caller: SUPERADMIN });
      const label = `status=${status} role=${role}`;

      const result = h.update('sub-1', status, role);

      assert.equal(result.success, true, label);
      assert.equal(h.row().status, status, label);
      assert.equal(h.row().role, role, label);
      assert.equal(h.audit.length, 1, label);
      assert.equal(h.audit[0].action, 'update_user_status', label);
      assert.equal(h.audit[0].email, SUPERADMIN.email, label);
    }
  }
});

test('an absent, null or empty field leaves that column unchanged (Issue #162)', () => {
  for (const absent of [undefined, null, '']) {
    const promote = setup({ role: 'user', status: 'approved', caller: SUPERADMIN });
    assert.equal(promote.update('sub-1', absent, 'admin').success, true);
    assert.deepEqual([promote.row().status, promote.row().role], ['approved', 'admin']);

    const reject = setup({ role: 'admin', status: 'approved', caller: SUPERADMIN });
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

test('the admin UI promote resends the stored Approval Status: it works for every Approval Status, and a stored out-of-set value is refused unchanged (Issue #162)', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    const h = setup({ role: 'user', status, caller: SUPERADMIN });

    assert.equal(h.update('sub-1', status, 'admin').success, true, status);
    assert.deepEqual([h.row().status, h.row().role], [status, 'admin'], status);
  }

  // No migration (#162): a row already holding a non-Approval-Status value is not promoted
  // until an admin sets a real Approval Status first.
  const legacy = setup({ role: 'user', status: 'Approved', caller: SUPERADMIN });
  assert.match(legacy.update('sub-1', 'Approved', 'admin').error, /status/);
  assert.deepEqual([legacy.row().status, legacy.row().role], ['Approved', 'user']);
  assert.deepEqual(legacy.audit, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #166 / #169 (ADR-0013): only a superadmin changes a Role; an admin changes
// only rows whose Role is `user`; no one changes their own row.
// ─────────────────────────────────────────────────────────────────────────────

test('an admin that supplies a Role is refused whole, even when it equals the current Role (Issue #166)', () => {
  for (const [newStatus, newRole] of [[null, 'admin'], ['approved', 'admin'], [null, 'superadmin'], ['approved', 'user']]) {
    const h = setup({ role: 'user', status: 'pending' });
    const label = `status=${newStatus} role=${newRole}`;

    const result = h.update('sub-1', newStatus, newRole);

    assert.equal(result.success, undefined, label);
    assert.match(String(result.error), /superadmin/, label);
    assert.deepEqual(h.row(), setup().row(), label);
    assert.deepEqual(h.audit, [], label);
  }
});

test('no one changes their own row: Approval Status, Role or facility, admin and superadmin alike (Issue #166)', () => {
  const requests = [
    ['status', h => h.update('sub-self', 'rejected', null)],
    ['facility', h => h.updateFacility('sub-self', '06499')],
  ];
  for (const caller of [ADMIN, SUPERADMIN]) {
    for (const [what, request] of [...requests, ...(caller === SUPERADMIN ? [['role', h => h.update('sub-self', null, 'admin')]] : [])]) {
      const h = setup({ caller });
      const before = h.ownRow();
      const label = `${caller.role} ${what}`;

      const result = request(h);

      assert.equal(result.success, undefined, label);
      assert.match(String(result.error), /your own/, label);
      assert.deepEqual(h.ownRow(), before, label);
      assert.deepEqual(h.audit, [], label);
    }
  }
});

test('an admin changes Approval Status and facility only on rows whose Role is exactly user (Issue #166)', () => {
  const allowed = setup({ role: 'user', status: 'pending' });
  assert.equal(allowed.update('sub-1', 'approved', null).success, true);
  assert.equal(allowed.updateFacility('sub-1', '06499').success, true);
  assert.deepEqual([allowed.row().status, allowed.row().hoscode], ['approved', "'06499"]);
  assert.deepEqual(allowed.audit.map(entry => entry.action), ['update_user_status', 'update_user_facility']);

  for (const targetRole of ['admin', 'superadmin', 'Admin', '']) {
    for (const [what, request] of [['status', h => h.update('sub-1', 'rejected', null)], ['facility', h => h.updateFacility('sub-1', '06499')]]) {
      const h = setup({ role: targetRole, status: 'approved' });
      const before = h.row();
      const label = `target role=${JSON.stringify(targetRole)} ${what}`;

      const result = request(h);

      assert.equal(result.success, undefined, label);
      assert.match(String(result.error), /only be changed by a superadmin/, label);
      assert.deepEqual(h.row(), before, label);
      assert.deepEqual(h.audit, [], label);
    }
  }
});

test('a caller whose Role is neither admin nor superadmin gets admin rights only (fail closed, Issue #166)', () => {
  const caller = { userId: 'odd-1', role: 'Superadmin', hoscode: '00588', email: 'odd@example.test' };

  const role = setup({ role: 'user', caller });
  assert.match(String(role.update('sub-1', null, 'admin').error), /superadmin/);
  assert.equal(role.row().role, 'user');

  const adminRow = setup({ role: 'admin', status: 'approved', caller });
  assert.match(String(adminRow.update('sub-1', 'rejected', null).error), /only be changed by a superadmin/);
  assert.equal(adminRow.row().status, 'approved');
  assert.deepEqual([...role.audit, ...adminRow.audit], []);
});

test('a superadmin changes any other row: every Role move, another superadmin\'s Approval Status, an admin\'s facility (Issue #166)', () => {
  for (const [from, to] of [['user', 'admin'], ['admin', 'user'], ['user', 'superadmin'], ['superadmin', 'admin']]) {
    const h = setup({ role: from, status: 'approved', caller: SUPERADMIN });

    assert.equal(h.update('sub-1', null, to).success, true, `${from}→${to}`);
    assert.equal(h.row().role, to, `${from}→${to}`);
    assert.equal(h.audit.length, 1, `${from}→${to}`);
  }

  const peer = setup({ role: 'superadmin', status: 'approved', caller: SUPERADMIN });
  assert.equal(peer.update('sub-1', 'rejected', null).success, true);
  assert.equal(peer.row().status, 'rejected');

  const admin = setup({ role: 'admin', status: 'approved', caller: SUPERADMIN });
  assert.equal(admin.updateFacility('sub-1', '06499').success, true);
  assert.equal(admin.row().hoscode, "'06499");
  assert.equal(admin.audit[0].email, SUPERADMIN.email);
});
