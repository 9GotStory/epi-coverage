/**
 * Issue #77 RED contracts — formula-injection escape on every user-influenced write path.
 *
 * Google Sheets parses a cell whose first character is =, +, - or @ as a formula
 * (Apps Script setValues/appendRow behave like the Sheets API USER_ENTERED option).
 * Before this fix `writeEpiRows` neutralized only the '=' prefix, so free-text EPI
 * fields (name, lname, addr) carrying +, - or @ passed validation and were committed
 * as live formulas, and the VaccineRules/Data write paths applied no escape at all.
 *
 * The hardened contract under test, through the real public write functions:
 *   - every string persisted by a covered write path starts with the escape
 *     apostrophe when its original text starts with =, +, - or @;
 *   - non-string cells and trigger-free strings pass through unchanged (identifiers,
 *     dates, numbers, booleans — leading zeroes intact);
 *   - escaping is idempotent: re-writing an already-escaped value never stacks a
 *     second apostrophe, and values read back from Sheets (which consumes the escape
 *     apostrophe, so getValues returns the ORIGINAL text) re-escape identically;
 *   - the vaccine_rules verified commit still reports success for escaped values —
 *     read-back parity accepts exactly the two legitimate post-write states.
 *
 * Mock-world note: harness sheets store what setValues receives, so cell assertions
 * see the ESCAPED form. The rules harness models production read semantics (Sheets
 * consumes the escape apostrophe) in getValues, which is what makes the parity
 * contract observable offline. All fixtures are synthetic.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const src = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const TRIGGERS = ['=', '+', '-', '@'];
const escape = value => "'" + value;

/* ─────────────────────────── Upload (writeEpiRows via upsertEpiData) ─────────────────────────── */

function uploadHarness() {
  const sheets = new Map();
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
          setValue(value) { cells[row - 1][column - 1] = value; return this; },
          setNumberFormat() { return this; },
          setFontWeight() { return this; }, setBackground() { return this; },
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
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
    Utilities: { formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value), getUuid: () => 'uuid', DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, data) => crypto.createHash('sha256').update(data).digest(), base64Encode: data => Buffer.from(data).toString('base64') },
  });
  for (const file of ['SheetText.js', 'Setup.js', 'Upload.js']) vm.runInContext(src(file), context);
  const read = (table = 'Epi_1_Year') => {
    const values = sheets.get(table).getDataRange().getValues();
    return values.slice(1).map(row => Object.fromEntries(values[0].map((field, index) => [field, row[index]])));
  };
  return { context, sheets, read };
}

const person = (overrides = {}) => ({ hoscode: '00588', hosname: 'ทดสอบ', pid: '0001', cid: '0000000000001', name: 'ข้อมูล', lname: 'จำลอง', birth: '2025-01-01', bcg_date: '2025-01-01', ...overrides });
const upload = (c, rows, batch, year = 2569, table = 'Epi_1_Year', options = {}) => c.upsertEpiData(rows, batch, { userId: 'u1', email: 'importer@example.test' }, year, table, options);

test('#77a imports escape every formula trigger prefix in free-text EPI fields', () => {
  for (const trigger of TRIGGERS) {
    const payload = `${trigger}HYPERLINK("http://evil.example","คลิก")`;
    const { context: c, read } = uploadHarness();
    assert.equal(upload(c, [person({ name: `${trigger}name`, lname: `${trigger}lname`, addr: payload })], `esc-${trigger.charCodeAt(0)}`).success, true,
      `import must accept a ${trigger}-prefixed free-text record (validation is unchanged)`);
    const row = read()[0];
    assert.equal(row.addr, escape(payload), `addr starting with '${trigger}' must be persisted with the escape apostrophe`);
    assert.equal(row.name, escape(`${trigger}name`), `name starting with '${trigger}' must be escaped`);
    assert.equal(row.lname, escape(`${trigger}lname`), `lname starting with '${trigger}' must be escaped`);
  }
});

test('#77b escaping is idempotent across re-imports and leaves plain data untouched', () => {
  const payload = '-2+SUM(A1:A9)+cmd';
  const { context: c, read } = uploadHarness();
  upload(c, [person({ addr: payload })], 'first');
  upload(c, [person({ addr: payload })], 'second'); // merge rewrites the same row through the sheet
  const row = read()[0];
  assert.equal(row.addr, escape(payload), 're-writing an escaped value must not stack a second apostrophe');
  assert.equal(row.cid, '0000000000001', 'identifier keeps its exact digits');
  assert.equal(row.hoscode, '00588', 'facility code keeps its leading zero');
  assert.equal(row.birth, '2025-01-01', 'dates pass through untouched');
  assert.equal(row.is_active, true, 'booleans pass through untouched');
  assert.equal(row.name, 'ข้อมูล', 'trigger-free text is stored verbatim');
});

/* ─────────────────────────── VaccineRules write paths ─────────────────────────── */

const RULES_HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

