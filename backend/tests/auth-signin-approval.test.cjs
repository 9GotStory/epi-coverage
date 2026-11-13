/**
 * Issue #158 / #163 contracts — sign-in and request validation agree on who has access.
 *
 * Before this fix `loginWithGoogle` created a Session for any `admin`/`superadmin`
 * whatever their Approval Status, while `validateTokenAndGetRole` refused every
 * request unless the Approval Status was `approved` (or the legacy value `admin`).
 * A rejected admin therefore signed in, hit a Session End on the first request,
 * signed in again, and so on forever.
 *
 * Contract under test, through the real `loginWithGoogle` and
 * `validateTokenAndGetRole` on synthetic `Users` and `sessions` sheets:
 *   - Only Approval Status exactly `approved` grants access; Role never stands in
 *     for it (CONTEXT.md §34).
 *   - Sign-in creates a Session exactly when request validation would accept one.
 *   - Unknown accounts still register; `pending` still gets the pending response.
 *   - A refused sign-in names `rejected` ("ระงับสิทธิ์") only for `rejected`; a stored
 *     value outside the Approval Statuses gets a refusal that names no status
 *     (Issue #175, docs/features.md §1).
 *
 * All fixtures are synthetic; no real accounts, tokens, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Issue #171 / #175: the sign-in refusal names `rejected` ("ระงับสิทธิ์") and nothing else (docs/features.md §1)
const REJECTED_REFUSAL = 'บัญชีนี้ถูกระงับสิทธิ์การเข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
const INVALID_STATUS_REFUSAL = 'ไม่สามารถเข้าสู่ระบบได้ เนื่องจากสถานะบัญชีไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USERS_HEADER = ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'];
const SESSIONS_HEADER = ['session_id', 'user_id', 'token_digest', 'ip_address', 'user_agent', 'expires_at', 'created_at'];

function setup(users) {
  const sheets = new Map();
  function createSheet(name, initial) {
    const cells = initial.map(row => [...row]);
    sheets.set(name, {
      cells,
      getDataRange: () => ({ getValues: () => cells.map(row => [...row]) }),
      getRange: (row, column) => ({ setValue(value) { cells[row - 1][column - 1] = value; return this; } }),
      appendRow(row) { cells.push([...row]); return this; },
    });
  }
  createSheet('Users', [USERS_HEADER, ...users.map(u => USERS_HEADER.map(field => u[field] ?? ''))]);
  createSheet('sessions', [SESSIONS_HEADER]);

  let googleSub = null;
  let uuid = 0;
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: name => sheets.get(name) }),
    console: { error() {}, log() {} },
    logAction() {},
    UrlFetchApp: {
      fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: googleSub }) }),
    },
    Utilities: {
      getUuid: () => `session-${++uuid}`,
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: () => [1, 2, 3],
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Auth.js'), 'utf8'), context);

  return {
    signIn(sub) { googleSub = sub; return context.loginWithGoogle('synthetic-access-token', '127.0.0.1', 'test-agent'); },
    validate: token => context.validateTokenAndGetRole(token),
    // A Session that exists however it was created, so validation can be asked about any User.
    seedSession(userId) {
      const token = `seeded-${userId}`;
      sheets.get('sessions').cells.push([token, userId, 'digest', '', '', new Date(Date.now() + 3600000).toISOString(), new Date().toISOString()]);
      return token;
    },
    sessionRows: () => sheets.get('sessions').cells.slice(1),
  };
}

function user(role, status) {
  return { id: `id-${role}`, google_id: `sub-${role}`, email: `${role}@example.test`, name: 'ข้อมูลจำลอง', hoscode: '00588', role, status };
}

test('a rejected admin is refused at sign-in and gets no Session (Issue #158)', () => {
  const h = setup([user('admin', 'rejected')]);

  const result = h.signIn('sub-admin');

  assert.equal(result.success, false);
  assert.equal(result.error, REJECTED_REFUSAL);
  assert.equal(result.session_id, undefined);
  assert.equal(h.sessionRows().length, 0);
});

test('request validation refuses the legacy Approval Status admin (Issue #158)', () => {
  const h = setup([user('admin', 'admin')]);

  const result = h.validate(h.seedSession('id-admin'));

  assert.deepEqual({ ...result }, { valid: false, error: 'Account is not approved' });
});

test('sign-in creates a Session exactly when request validation accepts that User — no Session End loop (Issue #158)', () => {
  for (const role of ['user', 'admin', 'superadmin']) {
    for (const status of ['approved', 'rejected', '', 'admin', 'Approved', 'pending']) {
      const h = setup([user(role, status)]);
      const label = `role=${role} status=${JSON.stringify(status)}`;

      const signIn = h.signIn(`sub-${role}`);
      const validation = h.validate(h.seedSession(`id-${role}`));

      assert.equal(Boolean(signIn.session_id), validation.valid, label);
      assert.equal(validation.valid, status === 'approved', label);
      if (signIn.session_id) assert.equal(h.validate(signIn.session_id).valid, true, label);
    }
  }
});

test('an approved admin or superadmin still signs in and keeps their Role on requests (Issue #158)', () => {
  for (const role of ['admin', 'superadmin']) {
    const h = setup([user(role, 'approved')]);

    const result = h.signIn(`sub-${role}`);

    assert.equal(result.success, true, role);
    assert.equal(result.status, 'approved', role);
    assert.equal(h.sessionRows().length, 1, role);
    const validation = h.validate(result.session_id);
    assert.equal(validation.valid, true, role);
    assert.equal(validation.role, role);
    assert.equal(validation.hoscode, '00588');
  }
});

test('a rejected User of every Role is refused with the ระงับสิทธิ์ message and no Session (Issue #158, #175)', () => {
  for (const role of ['user', 'admin', 'superadmin']) {
    const h = setup([user(role, 'rejected')]);

    const result = h.signIn(`sub-${role}`);

    assert.deepEqual({ ...result }, { success: false, error: REJECTED_REFUSAL }, role);
    assert.equal(h.sessionRows().length, 0, role);
  }
});

test('a stored status outside the Approval Statuses is refused with a message that names no status, and no Session (Issue #175)', () => {
  for (const role of ['user', 'admin', 'superadmin']) {
    for (const status of ['', 'admin', 'Approved', 'suspended']) {
      const h = setup([user(role, status)]);
      const label = `role=${role} status=${JSON.stringify(status)}`;

      const result = h.signIn(`sub-${role}`);

      assert.deepEqual({ ...result }, { success: false, error: INVALID_STATUS_REFUSAL }, label);
      assert.equal(h.sessionRows().length, 0, label);
    }
  }
});

test('a pending User or admin still gets the pending response without a Session (Issue #158)', () => {
  for (const role of ['user', 'admin']) {
    const h = setup([user(role, 'pending')]);

    const result = h.signIn(`sub-${role}`);

    assert.equal(result.success, true, role);
    assert.equal(result.status, 'pending', role);
    assert.equal(result.session_id, undefined, role);
    assert.equal(h.sessionRows().length, 0, role);
  }
});

test('an unknown Google account still gets the registration path (Issue #158)', () => {
  const h = setup([user('admin', 'approved')]);

  const result = h.signIn('sub-unknown');

  assert.equal(result.success, true);
  assert.equal(result.isNewUser, true);
  assert.equal(h.sessionRows().length, 0);
});
