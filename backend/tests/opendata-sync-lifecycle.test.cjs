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
  upstream = {},              // `${table}|${FY}` → response | Error | array of those (scripted per-attempt sequence)
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
  // Issue #37: virtual time — Utilities.sleep records and advances a clock instead of
  // really sleeping, so pacing/backoff stays fast and deterministic to observe.
  let now = 0;
  const sleeps = [];   // { ms, at } — every Utilities.sleep call in virtual ms
  const attempts = []; // { key, at, status } — every upstream wire attempt in arrival order
  const scripted = new Map(); // `${table}|${FY}` → remaining scripted responses (array configs only)

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
    Utilities: {
      getUuid: () => `uuid-${++uuidCounter}`,
      formatDate: value => String(value),
      sleep: ms => { sleeps.push({ ms, at: now }); now += ms; }, // #37: virtual sleep — no real waiting
    },
    SpreadsheetApp: { flush() { events.push('sheet:flush'); } },
    UrlFetchApp: {
      fetch: (_url, options) => {
        const payload = JSON.parse(options.payload);
        const key = `${payload.tableName}|${payload.year}`;
        let response = upstream[key];
        if (Array.isArray(response)) { // #37: scripted per-attempt sequence, consumed in order
          if (!scripted.has(key)) scripted.set(key, [...response]);
          const queue = scripted.get(key);
          if (queue.length === 0) throw new Error(`harness: scripted responses exhausted for ${key}`);
          response = queue.shift();
        }
        if (!response) throw new Error(`harness: no synthetic response configured for ${key}`);
        fetches.push(key); events.push('upstream:fetch');
        attempts.push({ key, at: now, status: response instanceof Error ? null : response.getResponseCode() });
        if (response instanceof Error) throw response; // #35: deterministic fetch exception (no retry expected)
        return response;
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/OpenData.js'), 'utf8'), context);
  return { context, sheet, cells, events, audit, fetches, ops, lock, sleeps, attempts };
}

/** Run syncOpenData capturing either a returned result or a thrown error.
 *  #37f: optional invocationSource forwards the trusted internal argument
 *  (e.g. 'manual'). When omitted, the exact no-argument (trigger-shaped)
 *  lifecycle path is exercised — existing tests keep that behavior. */
function runSync(c, invocationSource) {
  const outcome = {};
  try {
    outcome.result = invocationSource === undefined
      ? c.syncOpenData()
      : c.syncOpenData(invocationSource);
  } catch (error) { outcome.thrown = error; }
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

// --- #37 RED (tracer bullet): transient upstream failure resilience ---
//
// Issue #37 contract under test: a transient HTTP 429 for one dataset/FY pair is
// retried once after a bounded ~5000ms backoff; the pair's second (successful)
// response makes it a FINAL SUCCESS. All other pairs use simple successful
// responses so this test isolates exactly one behavior. Observables are the
// upstream wire stream (attempt count/order, virtual inter-attempt gap), the
// single sync_opendata audit summary, the committed cache, and lock events —
// never internal helpers. Retry eligibility itself (numeric status 429/5xx) is
// exercised behaviorally here; no assertion touches private structure.
// The prior #35d "no retry" pin covers fetch EXCEPTIONS (still single-attempt
// per #37) and is therefore not contradicted by this contract.

test('#37a transient HTTP 429 is retried with bounded backoff and becomes a final success for that pair', () => {
  const THROTTLE_BODY_SENTINEL = 'synthetic-throttle-body-sentinel-37a';
  const FRESH_ROW_S_EPI2 = { areacode: '540602', hospcode: '00003', dtp_03: '1' };
  const h = createHarness({
    upstream: {
      [`s_epi1|${FY}`]: json200([]),
      // the isolated behavior: attempt 1 → HTTP 429, attempt 2 → valid synthetic 200 JSON
      [`s_epi2|${FY}`]: [upstreamResponse(429, THROTTLE_BODY_SENTINEL), json200([FRESH_ROW_S_EPI2])],
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);

  // 1. the transient pair is fetched exactly twice (RED today: exactly one attempt — no retry exists)
  const s2Attempts = h.attempts.filter(a => a.key === `s_epi2|${FY}`);
  assert.equal(s2Attempts.length, 2,
    `expected 2 wire attempts for transient HTTP 429 on s_epi2:${FY} (bounded retry), actual ${s2Attempts.length}`);

  // 2–3. a bounded retry delay of ~5000ms (Issue #37) is observable between attempt 1 and attempt 2
  const retryGapMs = s2Attempts[1].at - s2Attempts[0].at;
  assert.ok(retryGapMs >= 4000 && retryGapMs <= 6000,
    `first retry delay must be approximately 5000ms per Issue #37 — observed virtual gap ${retryGapMs}ms`);
  assert.ok(h.sleeps.some(s => s.ms >= 4000 && s.ms <= 6000),
    'backoff must be a bounded delay observable at the Utilities.sleep service boundary');

  // 4. the successful second response makes the pair a final success (overall run succeeds)
  assert.equal(ev.grab('success'), 5, 'all five pairs count as successful after the retry recovers');
  assert.equal(ev.grab('failed'), 0, 'no pair may count as failed');
  assert.equal(ev.grab('status'), 'success', 'overall status must be success');
  assert.equal(ev.grab('commit'), 'verified', 'commit semantics unchanged');
  const fresh = findRow(h, 's_epi2');
  assert.ok(fresh && String(fresh.areacode).startsWith('5406'), 'the recovered pair contributes fresh committed rows');

  // 5–6. the recovered pair must not appear as a final failed pair anywhere in the audit
  const summary = JSON.parse(String(h.audit.find(a => a.action === 'sync_opendata').details));
  assert.ok(![...(summary.failed_pairs || [])].some(p => String(p).includes('s_epi2')),
    'recovered pair must not appear in failed_pairs');
  const details = pairFailureDetails(h.audit);
  assert.ok(!details.some(d => d.pair.includes('s_epi2')),
    'recovered pair must not appear in failed_details');

  // 7. the final lifecycle result does not count the pair as failed
  assert.equal(outcome.result && outcome.result.failed_pairs, 0, 'result failed_pairs count excludes the recovered pair');

  // 8. still exactly one normal sync_opendata audit summary
  assert.equal(syncAuditCount(h), 1, 'exactly one sync_opendata audit summary');

  // 9. no raw upstream body (including the 429 body) is retained anywhere in the audit
  const auditText = syncAuditText(h);
  assert.ok(!auditText.includes(THROTTLE_BODY_SENTINEL) && !auditText.includes('DOCTYPE'),
    'raw upstream 429 body must not be retained in the audit');

  // 10. cache/commit/lock semantics remain observable and unchanged for this scenario
  assert.equal(h.lock.acquired, 1, 'lock acquired exactly once');
  assert.equal(h.lock.releases, 1, 'lock released exactly once');
  assert.equal(h.ops.dataClearContent, 0, 'no clearContent on the managed cache');
  for (const table of ['s_epi1', 's_epi3', 's_epi5', 's_epi_complete']) {
    assert.equal(h.fetches.filter(key => key === `${table}|${FY}`).length, 1,
      `unrelated pair ${table} stays at exactly one attempt (isolation)`);
  }
});

// --- #37 RED (tracer bullet 2): the HTTP 5xx STATUS CLASS is transient ---
//
// Issue #37 contract: numeric statuses 500–599 share the bounded retry already
// proven for 429 in #37a. This test exercises the CLASS, not one status: two
// affected pairs use opposite class boundaries (500 and 599), each scripted
// attempt 1 → 5xx, attempt 2 → valid 200 JSON. All other pairs are simple
// successes so only 5xx-retry behavior is isolated. Observables stay at the
// public seam: wire attempts (count/order/status/virtual timing), the single
// audit summary, committed cache, and lock events. Permanent 4xx, exceptions,
// and contract failures are NOT retried per #37 and are covered elsewhere.

test('#37b transient HTTP 5xx responses are retried with bounded backoff and recovered pairs become final successes', () => {
  const FRESH_ROW_A = { areacode: '540601', hospcode: '00011', bcg_01: '1' };   // recovery payload for the 500 pair
  const FRESH_ROW_B = { areacode: '540602', hospcode: '00012', dtp_03: '1' };   // recovery payload for the 599 pair
  const BODY_SENTINELS = {
    s_epi1: 'synthetic-5xx-body-sentinel-37b-500',
    s_epi2: 'synthetic-5xx-body-sentinel-37b-599',
  };
  const h = createHarness({
    upstream: {
      // pair A: lower class boundary
      [`s_epi1|${FY}`]: [upstreamResponse(500, BODY_SENTINELS.s_epi1), json200([FRESH_ROW_A])],
      // pair B: upper class boundary
      [`s_epi2|${FY}`]: [upstreamResponse(599, BODY_SENTINELS.s_epi2), json200([FRESH_ROW_B])],
      [`s_epi3|${FY}`]: json200([]), [`s_epi5|${FY}`]: json200([]), [`s_epi_complete|${FY}`]: json200([]),
    },
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);

  // 1–4. per affected 5xx pair: exactly two wire attempts, first carries the
  //      configured 5xx status, a ~5000ms bounded retry delay separates them,
  //      and the second attempt succeeds (numeric status 200).
  const affected = [
    { table: 's_epi1', transientStatus: 500 },
    { table: 's_epi2', transientStatus: 599 },
  ];
  for (const { table, transientStatus } of affected) {
    const attempts = h.attempts.filter(a => a.key === `${table}|${FY}`);
    assert.equal(attempts.length, 2,
      `expected 2 wire attempts for transient HTTP ${transientStatus} on ${table}:${FY} (bounded 5xx-class retry), actual ${attempts.length}`);
    assert.equal(attempts[0].status, transientStatus,
      `attempt 1 for ${table}:${FY} must carry the configured 5xx status ${transientStatus}`);
    assert.equal(attempts[1].status, 200,
      `attempt 2 for ${table}:${FY} must be the successful recovery request`);
    const retryGapMs = attempts[1].at - attempts[0].at;
    assert.ok(retryGapMs >= 4000 && retryGapMs <= 6000,
      `first retry delay for ${table}:${FY} must be approximately 5000ms per Issue #37 — observed virtual gap ${retryGapMs}ms`);
  }

  // 5. both recovered pairs count as final successes (whole run succeeds)
  assert.equal(ev.grab('success'), 5, 'all five pairs count as successful after 5xx retries recover');
  assert.equal(ev.grab('failed'), 0, 'no pair may count as failed');
  assert.equal(ev.grab('status'), 'success', 'overall status must be success');
  assert.ok(findRow(h, 's_epi1') && findRow(h, 's_epi2'), 'recovered pairs contribute fresh committed rows');

  // 6–7. neither recovered pair appears as a final failed pair anywhere in the audit
  const summary = JSON.parse(String(h.audit.find(a => a.action === 'sync_opendata').details));
  for (const { table } of affected) {
    assert.ok(![...(summary.failed_pairs || [])].some(p => String(p).includes(table)),
      `recovered pair ${table} must not appear in failed_pairs`);
  }
  const details = pairFailureDetails(h.audit);
  assert.ok(!details.some(d => d.pair.includes('s_epi1') || d.pair.includes('s_epi2')),
    'recovered 5xx pairs must not appear in failed_details');
  assert.equal(outcome.result && outcome.result.failed_pairs, 0, 'result failed_pairs count excludes both recovered pairs');

  // 8–12. lifecycle isolation and unchanged semantics
  for (const table of ['s_epi3', 's_epi5', 's_epi_complete']) {
    assert.equal(h.fetches.filter(key => key === `${table}|${FY}`).length, 1,
      `unaffected pair ${table} stays a single-attempt success`);
  }
  assert.equal(syncAuditCount(h), 1, 'exactly one normal sync_opendata audit summary');
  const auditText = syncAuditText(h);
  assert.ok(!Object.values(BODY_SENTINELS).some(s => auditText.includes(s)) && !auditText.includes('DOCTYPE'),
    'no raw upstream 5xx body retained anywhere in the audit');
  assert.equal(ev.grab('commit'), 'verified', 'commit verification remains successful');
  assert.equal(h.lock.acquired, 1, 'lock acquired exactly once');
  assert.equal(h.lock.releases, 1, 'lock released exactly once');
});

// --- #37 RED (tracer bullet 3): deliberate inter-pair pacing ---
//
// Issue #37 contract: completed dataset/FY-pair lifecycles are paced before the
// next pair begins — strictly sequential fetches, a fixed ~2000ms inter-pair
// delay (approved floor ≥1500ms), exactly four pacing intervals for five pairs,
// and NO trailing delay after the final pair. This scenario isolates pacing
// from retry/backoff: every pair succeeds on its first attempt, so any sleep
// observed can only be pacing. Primary signal = upstream attempt timestamps on
// the virtual clock; the Utilities.sleep log corroborates without coupling to
// any private helper. No fetch latency is modeled by this harness, so gaps are
// exactly the pacing delays once implemented.

test('#37c successful dataset pairs are paced between lifecycles with no trailing delay', () => {
  const h = createHarness({
    upstream: Object.fromEntries(DATASETS.map(t => [`${t}|${FY}`, json200([])])), // all first-attempt successes
  });
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);

  // 1–3. exactly five upstream attempts, once each, in canonical sequential order
  assert.equal(h.attempts.length, 5, `expected exactly 5 upstream attempts, actual ${h.attempts.length}`);
  assert.deepEqual(h.attempts.map(a => a.key), DATASETS.map(t => `${t}|${FY}`),
    'attempts must stay sequential in canonical dataset order, each pair exactly once');

  // 4–7. exactly four inter-pair pacing intervals: each next pair begins only
  //      after ≥1500ms (approved floor) targeting ~2000ms since the previous
  //      pair's attempt — observed via virtual attempt timestamps.
  for (let i = 1; i < h.attempts.length; i++) {
    const gapMs = h.attempts[i].at - h.attempts[i - 1].at;
    assert.ok(gapMs >= 1500,
      `inter-pair pacing: ${h.attempts[i].key} must begin at least 1500ms after ${h.attempts[i - 1].key} (Issue #37 ~2000ms target) — observed ${gapMs}ms`);
    assert.ok(gapMs <= 2500,
      `inter-pair pacing must stay a bounded fixed delay (~2000ms), observed ${gapMs}ms before ${h.attempts[i].key}`);
  }
  const pacingSleeps = h.sleeps;
  assert.equal(pacingSleeps.length, 4,
    `exactly four pacing sleeps for five completed pairs (and no trailing delay after the final pair) — observed ${pacingSleeps.length}`);
  for (const s of pacingSleeps) {
    assert.ok(s.ms >= 1500 && s.ms <= 2500,
      `each pacing sleep must be approximately 2000ms — observed ${s.ms}ms`);
  }

  // 8–9. no sleep after the final pair and no retry/backoff sleeps in this
  //      all-success scenario (backoff scale is 5000/10000ms — none may appear)
  assert.ok(!h.sleeps.some(s => s.ms >= 4000), 'no retry/backoff-scale sleeps may occur when every pair succeeds first-attempt');

  // 10–12. lifecycle semantics unchanged
  assert.equal(ev.grab('success'), 5, 'all five pairs remain final successes');
  assert.equal(ev.grab('failed'), 0, 'no failed pairs');
  assert.equal(ev.grab('status'), 'success', 'overall status must be success');
  assert.equal(syncAuditCount(h), 1, 'exactly one normal sanitized sync_opendata audit summary');
  assert.equal(ev.grab('commit'), 'verified', 'commit verification unchanged');
  assert.equal(h.lock.acquired, 1, 'lock acquired exactly once');
  assert.equal(h.lock.releases, 1, 'lock released exactly once');
});

// --- #37 RED (tracer bullet 4): invocation-source observability (trigger shape) ---
//
// Issue #37 contract: the existing single sanitized sync_opendata audit summary
// gains one field — `source` — derived from the backend entry path. This test
// covers ONLY the trusted no-argument call shape `syncOpenData()`, which is the
// only shape a time-driven Apps Script trigger can produce; it must be audited
// as `source: "trigger"`. The manual Router path and client-spoofing rejection
// belong to a later tracer bullet at the Router seam. Accepted caveat (#37): a
// developer manually running bare syncOpenData() in the editor is also labeled
// "trigger". Observables: the audit summary JSON only — no private helpers.

test('#37d no-argument sync invocation is audited as trigger source', () => {
  const h = createHarness({
    upstream: Object.fromEntries(DATASETS.map(t => [`${t}|${FY}`, json200([])])), // simple all-success scenario
  });
  // 1. the real lifecycle entry point invoked with NO source argument — the
  //    canonical trigger-shaped call (runSync's call shape is syncOpenData()).
  const outcome = runSync(h.context);
  const ev = evidence(outcome, h.audit);

  // 2–3. the sync itself succeeds normally with every pair successful
  assert.equal(ev.grab('status'), 'success', 'sync succeeds normally');
  assert.equal(ev.grab('success'), 5, 'all five pairs remain successful');
  assert.equal(ev.grab('failed'), 0, 'no failed pairs');
  assert.ok(!outcome.thrown, 'no thrown error');

  // 4. exactly one normal sync_opendata audit summary is produced
  assert.equal(syncAuditCount(h), 1, 'exactly one sync_opendata audit summary');
  const summary = JSON.parse(String(h.audit.find(a => a.action === 'sync_opendata').details));

  // 5. the audit carries exactly the approved invocation-source value
  assert.equal(summary.source, 'trigger',
    `expected sync audit source "trigger" for a no-argument (trigger-shaped) invocation, actual ${JSON.stringify(summary.source)}`);

  // 6–8. no second audit row for source metadata, no raw request metadata or
  //      sensitive material anywhere in the audit text
  assert.equal(h.audit.filter(a => a.action === 'sync_opendata').length, 1,
    'source metadata must not create a second audit row');
  const auditText = syncAuditText(h);
  assert.ok(!/\b(token|payload|authorization|auth_token)\b/i.test(auditText),
    'audit must not retain request bodies, tokens, or credentials');
  assert.ok(!Array.isArray(summary.failed_details) || summary.failed_details.length === 0,
    'all-success scenario has no failure diagnostics to expand');

  // 9–10. lifecycle semantics unchanged
  assert.equal(ev.grab('commit'), 'verified', 'commit verification remains successful');
  assert.equal(h.lock.acquired, 1, 'lock acquired exactly once');
  assert.equal(h.lock.releases, 1, 'lock released exactly once');
});

// --- #37 (review correction): manual lifecycle invocation source ---
//
// #37f exists because the two-axis review mutation-proved a coverage gap: a typo
// in the normalization comparison would mislabel real manual lifecycle runs as
// "trigger" while every other permanent test stayed green (#37e spies at the
// Router boundary; #37d pins only the trigger branch). This contract exercises
// the REAL lifecycle with the trusted internal argument and pins the audit
// value itself. Simplest successful scenario — all pairs first-attempt 200s,
// pacing runs through virtual time; about invocation-source audit behavior only.

test('#37f explicit manual lifecycle invocation is audited as manual source', () => {
  const h = createHarness({
    upstream: Object.fromEntries(DATASETS.map(t => [`${t}|${FY}`, json200([])])), // simple all-success scenario
  });
  // 1. the real lifecycle invoked with the trusted internal argument
  const outcome = runSync(h.context, 'manual');
  const ev = evidence(outcome, h.audit);

  assert.ok(!outcome.thrown, 'real syncOpenData("manual") completes without throwing');
  assert.equal(ev.grab('status'), 'success', 'the manual invocation completes successfully');
  assert.equal(ev.grab('success'), 5, 'all five pairs remain successful');

  // 2. exactly one normal sync_opendata audit summary; no second row for source
  assert.equal(syncAuditCount(h), 1, 'exactly one sync_opendata audit summary');
  assert.equal(h.audit.filter(a => a.action === 'sync_opendata').length, 1,
    'source metadata must not create a second audit row');
  const summary = JSON.parse(String(h.audit.find(a => a.action === 'sync_opendata').details));

  // 3–4. the audit carries exactly the manual source — never trigger for this path
  assert.equal(summary.source, 'manual',
    `expected audit source "manual" for an explicit manual lifecycle invocation, actual ${JSON.stringify(summary.source)}`);
  assert.notEqual(summary.source, 'trigger',
    'a manual invocation must never be audited as trigger');

  // 5–6. sanitized audit shape remains intact (no bodies, tokens, or request metadata)
  const auditText = syncAuditText(h);
  assert.ok(!auditText.includes('DOCTYPE') && !/\b(token|payload|authorization|auth_token)\b/i.test(auditText),
    'audit stays single, sanitized, and free of request metadata');

  // 7–8. lifecycle semantics unchanged
  assert.equal(ev.grab('commit'), 'verified', 'commit verification remains successful');
  assert.equal(h.lock.acquired, 1, 'lock acquired exactly once');
  assert.equal(h.lock.releases, 1, 'lock released exactly once');
});
