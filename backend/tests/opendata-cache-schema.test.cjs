/**
 * Issue #15 (Ticket B) RED contracts — authoritative opendata_cache schema and
 * header-aware access.
 *
 * Seams under test (agreed in the issue, not prescribed by these tests):
 *   1. `ensureOpenDataCacheSchema(sheet)` — the smallest GAS-global helper the
 *      future implementation exposes for the ONE authoritative schema contract.
 *      Observable contract: on a valid sheet it reports ok with a header-name →
 *      zero-based-index mapping for every required column and performs only
 *      additive, non-destructive repair (append missing required columns at the
 *      end in required order; never reorder; never fabricate historical
 *      metadata); on duplicate/ambiguous required headers it fails closed
 *      without mutating the sheet.
 *   2. The existing `getCachedOpenData(tableName, year, hospcode)` read path —
 *      semantic access must be header-name based, and a missing/ambiguous
 *      required schema must fail closed rather than report a false successful
 *      (possibly empty) cache read.
 *   3. `setupDatabase()` — must ensure `opendata_cache` from the same
 *      authoritative contract (idempotent, append-only, no reorder).
 *
 * All data is synthetic aggregate OpenData material. No production URLs, Sheet
 * IDs, secrets, Script Properties, or person-level data appear in this file.
 * Ticket #16 boundary: nothing here asks for sync lifecycle changes — only the
 * schema/header helper that #16 will later consume.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Required symbolic columns — contract expectation mirrored from Issue #15;
// production will own the single authoritative definition.
const REQUIRED_COLUMNS = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json', 'updated_at'];
const HELPER_MISSING = 'authoritative OpenData cache schema helper is not implemented (Issue #15)';

function createHarness({ sheets: initialSheets = [] } = {}) {
  const sheets = new Map();
  function createSheet(name, initial = []) {
    const cells = initial.map(row => [...row]);
    let maxRows = Math.max(2, cells.length), maxColumns = Math.max(10, ...cells.map(row => row.length), 1);
    const sheet = {
      cells, getName: () => name,
      getLastRow: () => cells.length,
      getLastColumn: () => Math.max(0, ...cells.map(row => row.length)),
      getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
      insertColumnsAfter(_, count) { maxColumns += count; },
      insertRowsAfter(_, count) { maxRows += count; },
      setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {},
      getDataRange() { return this.getRange(1, 1, Math.max(1, cells.length), Math.max(1, this.getLastColumn())); },
      getRange(row, column, height = 1, width = 1) {
        assert.ok(column + width - 1 <= maxColumns, 'test harness: expand columns before writing');
        assert.ok(row + height - 1 <= maxRows, 'test harness: expand rows before writing');
        return {
          getValues: () => Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? '')),
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
          setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
        };
      },
      appendRow(values) { cells.push([...values]); return this; },
      deleteRow(n) { cells.splice(n - 1, 1); return this; },
    };
    sheets.set(name, sheet);
    return sheet;
  }
  for (const [name, rows] of initialSheets) createSheet(name, rows);
  const ss = {
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    insertSheet: name => createSheet(name),
  };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    console, logAction() {},
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    Utilities: { getUuid: () => 'uuid', formatDate: value => value.toISOString() },
    SpreadsheetApp: { flush() {} },
    UrlFetchApp: { fetch: () => { throw new Error('test harness: upstream must not be reached in schema tests'); } },
  });
  for (const file of ['OpenData.js', 'Setup.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  return { context, sheets, createSheet };
}

// --- Group A (#12): authoritative header mapping accepts canonical order ---

test('#12 schema helper accepts canonical order, keeps it unchanged, and maps every required column semantically', () => {
  const { context: c, createSheet } = createHarness();
  createSheet('opendata_cache', [[...REQUIRED_COLUMNS], ['uuid-1', 's_epi1', '2569', '00001', '540601', '{}', '2026-09-12T00:00:00Z']]);
  assert.equal(typeof c.ensureOpenDataCacheSchema, 'function', HELPER_MISSING);
  const result = c.ensureOpenDataCacheSchema(c.getSpreadsheet().getSheetByName('opendata_cache'));
  assert.equal(result.ok, true, 'canonical order must be accepted');
  for (const [index, column] of REQUIRED_COLUMNS.entries()) {
    assert.equal(result.columns[column], index, `semantic lookup for '${column}' must resolve to its actual position`);
  }
  const sheet = c.getSpreadsheet().getSheetByName('opendata_cache');
  assert.deepEqual(sheet.cells[0], [...REQUIRED_COLUMNS], 'canonical header must not be rewritten or reordered');
});

// --- Group B (#13): additive legacy self-heal without historical fabrication ---

test('#13 legacy sheet missing metadata columns is healed additively with NO fabricated history', () => {
  const { context: c, createSheet } = createHarness();
  const legacyHeader = ['table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json'];
  const legacyRow = ['s_epi1', '2569', '00001', '540601', '{"areacode":"540601"}'];
  createSheet('opendata_cache', [[...legacyHeader], [...legacyRow]]);
  assert.equal(typeof c.ensureOpenDataCacheSchema, 'function', HELPER_MISSING);
  const result = c.ensureOpenDataCacheSchema(c.getSpreadsheet().getSheetByName('opendata_cache'));
  assert.equal(result.ok, true, 'legacy sheet with only missing (not ambiguous) columns must be repairable');
  const sheet = c.getSpreadsheet().getSheetByName('opendata_cache');
  // Additive append only: existing positions preserved, sync_id/updated_at appended in required order.
  assert.deepEqual(sheet.cells[0], [...legacyHeader, 'sync_id', 'updated_at'],
    'missing columns must be appended at the end in required-schema order without reordering');
  // Existing cells preserved byte-for-byte.
  assert.deepEqual(sheet.cells[1].slice(0, 5), legacyRow, 'existing historical cells must be preserved');
  // No fabricated historical metadata: the newly appended cells stay blank.
  // (Harness representation: an untouched mock cell is `undefined`; a blank sheet cell reads back as ''.
  //  Both mean blank — production must never write a value there.)
  assert.equal(sheet.cells[1][5] ?? '', '', 'historical rows must NOT receive a fabricated sync_id');
  assert.equal(sheet.cells[1][6] ?? '', '', 'historical rows must NOT receive a fabricated updated_at');
  // Semantic mapping reflects the actual (noncanonical) sheet layout.
  assert.equal(result.columns.table_name, 0);
  assert.equal(result.columns.sync_id, 5);
  assert.equal(result.columns.updated_at, 6);
});

// --- Group C (#14): noncanonical order stays readable through the existing read path ---

test('#14 compatibility guard: getCachedOpenData reads a noncanonical column order by header name', () => {
  const { context: c, createSheet } = createHarness();
  const header = ['raw_json', 'hospcode', 'table_name', 'updated_at', 'fiscal_year', 'areacode', 'sync_id'];
  createSheet('opendata_cache', [
    [...header],
    ['{"areacode":"540601"}', '00001', 's_epi1', '2026-09-12T00:00:00Z', '2569', '540601', 'uuid-1'], // matching
    ['{"areacode":"540602"}', '00002', 's_epi2', '2026-09-12T00:00:00Z', '2569', '540602', 'uuid-2'], // nonmatching dataset
  ]);
  const result = c.getCachedOpenData('s_epi1', '2569', 'all');
  assert.equal(result.statusCode, 200);
  assert.equal(result.isFromCache, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), [{ areacode: '540601' }],
    'selection must be by header names (table_name/fiscal_year), not numeric positions');
  const sheet = c.getSpreadsheet().getSheetByName('opendata_cache');
  assert.deepEqual(sheet.cells[0], [...header], 'reading must not reorder or rewrite the header');
});

// --- Group D: fail closed on ambiguous/missing required headers ---

test('duplicate required header: schema helper fails closed without mutating the sheet', () => {
  const { context: c, createSheet } = createHarness();
  const ambiguousHeader = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'raw_json', 'raw_json', 'updated_at'];
  createSheet('opendata_cache', [[...ambiguousHeader], ['uuid-1', 's_epi1', '2569', '00001', '{}', '{}', '2026-09-12T00:00:00Z']]);
  assert.equal(typeof c.ensureOpenDataCacheSchema, 'function', HELPER_MISSING);
  const result = c.ensureOpenDataCacheSchema(c.getSpreadsheet().getSheetByName('opendata_cache'));
  assert.notEqual(result && result.ok, true, 'duplicate required headers must fail closed, never silently pick one');
  const sheet = c.getSpreadsheet().getSheetByName('opendata_cache');
  assert.deepEqual(sheet.cells[0], [...ambiguousHeader], 'ambiguity must not be hidden by sheet mutation');
});

test('duplicate required header: getCachedOpenData must not return successful records from an ambiguous schema', () => {
  const { context: c, createSheet } = createHarness();
  const ambiguousHeader = ['raw_json', 'hospcode', 'table_name', 'updated_at', 'fiscal_year', 'areacode', 'raw_json'];
  createSheet('opendata_cache', [
    [...ambiguousHeader],
    ['{"areacode":"540601"}', '00001', 's_epi1', '2026-09-12T00:00:00Z', '2569', '540601', '{"areacode":"SHOULD-NOT-WIN"}'],
  ]);
  const result = c.getCachedOpenData('s_epi1', '2569', 'all');
  assert.ok(!Array.isArray(result.data) || result.data.length === 0 || result.error,
    'an ambiguous required schema must fail closed, not silently return records from the first duplicate column');
});

test('missing required column: getCachedOpenData must not report a false successful empty cache', () => {
  const { context: c, createSheet } = createHarness();
  // raw_json absent entirely — a read path that cannot be satisfied by this sheet.
  createSheet('opendata_cache', [
    ['table_name', 'fiscal_year', 'hospcode', 'areacode'],
    ['s_epi1', '2569', '00001', '540601'],
  ]);
  const result = c.getCachedOpenData('s_epi1', '2569', 'all');
  assert.ok(!(result.statusCode === 200 && Array.isArray(result.data)),
    'a schema lacking a required column must fail closed, not return a successful empty dataset');
});

// --- Group E: setupDatabase shares the authoritative schema contract ---

test('setupDatabase ensures opendata_cache from the shared schema contract, idempotently and append-only', () => {
  const { context: c, sheets } = createHarness();
  c.setupDatabase();
  const cache = sheets.get('opendata_cache');
  assert.ok(cache, 'setupDatabase must ensure the opendata_cache sheet exists (shared schema ownership)');
  assert.deepEqual(cache.cells[0], [...REQUIRED_COLUMNS], 'headers must come from the authoritative contract');
  const headerBefore = [...cache.cells[0]];
  c.setupDatabase(); // idempotent rerun
  assert.deepEqual(cache.cells[0], headerBefore, 'rerunning setup must not duplicate or reorder columns');
});

test('setupDatabase fails closed on a duplicate required opendata_cache header instead of reporting success', () => {
  const { context: c, createSheet } = createHarness();
  const ambiguousHeader = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'raw_json', 'raw_json', 'updated_at'];
  const sheet = createSheet('opendata_cache', [[...ambiguousHeader]]);
  const result = c.setupDatabase();
  assert.equal(result.success, false, 'setup over an ambiguous OpenData cache schema must not report success');
  assert.ok(String(result.error || '').includes('opendata_cache'), 'failure must carry a safe schema error indication');
  assert.deepEqual(sheet.cells[0], [...ambiguousHeader], 'duplicate header must not be auto-deduplicated or destructively mutated');
});