/**
 * Rules harness with PRODUCTION read semantics: Sheets consumes the escape
 * apostrophe on write, so getValues returns the pre-escape text while the stored
 * cell (what setValues received) keeps the escaped form. That divergence is what
 * the commit read-back parity must tolerate for escaped values. (Unlike the
 * dataHarness below, this reads via unescapeSheetText — trigger-scoped — because
 * rules writes carry only sanitizer escapes; the dataHarness strips any leading
 * apostrophe to also model upsertFacility's manual "'" + hoscode.)
 */
function rulesHarness({ rows = [] } = {}) {
  const cells = [RULES_HEADERS.slice(), ...rows.map(row => RULES_HEADERS.map((_, i) => row[i] ?? ''))];
  const context = vm.createContext({
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((key, i) => [key, row[i]])),
    logAction() {},
    console: { error() {}, log() {}, warn() {} },
    Utilities: { getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(src('SheetText.js'), context);
  const productionRead = value => context.unescapeSheetText(value);
  const readMatrix = () => cells.map(row => row.map(productionRead));
  const sheet = {
    getName: () => 'vaccine_rules',
    getLastRow: () => cells.length,
    getDataRange() { return { getValues: () => readMatrix() }; },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues() { return readMatrix().slice(row - 1, row - 1 + height).map(r => r.slice(column - 1, column - 1 + width)); },
        setNumberFormat() { return this; },
        setValues(values) {
          if (row >= 2) values.forEach((entry, i) => { cells[row - 1 + i] = RULES_HEADERS.map((_, j) => entry[j] ?? ''); });
          return this;
        },
      };
    },
  };
  context.getSpreadsheet = () => ({ getSheetByName: name => (name === 'vaccine_rules' ? sheet : null) });
  vm.runInContext(src('VaccineRules.js'), context);
  const rowByRuleId = ruleId => cells.find(row => row[0] === ruleId);
  const col = header => RULES_HEADERS.indexOf(header);
  return { context, cells, rowByRuleId, col };
}

const rulesRule = (overrides = {}) => ({
  rule_id: 'r-new', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV',
  display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], branch_alt_fields: [],
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0, ...overrides,
});

test('#77c saveVaccineRule escapes every trigger prefix in admin-supplied rule text', () => {
  for (const trigger of TRIGGERS) {
    const { context: c, rowByRuleId, col } = rulesHarness();
    const payload = `${trigger}HYPERLINK("http://evil.example","rule")`;
    assert.equal(c.saveVaccineRule(rulesRule({ display_name: payload, note: `${trigger}note`, vaccine_group: `${trigger}HBV` }), 'admin@example.test').success, true,
      `saving a ${trigger}-prefixed rule must succeed (validation is unchanged)`);
    const row = rowByRuleId('r-new');
    assert.equal(row[col('display_name')], escape(payload), `display_name starting with '${trigger}' must be persisted escaped`);
    assert.equal(row[col('note')], escape(`${trigger}note`), `note starting with '${trigger}' must be persisted escaped`);
    assert.equal(row[col('vaccine_group')], escape(`${trigger}HBV`), `vaccine_group starting with '${trigger}' must be persisted escaped`);
    // Production read semantics: Sheets consumes the escape, so the rule reads back as the original text.
    assert.equal(c.getVaccineRules(2569, '1yr')[0].display_name, payload);
  }
});

test('#77d batch save escapes rule text and the verified commit still reports success', () => {
  const payload = '@SUM(ImportData!A:B)+cmd';
  const { context: c, rowByRuleId, col } = rulesHarness();
  const result = c.batchSaveRules(2569, '1yr', [rulesRule({ note: payload, display_name: `=show (${payload})` })], 'admin@example.test');
  assert.equal(result.success, true, `the verified rectangle commit must not report commit_uncertain for escaped values: ${JSON.stringify(result)}`);
  const row = rowByRuleId('r-new');
  assert.equal(row[col('note')], escape(payload));
  assert.equal(row[col('display_name')], escape(`=show (${payload})`));
  assert.equal(c.getVaccineRules(2569, '1yr')[0].note, payload, 'reads back as the original text');
});

test('#77e kept rows from other years round-trip through the rectangle without double-escaping', () => {
  const keptRow = RULES_HEADERS.map(header =>
    header === 'rule_id' ? 'r-old'
      : header === 'fiscal_year' ? 2568
      : header === 'age_group' ? '1yr'
      : header === 'note' ? escape('-legacy.note')
      : '');
  const { context: c, rowByRuleId, col } = rulesHarness({ rows: [keptRow] });
  assert.equal(c.batchSaveRules(2569, '1yr', [rulesRule()], 'admin@example.test').success, true);
  const kept = rowByRuleId('r-old');
  assert.equal(kept[col('note')], escape('-legacy.note'), 'an already-escaped stored value must not gain a second apostrophe');
  assert.equal(c.getVaccineRules(2568, '1yr')[0].note, '-legacy.note', 'kept row still reads back as the original text');
});

