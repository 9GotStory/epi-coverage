/**
 * Issue #16 (Ticket C) RED contracts — transaction-safe OpenData sync lifecycle.
 *
 * Seams under test (from the issue, not prescribed internals):
 *   - `syncOpenData()` — the public sync entry point, observed through a fully
 *     synthetic GAS VM harness: bounded ScriptLock acquisition, upstream fetches,
 *     header-aware cache inventory/retention (via the #15 schema contract),
 *     single-range rectangular replacement, bounded commit verification, and one
 *     sanitized `sync_opendata` audit summary.
 *   - Reused observable contracts of #14 (classifier semantics via synthetic
 *     upstream responses) and #15 (`ensureOpenDataCacheSchema` / header mapping).
 *
 * Audit assertions are SEMANTIC: the summary format is free (JSON, key=value,
 * …) — a tolerant extractor pulls status/counts/identifiers; no exact-string
 * punctuation is asserted, and raw upstream bodies must never appear.
 *
 * Issue #35 RED contracts — sanitized per-pair OpenData upstream diagnostics.
 * `syncOpenData()` must expose, inside the existing SINGLE `sync_opendata`
 * audit summary, one sanitized per-pair failure record (pair identifier +
 * classifier `category` + bounded `diagnostic`) for every failed dataset/FY
 * pair — never raw upstream bodies, raw exception text, secrets, or entries
 * for successful pairs. All existing #16 lifecycle semantics (counts,
 * retention, commit, lock, exactly one audit) remain unchanged. Assertions
 * stay semantic: any compact sanitized shape is accepted (e.g.
 * `failed_details: [{pair, category, diagnostic}]`).
 *
 * All fixtures are synthetic aggregate data (areacode/hospcode markers only).
 * No production URLs, secrets, tokens, Script Properties, health or person data.
 * One controlled fiscal year (2569) → exactly 5 dataset/FY pairs per sync.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FY = '2569';
const DATASETS = ['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete']; // test expectation of the canonical list
const CANONICAL_HEADER = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json', 'updated_at'];
const NONCANONICAL_HEADER = ['raw_json', 'hospcode', 'table_name', 'updated_at', 'fiscal_year', 'areacode', 'sync_id'];

const upstreamResponse = (code, body) => ({
  getResponseCode: () => code,
  getContentText: () => body,
  getHeaders: () => ({ 'Content-Type': code === 200 ? 'application/json' : 'text/html' }),
});
const json200 = data => upstreamResponse(200, JSON.stringify({ statusCode: 200, data }));
const FRESH_ROW_S_EPI1 = { areacode: '540601', hospcode: '00001', bcg_01: '1' };

/**
 * Build a sheet row aligned to the given header order from a semantic record object.
 * (Tests never assume numeric positions; this helper maps by header name.)
 */
const rowByHeader = (header, record) => header.map(column => record[column] ?? '');

