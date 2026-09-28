/**
 * Issue #37 (Router seam RED) — server-derived manual invocation source.
 *
 * Contract: the authorized admin route `forceSyncOpenData` must call the sync
 * lifecycle as syncOpenData("manual") with the value derived SERVER-SIDE from
 * the entry path; any client-supplied `source` (body or query) must be ignored
 * and can never override "manual".
 *
 * Seam: the REAL backend router's doPost dispatch, loaded into a synthetic GAS
 * VM. Only boundary collaborators are stubbed: the token→role resolver returns
 * a synthetic authenticated admin (the router's real auth/admin gate code still
 * executes), `ContentService` is a minimal text-output mock, and `syncOpenData`
 * is a pure spy that records the arguments the router actually passes and
 * returns a harmless synthetic result. No retry, pacing, cache, lock, or audit
 * behavior is asserted here — that is the lifecycle harness's job (#37a–#37d).
 *
 * The trust boundary is proven by observing the actual call argument at the
 * public seam (router → syncOpenData(arg)), never by grepping source text or
 * asserting the absence of a body field. All fixtures are synthetic markers;
 * no real tokens, users, emails, health data, or production credentials.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SYNTHETIC_SYNC_RESULT = { success: true, status: 'success', marker: 'router-source-stub-37e' };
const SYNTHETIC_ADMIN_TOKEN = 'synthetic-admin-token-37e'; // fixture marker only — never a real credential

/** Load the real router with the minimal boundary stubs; `calls` records syncOpenData arguments. */
function createRouterHarness({ role = 'admin' } = {}) {
  const calls = [];
  const context = vm.createContext({
    console: { error() {}, log() {} },
    validateTokenAndGetRole: () => ({ valid: true, role }), // synthetic auth: real router gate logic still runs
    syncOpenData: (...args) => { calls.push(args); return SYNTHETIC_SYNC_RESULT; },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => ({ text, setMimeType(mimeType) { return { text, mimeType }; } }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8'), context);
  return { context, calls };
}

/** A POST event in the shape the deployed web app receives. */
const postEvent = body => ({
  parameter: { action: 'forceSyncOpenData', auth_token: SYNTHETIC_ADMIN_TOKEN },
  postData: { contents: JSON.stringify(body) },
});

const responseOf = output => JSON.parse(output.text); // through the existing responseJson wrapper

test('#37e Router forceSyncOpenData derives manual invocation source server-side and ignores client-supplied source', () => {
  // Case A — normal admin manual sync: no client source involved
  const a = createRouterHarness();
  const resA = responseOf(a.context.doPost(postEvent({ action: 'forceSyncOpenData' })));
  assert.equal(resA.status, 200, 'dispatch completes normally through the existing response wrapper');
  assert.equal(resA.data && resA.data.marker, 'router-source-stub-37e',
    'the synthetic sync result passes through responseJson unchanged');
  assert.equal(a.calls.length, 1, 'syncOpenData called exactly once');
  assert.equal(a.calls[0][0], 'manual',
    `authorized admin dispatch must call syncOpenData("manual") — expected first argument "manual", actual ${JSON.stringify(a.calls[0][0])}`);

  // Case B — crafted client claims source "trigger": must not be forwarded
  const b = createRouterHarness();
  responseOf(b.context.doPost(postEvent({ action: 'forceSyncOpenData', source: 'trigger' })));
  assert.equal(b.calls.length, 1, 'syncOpenData called exactly once');
  assert.equal(b.calls[0][0], 'manual', 'client value "trigger" must not override the server-derived source');
  assert.ok(!b.calls[0].includes('trigger'), 'the crafted "trigger" value must never reach the lifecycle call');

  // Case C — arbitrary client-controlled source string: must not be forwarded
  const c = createRouterHarness();
  responseOf(c.context.doPost(postEvent({ action: 'forceSyncOpenData', source: 'anything-client-controlled' })));
  assert.equal(c.calls.length, 1, 'syncOpenData called exactly once');
  assert.equal(c.calls[0][0], 'manual', 'an arbitrary client-supplied source must not be forwarded');
  assert.ok(!c.calls[0].includes('anything-client-controlled'), 'the arbitrary value must never reach the lifecycle call');

  // Authorization is respected by the real router gate: a non-admin never
  // reaches the dispatch branch at all (guards against weakening auth to test).
  const u = createRouterHarness({ role: 'user' });
  const resU = responseOf(u.context.doPost(postEvent({ action: 'forceSyncOpenData' })));
  assert.equal(resU.status, 403, 'non-admin requests are rejected by the router\'s real admin gate');
  assert.equal(u.calls.length, 0, 'syncOpenData must not be invoked for non-admin requests');
});