test('#77f clone carries escaped values into the new year without double-escaping', () => {
  const payload = '+cmd|/C calc';
  const { context: c, cells, col } = rulesHarness();
  assert.equal(c.batchSaveRules(2569, '1yr', [rulesRule({ note: payload })], 'admin@example.test').success, true);
  const clone = c.cloneRulesFromYear(2569, 2570, 'admin@example.test');
  assert.equal(clone.success, true, `clone commit must verify with escaped values: ${JSON.stringify(clone)}`);
  const clonedNote = cells.slice(1).filter(row => String(row[col('fiscal_year')]) === '2570')
    .map(row => row[col('note')]);
  assert.ok(clonedNote.includes(escape(payload)), 'the cloned row persists the single-escaped note');
  assert.equal(c.getVaccineRules(2570, '1yr')[0].note, payload, 'clone reads back as the original text');
});

/* ─────────────────────────── Data.js free-text persists ─────────────────────────── */

function dataHarness() {
  const sheets = new Map();
  const context = vm.createContext({
    console, logAction() {},
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((field, index) => [field, row[index]])),
    Utilities: { formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) },
  });
  vm.runInContext(src('SheetText.js'), context);
  // Production read semantics: Sheets consumes ANY leading apostrophe as the text
  // directive on write (including upsertFacility's manual "'" + hoscode), so reads
  // return the pre-apostrophe text while the stored cell keeps the escaped form.
  const productionRead = value => typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
  function createSheet(name, initial = []) {
    const cells = initial.map(row => [...row]);
    const readMatrix = () => cells.map(row => row.map(productionRead));
    const sheet = {
      cells, getName: () => name, getLastRow: () => cells.length,
      getDataRange() { return { getValues: () => readMatrix() }; },
      getRange(row, column, height = 1, width = 1) {
        return {
          getValues() { return readMatrix().slice(row - 1, row - 1 + height).map(r => r.slice(column - 1, column - 1 + width)); },
          setValues(values) {
            values.forEach((entry, i) => {
              cells[row - 1 + i] ||= [];
              entry.forEach((value, j) => { cells[row - 1 + i][column - 1 + j] = value; });
            });
            return this;
          },
          setNumberFormat() { return this; },
        };
      },
      appendRow(values) { cells.push([...values]); return this; },
    };
    sheets.set(name, sheet);
    return sheet;
  }
  vm.runInContext(src('Data.js'), context);
  context.logAction = () => {}; // Data.js defines the real audit appender; these tests stub it out
  context.getSpreadsheet = () => ({ getSheetByName: name => sheets.get(name) || null, getSpreadsheetTimeZone: () => 'Asia/Bangkok' });
  return { context, sheets, createSheet };
}

const AI_HEADERS = ['hoscode', 'pid', 'cid', 'sex', 'birth', 'check_vhid', 'fiscal_year', 'ai_analysis', 'ai_analyzed_at'];
const AI_ROW = ['00002', '0001', '0000000000001', '1', '2025-01-01', '00123456', '2569', '', ''];
const aiKey = { hoscode: '00002', pid: '0001', cid: '0000000000001', sex: '1', birth: '2025-01-01', check_vhid: '00123456' };
const aiAuth = { userId: 'u1', role: 'user', hoscode: '00002', email: 'user@example.test' };

test('#77g saveAiAnalysis escapes every trigger prefix in the persisted analysis text', () => {
  for (const trigger of TRIGGERS) {
    const { context: c, sheets, createSheet } = dataHarness();
    createSheet('Epi_1_Year', [AI_HEADERS, AI_ROW]);
    const payload = `${trigger}IMPORTXML("http://evil.example","//x")`;
    assert.equal(c.saveAiAnalysis({ ...aiKey }, 'Epi_1_Year', payload, aiAuth).success, true,
      `saving a ${trigger}-prefixed analysis must succeed (validation is unchanged)`);
    assert.equal(sheets.get('Epi_1_Year').cells[1][AI_HEADERS.indexOf('ai_analysis')], escape(payload),
      `analysis text starting with '${trigger}' must be persisted escaped`);
  }
});

test('#77h upsertFacility escapes the admin-supplied facility name on insert and update', () => {
  const { context: c, sheets, createSheet } = dataHarness();
  createSheet('facilities', [['hoscode', 'hosname', 'is_active']]);
  assert.equal(c.upsertFacility('00001', '-evil.name', true, 'admin@example.test').success, true);
  let row = sheets.get('facilities').cells[1];
  assert.equal(row[1], escape('-evil.name'), 'inserted hosname must be persisted escaped');
  assert.equal(row[0], "'00001", 'pre-existing manual hoscode escape is preserved');
  assert.equal(c.upsertFacility('00001', '@SUM(1+1)', undefined, 'admin@example.test').success, true);
  row = sheets.get('facilities').cells[1];
  assert.equal(row[1], escape('@SUM(1+1)'), 'updated hosname must be persisted escaped');
});