function createHarness({
  header = CANONICAL_HEADER,
  records = [],               // semantic record objects → positioned via `header`
  upstream = {},              // `${table}|${FY}` → response; missing key = hard harness error
  lockAvailable = true,
  failOnDataWrite = false,    // managed data setValues throws BEFORE mutating
  corruptPostWriteReads = false, // first data-region reads after a write observe a mismatch
} = {}) {
  const events = [];
  const audit = [];
  const fetches = [];
  const ops = { dataSetValues: [], dataClearContent: 0, headerWrites: 0, formatting: 0 };
  let uuidCounter = 0;
  let written = false; // becomes true after the first managed data write

  const cells = [[...header], ...records.map(record => rowByHeader(header, record))];
  let maxRows = Math.max(2, cells.length + 4), maxColumns = Math.max(12, header.length + 4);
  const sheet = {
    getName: () => 'opendata_cache',
    getLastRow: () => cells.length,
    getLastColumn: () => header.length ? Math.max(...cells.map(row => row.length)) : 0,
    getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
    insertColumnsAfter(_, count) { maxColumns += count; events.push('sheet:expand'); },
    setFrozenRows() { ops.formatting++; }, setColumnWidth() { ops.formatting++; },
    getRange(row, column, height = 1, width = 1) {
      assert.ok(column + width - 1 <= maxColumns, 'harness: write beyond maxColumns');
      assert.ok(row + height - 1 <= maxRows, 'harness: write beyond maxRows');
      const isDataRegion = row >= 2;
      return {
        getValues() {
          if (isDataRegion) events.push('sheet:data-read');
          const out = Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? ''));
          if (isDataRegion && corruptPostWriteReads && written) {
            // Deterministic post-write observation mismatch for commit verification tests.
            out.push(['corrupt', ...Array(width - 1).fill('')]);
            return out;
          }
          return out;
        },
        setValues(values) {
          if (row === 1) { ops.headerWrites++; }
          if (isDataRegion) {
            if (failOnDataWrite) throw new Error('harness: configured data write failure (before mutation)');
            ops.dataSetValues.push({ row, column, height, width });
            events.push('sheet:data-write');
          }
          values.forEach((entry, i) => {
            cells[row - 1 + i] ||= [];
            entry.forEach((value, j) => { cells[row - 1 + i][column - 1 + j] = value; });
          });
          if (isDataRegion) written = true;
          return this;
        },
        setValue(value) { cells[row - 1][column - 1] = value; return this; },
        clearContent() { if (isDataRegion) { ops.dataClearContent++; events.push('sheet:data-clear'); } return this; },
        setNumberFormat() { ops.formatting++; return this; },
        setFontWeight() { ops.formatting++; return this; }, setBackground() { ops.formatting++; return this; },
      };
    },
  };
  const ss = {
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: name => (name === 'opendata_cache' ? sheet : null),
    getSheets: () => [sheet],
    insertSheet: name => { if (name !== 'opendata_cache') throw new Error('harness: unexpected sheet'); return sheet; },
  };

  const lock = { attempts: [], acquired: 0, releases: 0 };
  const scriptLock = {
    tryLock(timeoutMs) {
      lock.attempts.push(timeoutMs); events.push('lock:try');
      if (lockAvailable) { lock.acquired++; events.push('lock:acquire'); return true; }
      events.push('lock:busy'); return false;
    },
    waitLock(timeoutMs) {
      lock.attempts.push(timeoutMs); events.push('lock:try');
      if (lockAvailable) { lock.acquired++; events.push('lock:acquire'); return; }
      events.push('lock:busy'); throw new Error('harness: simulated lock contention');
    },
    releaseLock() { lock.releases++; events.push('lock:release'); },
  };

  const context = vm.createContext({
    getSpreadsheet: () => ss,
    console: { error() {}, log() {} },
    logAction: (userId, email, action, details) => audit.push({ userId, email, action, details }),
    getAvailableYears: () => [FY], // one controlled fiscal year
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => scriptLock },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    Utilities: { getUuid: () => `uuid-${++uuidCounter}`, formatDate: value => String(value) },
    SpreadsheetApp: { flush() { events.push('sheet:flush'); } },
    UrlFetchApp: {
      fetch: (_url, options) => {
        const payload = JSON.parse(options.payload);
        const key = `${payload.tableName}|${payload.year}`;
        const response = upstream[key];
        if (!response) throw new Error(`harness: no synthetic response configured for ${key}`);
        fetches.push(key); events.push('upstream:fetch');
        if (response instanceof Error) throw response; // #35: deterministic fetch exception (no retry expected)
        return response;
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/OpenData.js'), 'utf8'), context);
  return { context, sheet, cells, events, audit, fetches, ops, lock };
}

/** Run syncOpenData capturing either a returned result or a thrown error. */
function runSync(c) {
  const outcome = {};
  try { outcome.result = c.syncOpenData(); } catch (error) { outcome.thrown = error; }
  return outcome;
}

/** Semantic audit/result extraction — tolerant of JSON, key=value, or prose. */
function evidence(outcome, audit) {
  const texts = audit.filter(a => a.action === 'sync_opendata').map(a => String(a.details));
  const resultObj = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
  if (outcome.thrown) texts.push(String(outcome.thrown));
  texts.push(JSON.stringify(resultObj));
  const joined = texts.join(' | ').toLowerCase();
  const grab = key => {
    for (const t of texts) {
      try { const o = JSON.parse(t); if (o && o[key] != null) return o[key]; } catch { /* not JSON */ }
    }
    const match = joined.match(new RegExp(`${key}\\W{0,4}(\\d+)`));
    return match ? Number(match[1]) : undefined;
  };
  const isNormalSuccess = (resultObj.status === 'success' || resultObj.success === true)
    && !/uncertain|verificat|mismatch|unverified|busy/.test(joined)
    && !texts.some(t => /upstream_failure|partial_success/.test(t.toLowerCase()));
  return { joined, grab, has: s => joined.includes(s.toLowerCase()), isNormalSuccess, resultObj };
}

// Cache content read-back helpers (semantic, header-mapped — never positional).
const cacheRows = h => h.cells.slice(1).map(row => Object.fromEntries(h.cells[0].map((column, i) => [column, row[i] ?? ''])));
const findRow = (h, table) => cacheRows(h).find(r => r.table_name === table && String(r.fiscal_year) === FY);

// --- Issue #35 helpers: tolerant extraction of sanitized per-pair failure details ---

const FAILURE_CATEGORIES = ['http_error', 'non_json', 'malformed_json', 'invalid_contract', 'json_error'];

/**
 * Extract per-pair failure-detail records from `sync_opendata` audit summaries.
 * Shape-agnostic by design: accepts arrays of objects (`{pair, category, diagnostic}`
 * or `{table_name, fiscal_year, category, …}`), objects keyed by pair id, or compact
 * strings carrying a pair id plus a known category token. Details are only read from
 * the audit — the single canonical surface this contract is about.
 */
function pairFailureDetails(audit) {
  const found = [];
  for (const entry of audit.filter(a => a.action === 'sync_opendata')) {
    let parsed;
    try { parsed = JSON.parse(String(entry.details)); } catch { continue; /* not JSON — nothing extractable */ }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = (pair, item) => {
      const category = item.category || item.type || item.reason;
      if (!pair || !category) return;
      found.push({ pair: String(pair), category: String(category), diagnostic: String(item.diagnostic ?? item.detail ?? '') });
    };
    const pairOf = item => {
      if (item.pair != null) return String(item.pair);
      if (item.id != null) return String(item.id);
      const table = item.table_name || item.table || item.dataset;
      return table ? `${table}:${item.fiscal_year || item.year || FY}` : null;
    };
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') record(pairOf(item), item);
          else if (typeof item === 'string') {
            const pair = item.match(/[a-z][a-z0-9_]*:\d{4}/);
            const category = FAILURE_CATEGORIES.find(c => item.includes(c));
            if (pair && category) found.push({ pair: pair[0], category, diagnostic: item });
          }
        }
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (/[a-z][a-z0-9_]*:\d{4}/.test(key) && item && typeof item === 'object') record(key, item);
        }
      }
    }
  }
  return found;
}

