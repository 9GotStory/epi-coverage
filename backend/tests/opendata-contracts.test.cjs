/**
 * Issue #14 (Ticket A) RED contracts — OpenData upstream/API contract hardening.
 *
 * Seams under test (agreed in the issue, not prescribed by these tests):
 *   1. `classifyOpenDataResponse(response)` — the smallest GAS-global helper the
 *      future implementation exposes for shared upstream response classification.
 *      Contract: returns { category, data?, diagnostic? } and never throws a raw
 *      SyntaxError for any upstream response. `category` is one of the six approved
 *      categories; `data` is the OpenData row array on success; `diagnostic`, when
 *      present, is bounded sanitized evidence (never a full raw body).
 *   2. The public `getOpenData` router action — observed through handleRequest with
 *      a counting UrlFetchApp stub, proving validation happens BEFORE any external
 *      MOPH access.
 *
 * All upstream material here is synthetic. No production URLs, tokens, Script
 * Properties, or health data appear in this file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const upstreamResponse = (code, body, headers = {}) => ({
  getResponseCode: () => code,
  getContentText: () => body,
  getHeaders: () => headers,
});

const SUCCESS_BODY = JSON.stringify({ statusCode: 200, data: [{ areacode: '540601', hospcode: '00001', bcg_01: '1' }] });

function createContext({ upstreamBody = SUCCESS_BODY, upstreamCode = 200 } = {}) {
  const sheets = new Map();
  const ss = {
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    insertSheet: name => { throw new Error('test harness: unexpected insertSheet'); },
  };
  const upstreamFetches = [];
  const cachePuts = [];
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    console, logAction() {},
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: (...args) => cachePuts.push(args) }) },
    Utilities: { getUuid: () => 'uuid', formatDate: value => value.toISOString() },
    UrlFetchApp: { fetch: (...args) => { upstreamFetches.push(args); return upstreamResponse(upstreamCode, upstreamBody); } },
  });
  for (const file of ['Data.js', 'OpenData.js', 'Router.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  context.responseJson = (data, status = 200) => ({ data, status });
  return { context, upstreamFetches, cachePuts, sheets };
}

// Router-level call helper: posts a public getOpenData request with the given payload.
const callGetOpenData = (c, payload) =>
  c.handleRequest('POST', { parameter: { action: 'getOpenData' }, postData: { contents: JSON.stringify({ action: 'getOpenData', payload }) } });

// --- Group A: shared upstream response classification (issue tests #1–#5) ---

test('#1 upstream classifier: 2xx valid OpenData contract JSON is success and preserves data', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  const result = c.classifyOpenDataResponse(upstreamResponse(200, SUCCESS_BODY, { 'Content-Type': 'application/json' }));
  assert.equal(result.category, 'success');
  // Realm-neutral content equality: the data array is created inside the VM context,
  // so host assert.deepEqual would reject on prototype identity, not content.
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), [{ areacode: '540601', hospcode: '00001', bcg_01: '1' }]);
});

test('#1 upstream classifier: valid zero-row data array is also success', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  const result = c.classifyOpenDataResponse(upstreamResponse(200, JSON.stringify({ statusCode: 200, data: [] })));
  assert.equal(result.category, 'success');
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), []); // realm-neutral: see #1 above
});

test('#2 upstream classifier: HTML body is non_json with bounded sanitized diagnostics, never a thrown SyntaxError', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  const html = '<!DOCTYPE html><html><body>Synthetic upstream maintenance page (synthetic test fixture only)</body></html>';
  let result;
  assert.doesNotThrow(() => { result = c.classifyOpenDataResponse(upstreamResponse(200, html, { 'Content-Type': 'text/html' })); },
    'a raw JSON.parse SyntaxError must not escape the classifier contract');
  assert.equal(result.category, 'non_json');
  const diagnostic = result.diagnostic || '';
  assert.ok(diagnostic.length <= 200, 'diagnostic must be bounded');
  assert.ok(!('rawBody' in result) && !('body' in result), 'no raw upstream body may be persisted on the result');
  assert.ok(!JSON.stringify(result).includes('Synthetic upstream maintenance page'), 'full HTML body must not be retained');
});

test('#3 upstream classifier: non-2xx is http_error with status retained as sanitized metadata, even when body parses', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  const result = c.classifyOpenDataResponse(upstreamResponse(503, JSON.stringify({ data: [{ x: 1 }] })));
  assert.equal(result.category, 'http_error');
  assert.ok(String(result.diagnostic || '').includes('503'), 'HTTP status must be retained as sanitized diagnostic metadata');
});

test('#4 upstream classifier: 2xx syntactically malformed JSON is malformed_json', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  let result;
  assert.doesNotThrow(() => { result = c.classifyOpenDataResponse(upstreamResponse(200, '{"data": [')); });
  assert.equal(result.category, 'malformed_json');
});

test('#5 upstream classifier: valid JSON failing the response contract is invalid_contract; upstream-declared JSON error is json_error', () => {
  const { context: c } = createContext();
  assert.equal(typeof c.classifyOpenDataResponse, 'function', 'classifyOpenDataResponse helper is not implemented (Issue #14 Group A)');
  const invalid = c.classifyOpenDataResponse(upstreamResponse(200, '{"foo":"bar"}'));
  assert.equal(invalid.category, 'invalid_contract');
  assert.notEqual(invalid.category, 'success');
  assert.ok(!Array.isArray(invalid.data), 'structurally invalid JSON must not become a successful dataset');
  const upstreamError = c.classifyOpenDataResponse(upstreamResponse(200, JSON.stringify({ error: 'synthetic upstream refusal' })));
  assert.equal(upstreamError.category, 'json_error');
});

// --- Group B: public getOpenData boundary validation (issue tests #15–#18) ---

test('#15 public getOpenData: valid payload, allowed dataset, supported FY passes the boundary and reaches the OpenData path', () => {
  const { context: c, upstreamFetches } = createContext();
  const supportedFy = String(c.getAvailableYears().at(-1)); // canonical server-side FY source
  const res = callGetOpenData(c, { tableName: 's_epi1', year: supportedFy, province: '54' });
  assert.equal(res.status, 200, 'valid request must not be rejected by boundary validation');
  assert.ok(!res.data || !res.data.error, 'valid request must reach the OpenData path without an error envelope');
  assert.equal(upstreamFetches.length, 1, 'empty-cache fallback reached the upstream path for the valid request');
});

test('#16 public getOpenData: missing payload is deterministically rejected without crashing and without upstream access', () => {
  const { context: c, upstreamFetches } = createContext();
  const res = callGetOpenData(c, undefined);
  assert.notEqual(res.status, 500, 'a TypeError crash is not deterministic validation');
  assert.equal(upstreamFetches.length, 0, 'missing payload must never reach the external MOPH fetch');
});

test('#16 public getOpenData: unknown dataset is deterministically rejected before upstream access', () => {
  const { context: c, upstreamFetches } = createContext();
  const supportedFy = String(c.getAvailableYears().at(-1));
  const res = callGetOpenData(c, { tableName: 's_epi99', year: supportedFy, province: '54' });
  assert.ok(res.status !== 200 || (res.data && res.data.error), 'unknown dataset must be rejected');
  assert.equal(upstreamFetches.length, 0, 'unknown dataset must never reach the external MOPH fetch');
});

test('#17 public getOpenData: malformed fiscal year is rejected before upstream access', () => {
  const { context: c, upstreamFetches } = createContext();
  const res = callGetOpenData(c, { tableName: 's_epi1', year: '20X9', province: '54' });
  assert.ok(res.status !== 200 || (res.data && res.data.error), 'malformed FY must be rejected');
  assert.equal(upstreamFetches.length, 0, 'malformed FY must never reach the external MOPH fetch');
});

test('#17 public getOpenData: missing fiscal year is rejected before upstream access', () => {
  const { context: c, upstreamFetches } = createContext();
  const res = callGetOpenData(c, { tableName: 's_epi1', province: '54' });
  assert.ok(res.status !== 200 || (res.data && res.data.error), 'missing FY must be rejected');
  assert.equal(upstreamFetches.length, 0, 'missing FY must never reach the external MOPH fetch');
});

test('#18 public getOpenData: syntactically valid but unsupported fiscal year is rejected before upstream access', () => {
  const { context: c, upstreamFetches } = createContext();
  const supported = c.getAvailableYears().map(String);
  assert.ok(!supported.includes('9999'), 'test premise: 9999 is not in the canonical FY source');
  const res = callGetOpenData(c, { tableName: 's_epi1', year: '9999', province: '54' });
  assert.ok(res.status !== 200 || (res.data && res.data.error), 'four-digit but unsupported FY must be rejected');
  assert.equal(upstreamFetches.length, 0, 'unsupported FY must never reach the external MOPH fetch');
});

test('cache-guard regression: success responses with body statusCode 400/404 are returned but NOT cached', () => {
  // Pre-#14 contract restored: the proxy refused to remember body-declared 400/404 responses.
  // Classifier semantics stay unchanged — these still classify as success (data is an array);
  // only the cache write is suppressed, and the current request still gets the parsed body.
  for (const bodyStatus of [400, 404]) {
    const { context: c, upstreamFetches, cachePuts } =
      createContext({ upstreamBody: JSON.stringify({ statusCode: bodyStatus, data: [] }) });
    const result = c.fetchOpenDataProxy({ tableName: 's_epi1', year: '2569', province: '54' });
    assert.equal(result.statusCode, bodyStatus, `body ${bodyStatus}: per-request return semantics unchanged`);
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), [], `body ${bodyStatus}: data array returned as-is`);
    assert.equal(upstreamFetches.length, 1, `body ${bodyStatus}: upstream was fetched once`);
    assert.equal(cachePuts.length, 0, `body statusCode ${bodyStatus} must NOT be written to cache`);
  }
});