const detailFor = (details, table) =>
  details.find(d => d.pair.replace(/[/\s]/g, ':') === `${table}:${FY}` || d.pair.startsWith(table));
const syncAuditCount = h => h.audit.filter(a => a.action === 'sync_opendata').length;
const syncAuditText = h => h.audit.filter(a => a.action === 'sync_opendata').map(a => String(a.details)).join(' | ');

// --- #6 partial success: header-aware retention + classifier-behavioral 503 ---

test('#6 partial upstream failure retains only the failed pair by headers and reports partial_success', () => {
  const h = createHarness({
    header: NONCANONICAL_HEADER,
    records: [{ raw_json: '{"areacode":"540601"}', hospcode: '00002', table_name: 's_epi2', updated_at: '2026-01-01T00:00:00Z', fiscal_year: FY, areacode: '540601', sync_id: 'hist-1' }],
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      // HTTP 503 whose BODY is otherwise valid data — must be classified as failure.
      [`s_epi2|${FY}`]: upstreamResponse(503, JSON.stringify({ statusCode: 200, data: [{ areacode: '540601', hospcode: '09999' }] })),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const ev = evidence(runSync(h.context), h.audit);
  assert.equal(ev.grab('status') || (ev.has('partial_success') ? 'partial_success' : undefined), 'partial_success',
    'overall status must be partial_success');
  assert.equal(ev.grab('success'), 4, 'successful pair count');
  assert.equal(ev.grab('failed'), 1, 'failed pair count');
  assert.equal(ev.grab('fresh'), 1, 'fresh row count');
  assert.equal(ev.grab('retained'), 1, 'retained row count');
  assert.ok(ev.has('s_epi2') && ev.joined.includes(FY), 'failed identifier must include s_epi2 and the FY');
  const retained = findRow(h, 's_epi2');
  assert.ok(retained, 'old s_epi2 row must be retained (by header semantics, not row[1]/row[2])');
  assert.equal(retained.hospcode, '00002', 'retained historical row content preserved');
  const fresh = findRow(h, 's_epi1');
  assert.ok(fresh, 's_epi1 fresh row written');
  assert.equal(fresh.areacode, '540601', 'fresh row aligned to ACTUAL header positions (areacode)');
  assert.ok(fresh.raw_json && fresh.raw_json.includes('540601'), 'fresh row raw_json in the raw_json column');
  assert.ok(!cacheRows(h).some(r => r.hospcode === '09999'), 'the 503 body row must NOT become fresh success data');
  assert.deepEqual(h.cells[0], NONCANONICAL_HEADER, 'header order must remain unchanged');
  assert.ok(!h.audit.some(a => a.action === 'sync_opendata' && /DOCTYPE|540601.{0,40}09999/.test(a.details)),
    'audit must be sanitized (no raw bodies)');
});

// --- #7 all upstream failures: honest upstream_failure + full retention ---

test('#7 all upstream failures retain the prior cache and report upstream_failure honestly', () => {
  const records = DATASETS.map((table, i) => ({
    sync_id: `hist-${i}`, table_name: table, fiscal_year: FY, hospcode: `0000${i}`, areacode: '540601',
    raw_json: `{"areacode":"540601","hospcode":"0000${i}"}`, updated_at: '2026-01-01T00:00:00Z',
  }));
  const h = createHarness({
    records,
    upstream: {
      [`s_epi1|${FY}`]: upstreamResponse(503, 'synthetic upstream unavailable'),
      [`s_epi2|${FY}`]: upstreamResponse(200, '<!DOCTYPE html><html><body>synthetic maintenance page</body></html>'),
      [`s_epi3|${FY}`]: upstreamResponse(200, '{"data": ['),
      [`s_epi5|${FY}`]: upstreamResponse(200, '{"foo":"bar"}'),
      [`s_epi_complete|${FY}`]: upstreamResponse(200, JSON.stringify({ error: 'synthetic upstream refusal' })),
    },
  });
  const ev = evidence(runSync(h.context), h.audit);
  assert.equal(ev.grab('status') || (ev.has('upstream_failure') ? 'upstream_failure' : undefined), 'upstream_failure',
    'overall status must be upstream_failure');
  assert.equal(ev.grab('success'), 0, 'no successful pairs');
  assert.equal(ev.grab('failed'), 5, 'all five pairs failed');
  assert.equal(ev.grab('fresh'), 0, 'no fresh rows');
  assert.equal(ev.grab('retained'), 5, 'all five historical rows retained');
  for (const table of DATASETS) assert.ok(findRow(h, table), `historical ${table} row survives`);
  assert.ok(ev.joined.includes(FY) && DATASETS.every(t => ev.has(t)), 'audit identifies failed pairs compactly');
  assert.ok(!ev.isNormalSuccess, 'audit/result must not describe the sync as normal success');
  const syncAudit = h.audit.filter(a => a.action === 'sync_opendata').map(a => a.details).join(' ');
  assert.ok(!syncAudit.includes('DOCTYPE') && !syncAudit.includes('synthetic upstream unavailable'),
    'no raw upstream body in audit');
});

// --- #8 valid zero-row responses are success ---

test('#8 all valid zero-row upstream responses remain successful dataset/FY outcomes', () => {
  const h = createHarness({
    records: [], // empty data region (header only)
    upstream: Object.fromEntries(DATASETS.map(t => [`${t}|${FY}`, json200([])])),
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);
  assert.equal(ev.grab('success'), 5, 'all five pairs count as successful');
  assert.equal(ev.grab('failed'), 0, 'zero failed pairs');
  assert.equal(ev.grab('status') || (ev.isNormalSuccess ? 'success' : undefined), 'success',
    'overall status must be success');
  assert.equal(ev.grab('fresh'), 0, 'zero fresh rows');
  assert.ok(!ev.has('upstream_failure'), 'valid zero rows must NOT become upstream_failure');
  assert.ok(!outcome.thrown, 'sync must not throw');
  assert.ok(!/no data synced/i.test(ev.joined), 'must not falsely report failure merely because final rows are zero');
  assert.ok(h.audit.some(a => a.action === 'sync_opendata'), 'a truthful sync audit still occurs');
});

// --- #9 single-range padded replacement removes the stale tail ---

test('#9 replacement uses one padded setValues range and removes stale tail without clearContent', () => {
  const h = createHarness({
    records: DATASETS.slice(1).map((table, i) => ({ // 4 old managed rows (s_epi2..s_epi_complete)
      sync_id: `old-${i}`, table_name: table, fiscal_year: FY, hospcode: `0000${i}`, areacode: '540601',
      raw_json: `{"old":${i}}`, updated_at: '2026-01-01T00:00:00Z',
    })),
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: json200([]), [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  runSync(h.context);
  assert.equal(h.ops.dataClearContent, 0, 'no clearContent on the managed cache');
  assert.equal(h.ops.dataSetValues.length, 1, 'exactly ONE managed data-region setValues call');
  const write = h.ops.dataSetValues[0];
  assert.equal(write.height, 4, 'replacementHeight = max(oldManaged=4, new=1)');
  assert.equal(write.width, CANONICAL_HEADER.length, 'width spans the authoritative schema');
  const fresh = findRow(h, 's_epi1');
  assert.ok(fresh, 'first row contains the new generation');
  const dataRows = h.cells.slice(1);
  assert.equal(dataRows.length, 4, 'padded rectangle present');
  const blankTail = dataRows.slice(1).filter(row => row.every(cell => cell === '' || cell == null));
  assert.equal(blankTail.length, 3, 'remaining 3 rows are blank padding (stale tail removed by the same write)');
});

// --- #10 failed replacement preserves the prior valid cache ---

test('#10 replacement failure never intentionally clears the previous cache first', () => {
  const records = DATASETS.map((table, i) => ({
    sync_id: `hist-${i}`, table_name: table, fiscal_year: FY, hospcode: `0000${i}`, areacode: '540601',
    raw_json: `{"hist":${i}}`, updated_at: '2026-01-01T00:00:00Z',
  }));
  const h = createHarness({
    records,
    failOnDataWrite: true, // managed replacement setValues throws BEFORE mutating
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: json200([]), [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const before = h.cells.map(row => [...row]);
  const outcome = runSync(h.context);
  assert.ok(outcome.thrown || !evidence(outcome, h.audit).isNormalSuccess, 'failure must not be reported as normal success');
  assert.equal(h.ops.dataClearContent, 0, 'zero clearContent calls — the prior cache was not intentionally destroyed first');
  assert.deepEqual(h.cells, before, 'previous cache rows remain byte-for-byte intact');
  assert.ok(!h.audit.some(a => a.action === 'sync_opendata' && evidence({ result: {} }, [a]).isNormalSuccess),
    'no false successful-sync audit');
});

// --- #11 commit verification uncertainty is not success + no metadata fabrication ---

test('#11 commit verification mismatch is not success and retained historical metadata is never fabricated', () => {
  const legacyHeader = ['table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json']; // no sync_id/updated_at
  const legacyRecord = { table_name: 's_epi2', fiscal_year: FY, hospcode: '00002', areacode: '540601', raw_json: '{"areacode":"540601"}' };
  const h = createHarness({
    header: legacyHeader,
    records: [legacyRecord],
    corruptPostWriteReads: true, // post-write observation returns a deterministic mismatch
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: upstreamResponse(503, 'synthetic unavailable'),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);
  assert.ok(!ev.isNormalSuccess, 'commit/verification mismatch must not be reported as normal success');
  assert.ok(/uncertain|verificat|mismatch|unverified/.test(ev.joined),
    'result/audit must indicate commit/verification uncertainty');
  const retained = findRow(h, 's_epi2');
  assert.ok(retained, 'the failed pair is retained header-aware');
  assert.ok(retained.sync_id === '' || retained.sync_id === undefined, 'retained historical row: no fabricated sync_id');
  assert.ok(retained.updated_at === '' || retained.updated_at === undefined, 'retained historical row: no fabricated updated_at');
  assert.ok(!/uuid-\d/.test([retained.sync_id, retained.updated_at].join(' ')), 'no generated UUID/timestamp on historical data');
});

// --- #19a busy lock: zero lifecycle work ---

test('#19a lock timeout returns sync_busy before upstream/cache lifecycle work', () => {
  const legacyHeader = ['table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json'];
  const h = createHarness({
    header: legacyHeader,
    records: [{ table_name: 's_epi2', fiscal_year: FY, hospcode: '00002', areacode: '540601', raw_json: '{}' }],
    upstream: { [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]) },
    lockAvailable: false,
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);
  assert.ok(ev.has('busy') || /sync_busy/.test(ev.joined), 'deterministic result identifies sync_busy');
  assert.ok(!ev.isNormalSuccess, 'busy must not masquerade as a normal sync result');
  assert.equal(h.fetches.length, 0, 'zero upstream fetches');
  assert.equal(h.ops.dataSetValues.length, 0, 'no managed cache data write');
  assert.equal(h.ops.dataClearContent, 0, 'no clearContent');
  assert.deepEqual(h.cells[0], legacyHeader, 'schema NOT healed/mutated while the lock was not acquired');
  assert.ok(!h.audit.some(a => a.action === 'sync_opendata'), 'no normal sync_opendata success/failure audit');
  assert.ok(h.lock.attempts.length > 0, 'a bounded acquisition was attempted');
  assert.ok(h.lock.attempts.every(t => Number.isFinite(t) && t > 0), 'acquisition timeout exists, finite, positive');
  assert.equal(h.lock.releases, 0, 'lock not spuriously released when never acquired');
});

// --- #19b lock spans the successful lifecycle and is released once ---

test('#19b successful sync holds the lock across schema/inventory/fetch/commit/verify/audit and releases once', () => {
  const h = createHarness({
    upstream: { [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]), [`s_epi2|${FY}`]: json200([]),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]) },
  });
  runSync(h.context);
  assert.equal(h.lock.attempts.length, 1, 'exactly one acquisition attempt');
  assert.ok(h.lock.attempts.every(t => Number.isFinite(t) && t > 0), 'bounded timeout argument');
  assert.equal(h.lock.acquired, 1, 'lock acquired');
  assert.equal(h.lock.releases, 1, 'released exactly once');
  const at = name => h.events.indexOf(name);
  const acquire = Math.max(at('lock:acquire'), at('lock:try'));
  const firstFetch = at('upstream:fetch');
  const write = at('sheet:data-write');
  const release = at('lock:release');
  assert.ok(acquire !== -1 && firstFetch !== -1, 'acquire and fetch events exist');
  assert.ok(acquire < firstFetch, 'lock acquired before upstream work');
  if (write !== -1) assert.ok(acquire < write && write < release, 'commit/write while lock held, before release');
  assert.ok(release > firstFetch, 'release after upstream work');
  assert.ok(release > Math.max(...h.audit.map((_, i) => i).map(() => 0), at('sheet:data-write') === -1 ? acquire : write),
    'release after lifecycle completion');
  assert.ok(h.audit.some(a => a.action === 'sync_opendata'), 'audit occurs (while held)');
  const auditIdx = h.events.length; // audit is pushed via logAction during the lifecycle; ordering asserted via release-last
  assert.ok(h.events.lastIndexOf('lock:release') > h.events.indexOf('sheet:data-write'), 'release is the last lifecycle event');
});

// --- #19c lock releases exactly once on lifecycle failure ---

test('#19c acquired lock is released exactly once when the sync lifecycle fails', () => {
  const h = createHarness({
    failOnDataWrite: true, // deterministic post-acquisition failure
    upstream: { [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]), [`s_epi2|${FY}`]: json200([]),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]) },
  });
  const outcome = runSync(h.context); // returned failure or thrown error — both accepted
  assert.equal(h.lock.acquired, 1, 'lock was acquired');
  assert.equal(h.lock.releases, 1, 'released exactly once (behavioral release-in-finally)');
  assert.ok(h.events.lastIndexOf('lock:release') > h.events.indexOf('sheet:data-write') || h.lock.releases === 1,
    'release occurs after the failure point');
  assert.ok(!h.audit.some(a => a.action === 'sync_opendata' && evidence({ result: {} }, [a]).isNormalSuccess),
    'no normal success audit');
  assert.ok(outcome.thrown || typeof outcome.result === 'object', 'failure captured without harness crash');
});

// --- #35 RED: sanitized per-pair OpenData upstream diagnostics in the sync audit ---

test('#35a http-failure pair exposes sanitized category and bounded diagnostic in the single sync_opendata audit', () => {
  const BODY_SENTINEL = 'synthetic-unavailable-body-730601';
  const h = createHarness({
    records: [{ sync_id: 'hist-1', table_name: 's_epi2', fiscal_year: FY, hospcode: '00002', areacode: '540601',
      raw_json: '{"areacode":"540601"}', updated_at: '2026-01-01T00:00:00Z' }],
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: upstreamResponse(503, BODY_SENTINEL),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const outcome = runSync(h.context);
  const details = pairFailureDetails(h.audit);
  const detail = detailFor(details, 's_epi2');
  assert.ok(detail, 'sync_opendata audit must retain a sanitized per-pair failure detail for s_epi2:2569 '
    + '(e.g. failed_details: [{pair, category, diagnostic}]) — classifier output must not be dropped');
  assert.equal(detail.category, 'http_error', 'HTTP failure category must be http_error');
  assert.ok(/status=503/.test(String(detail.diagnostic)), 'diagnostic carries bounded status metadata');
  assert.ok(/content[-_ ]?type/i.test(String(detail.diagnostic)), 'diagnostic carries bounded content-type metadata');
  assert.ok(detail.pair.includes('s_epi2') && detail.pair.includes(FY), 'detail identifies the failed dataset/FY pair');
  assert.equal(syncAuditCount(h), 1, 'still exactly ONE sync_opendata audit summary (no second diagnostic audit)');
  const auditText = syncAuditText(h);
  assert.ok(!auditText.includes(BODY_SENTINEL) && !auditText.includes('DOCTYPE'),
    'upstream body must NOT be retained anywhere in the audit');
  const ev = evidence(outcome, h.audit);
  assert.equal(ev.grab('status'), 'partial_success', 'existing overall status semantics unchanged');
  assert.equal(ev.grab('success'), 4, 'successful pair count unchanged');
  assert.equal(ev.grab('failed'), 1, 'failed pair count unchanged');
  assert.equal(ev.grab('fresh'), 1, 'fresh row count unchanged');
  assert.equal(ev.grab('retained'), 1, 'retained row count unchanged');
  assert.equal(ev.grab('commit'), 'verified', 'commit semantics unchanged');
  const retained = findRow(h, 's_epi2');
  assert.ok(retained && retained.hospcode === '00002', 'retention behavior unchanged');
});

test('#35b non-JSON (HTML) failure exposes a non_json detail without retaining the HTML body', () => {
  const HTML_BODY = '<!DOCTYPE html><html><body>synthetic maintenance page marker-740601</body></html>';
  const h = createHarness({
    records: [{ sync_id: 'hist-2', table_name: 's_epi2', fiscal_year: FY, hospcode: '00002', areacode: '540601',
      raw_json: '{"areacode":"540601"}', updated_at: '2026-01-01T00:00:00Z' }],
    upstream: {
      [`s_epi1|${FY}`]: json200([]),
      [`s_epi2|${FY}`]: upstreamResponse(200, HTML_BODY), // 2xx but HTML → non_json
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  runSync(h.context);
  const details = pairFailureDetails(h.audit);
  const detail = detailFor(details, 's_epi2');
  assert.ok(detail, 'sync_opendata audit must retain a sanitized per-pair failure detail for the non-JSON pair s_epi2:2569');
  assert.equal(detail.category, 'non_json', 'HTML/text response must be distinguishable as non_json');
  assert.ok(detail.pair.includes('s_epi2') && detail.pair.includes(FY), 'pair identifiable');
  assert.equal(syncAuditCount(h), 1, 'still exactly one sync_opendata audit summary');
  const auditText = syncAuditText(h);
  assert.ok(!auditText.includes('DOCTYPE') && !auditText.includes('marker-740601'),
    'HTML/text response body must NOT be retained in the audit');
});

test('#35c malformed_json, invalid_contract, json_error, and http_error stay distinguishable per pair', () => {
  const h = createHarness({
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]), // successful pair — no detail expected
      [`s_epi2|${FY}`]: upstreamResponse(200, '{"data": ['),                              // malformed_json
      [`s_epi3|${FY}`]: upstreamResponse(200, '{"foo":"bar"}'),                           // invalid_contract
      [`s_epi5|${FY}`]: upstreamResponse(200, JSON.stringify({ error: 'synthetic upstream refusal' })), // json_error
      [`s_epi_complete|${FY}`]: upstreamResponse(503, 'synthetic unavailable'),           // http_error
    },
  });
  runSync(h.context);
  const details = pairFailureDetails(h.audit);
  assert.ok(details.length >= 4, `four failing pairs need four distinguishable per-pair details — found ${details.length}`);
  const expected = { s_epi2: 'malformed_json', s_epi3: 'invalid_contract', s_epi5: 'json_error', s_epi_complete: 'http_error' };
  for (const [table, category] of Object.entries(expected)) {
    const detail = detailFor(details, table);
    assert.ok(detail, `per-pair detail required for ${table}:${FY}`);
    assert.equal(detail.category, category, `${table} must stay distinguishable as ${category}`);
  }
  assert.ok(!detailFor(details, 's_epi1'), 'the successful pair must not produce a failure detail');
  assert.equal(syncAuditCount(h), 1, 'still exactly one sync_opendata audit summary');
});

test('#35d UrlFetchApp.fetch exception becomes deterministic request_failed metadata with no raw exception text', () => {
  const EXCEPTION_SENTINEL = 'synthetic-fetch-explosion-750601';
  const h = createHarness({
    records: [{ sync_id: 'hist-3', table_name: 's_epi2', fiscal_year: FY, hospcode: '00002', areacode: '540601',
      raw_json: '{"areacode":"540601"}', updated_at: '2026-01-01T00:00:00Z' }],
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: new Error(`UrlFetchApp synthetic failure ${EXCEPTION_SENTINEL}`), // fetch() itself throws
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const outcome = runSync(h.context);
  const details = pairFailureDetails(h.audit);
  const detail = detailFor(details, 's_epi2');
  assert.ok(detail, 'a fetch exception on pair s_epi2:2569 must still produce a per-pair failure detail');
  assert.ok(FAILURE_CATEGORIES.includes(detail.category),
    `deterministic existing failure category (http_error or equivalent) required — got '${detail && detail.category}'`);
  assert.ok(/request_failed/.test(String(detail.diagnostic)),
    'diagnostic identifies request_failed deterministically (no exception text)');
  const ev = evidence(outcome, h.audit);
  assert.ok(!ev.joined.includes(EXCEPTION_SENTINEL), 'raw exception text must NOT appear in result or audit');
  assert.equal(ev.grab('success'), 4, 'other pairs unaffected');
  assert.equal(ev.grab('failed'), 1, 'fetch exception counts as exactly one failed pair');
  assert.equal(h.fetches.filter(key => key === `s_epi2|${FY}`).length, 1, 'no retry/backoff introduced');
  assert.equal(syncAuditCount(h), 1, 'still exactly one sync_opendata audit summary');
});

test('#35e only failed pairs create failure-detail entries (successful pairs create none)', () => {
  const h = createHarness({
    upstream: {
      [`s_epi1|${FY}`]: json200([FRESH_ROW_S_EPI1]),
      [`s_epi2|${FY}`]: upstreamResponse(503, 'synthetic unavailable'),
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  runSync(h.context);
  const details = pairFailureDetails(h.audit);
  assert.equal(details.length, 1, `exactly one failure detail — the failed pair — expected, found ${details.length}`);
  const detail = detailFor(details, 's_epi2');
  assert.ok(detail, 'the single detail belongs to the failed pair s_epi2:2569');
  const successfulTables = ['s_epi1', 's_epi3', 's_epi5', 's_epi_complete'];
  assert.ok(!successfulTables.some(t => details.some(d => d.pair.includes(t))),
    'successful dataset/FY pairs must not create failure-detail entries');

  // Fully successful sync: zero failure-detail entries at all.
  const ok = createHarness({ upstream: Object.fromEntries(DATASETS.map(t => [`${t}|${FY}`, json200([])])) });
  runSync(ok.context);
  assert.equal(pairFailureDetails(ok.audit).length, 0, 'a fully successful sync produces no failure details');
  assert.equal(syncAuditCount(ok), 1, 'still exactly one sync_opendata audit summary');
});

test('#35f all-pairs upstream_failure keeps lifecycle semantics and gains one sanitized detail per pair', () => {
  // Production FY2569 incident shape: all five pairs fail, prior cache fully retained, commit verified.
  const BODY_SENTINELS = DATASETS.map((_, i) => `synthetic-503-body-${i}-760601`);
  const records = DATASETS.map((table, i) => ({
    sync_id: `hist-${i}`, table_name: table, fiscal_year: FY, hospcode: `0000${i}`, areacode: '540601',
    raw_json: `{"areacode":"540601","hospcode":"0000${i}"}`, updated_at: '2026-01-01T00:00:00Z',
  }));
  const h = createHarness({
    records,
    upstream: Object.fromEntries(DATASETS.map((t, i) => [`${t}|${FY}`, upstreamResponse(503, BODY_SENTINELS[i])])),
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);
  assert.equal(ev.grab('status'), 'upstream_failure', 'overall status unchanged (production incident shape)');
  assert.equal(ev.grab('success'), 0, 'success count unchanged');
  assert.equal(ev.grab('failed'), 5, 'failed count unchanged');
  assert.equal(ev.grab('fresh'), 0, 'fresh count unchanged');
  assert.equal(ev.grab('retained'), 5, 'retained count unchanged');
  assert.equal(ev.grab('commit'), 'verified', 'commit semantics unchanged');
  for (const table of DATASETS) assert.ok(findRow(h, table), `historical ${table} row retained (retention unchanged)`);
  assert.equal(syncAuditCount(h), 1, 'exactly one normal sync_opendata audit summary');
  const details = pairFailureDetails(h.audit);
  assert.equal(details.length, 5, `one sanitized per-pair detail for every failed pair — found ${details.length}`);
  for (const table of DATASETS) {
    const detail = detailFor(details, table);
    assert.ok(detail, `per-pair detail required for ${table}:${FY}`);
    assert.equal(detail.category, 'http_error', `${table} categorized http_error`);
    assert.ok(/status=503/.test(String(detail.diagnostic)), `${table} diagnostic carries bounded status metadata`);
  }
  const auditText = syncAuditText(h);
  assert.ok(!BODY_SENTINELS.some(s => auditText.includes(s)) && !auditText.includes('DOCTYPE'),
    'no raw upstream response bodies in the audit');
});
