/**
 * Issue #121 (ADR-0008) — a Vaccine Rule's optional Birth Window:
 * `born_on_or_after` (inclusive) and `born_before` (exclusive), ISO CE `yyyy-MM-dd` text.
 *
 * Seam under test: the public VaccineRules.js functions (saveVaccineRule, batchSaveRules,
 * getVaccineRules, cloneRulesFromYear, seedVaccineRules) under the vm harness, against a
 * sheet that predates the columns. Observations are what the sheet holds and what the
 * public read returns. All fixtures are synthetic.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHEETTEXT_SOURCE = fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8');
const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');
// Live-sheet shape before Issue #121: no born_* columns.
const HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'date_checks', 'updated_at', 'updated_by',
];
const TIME_ZONE = 'Asia/Bangkok';
const OTHER_YEAR_ROW = ['old', 2568, '3yr', 2, 'IPV', 'IPV เข็ม 1', 'I11', '["ipv1_date"]', 'ALL', '[]', true, true, 2, '', '', '', ''];

function setup(rows = [OTHER_YEAR_ROW]) {
  const cells = [HEADERS.slice(), ...rows.map(row => row.slice())];
  const width = () => cells[0].length;
  const sheet = {
    getLastRow: () => cells.length,
    getDataRange: () => ({ getValues: () => cells.map(row => Array.from({ length: width() }, (_, i) => row[i] ?? '')) }),
    getRange: (row, col, height = 1, w = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: w }, (_, j) => cells[row - 1 + i]?.[col - 1 + j] ?? '')),
      setNumberFormat() { return this; },
      setValues(values) { values.forEach((value, i) => { cells[row - 1 + i] ||= []; value.forEach((v, j) => { cells[row - 1 + i][col - 1 + j] = v; }); }); return this; },
    }),
  };
  let id = 0;
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: () => sheet, getSpreadsheetTimeZone: () => TIME_ZONE }),
    arrayToObj: (h, r) => Object.fromEntries(h.map((k, i) => [k, r[i]])),
    logAction() {},
    Utilities: {
      getUuid: () => `uuid-${++id}`,
      formatDate: (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(SHEETTEXT_SOURCE, context);
  vm.runInContext(RULES_SOURCE, context);
  const read = (fy, ageGroup) => JSON.parse(JSON.stringify(context.getVaccineRules(fy, ageGroup)));
  const column = name => cells[0].indexOf(name);
  return { context, cells, read, column };
}

const ipv = {
  rule_id: 'ipv1', fiscal_year: 2569, age_group: '3yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1',
  hdc_code: 'I11', required_fields: ['ipv1_date'], branch_alt_fields: [], logic_type: 'ALL',
  is_required_for_v2: true, is_active: true, target_age_months: 2,
};
const polio = {
  ...ipv, rule_id: 'polio1', vaccine_group: 'OPV', display_name: 'โปลิโอ เข็ม 1 (สูตรเดิม)', hdc_code: '', required_fields: ['opv1_date'],
};

test('rejects an invalid Birth Window as a whole with no write', () => {
  const invalid = [
    { born_on_or_after: 'next year' },
    { born_before: '2023-02-30' },
    { born_before: '01/05/2566' },
    { born_on_or_after: '2023-05-01', born_before: '2023-05-01' },
    { born_on_or_after: '2023-06-01', born_before: '2023-05-01' },
    { born_on_or_after: 20230501 },
  ];
  for (const window of invalid) {
    const single = setup();
    const before = JSON.stringify(single.cells);
    const saved = single.context.saveVaccineRule({ ...ipv, ...window }, 'admin');
    assert.equal(saved.success, false, JSON.stringify(window));
    assert.match(saved.error, /Birth Window/);
    assert.equal(JSON.stringify(single.cells), before, `single save wrote for ${JSON.stringify(window)}`);

    const batch = setup();
    const batchBefore = JSON.stringify(batch.cells);
    // a valid peer in the same batch is not written either: the whole request is rejected
    const result = batch.context.batchSaveRules(2569, '3yr', [polio, { ...ipv, ...window }], 'admin');
    assert.equal(result.success, false, JSON.stringify(window));
    assert.equal(JSON.stringify(batch.cells), batchBefore, `batch save wrote for ${JSON.stringify(window)}`);
  }
});

test('stores a valid window as text in appended columns, leaving other years untouched', () => {
  const { context, cells, read, column } = setup();
  const result = context.batchSaveRules(2569, '3yr', [
    { ...ipv, born_on_or_after: '2023-05-01', born_before: '' },
    { ...polio, born_before: '2023-05-01' },
  ], 'admin');
  assert.equal(result.success, true);

  assert.deepEqual(cells[0].slice(0, HEADERS.length), HEADERS, 'existing columns are not reordered');
  assert.ok(column('born_on_or_after') >= HEADERS.length && column('born_before') >= HEADERS.length, 'columns are appended');
  assert.deepEqual(cells[1].slice(0, HEADERS.length), OTHER_YEAR_ROW, 'other year untouched');
  const ipvRow = cells.find(row => row[0] === 'ipv1');
  assert.equal(ipvRow[column('born_on_or_after')], '2023-05-01');
  assert.equal(typeof ipvRow[column('born_on_or_after')], 'string');

  const rules = read(2569, '3yr');
  assert.deepEqual(rules.map(r => [r.rule_id, r.born_on_or_after, r.born_before]), [
    ['ipv1', '2023-05-01', ''],
    ['polio1', '', '2023-05-01'],
  ]);
  assert.equal('updated_by' in rules[0], false, 'updated_by stays excluded from the public read');
  assert.deepEqual(read(2568, '3yr').map(r => [r.born_on_or_after, r.born_before]), [['', '']]);
});

test('single save stores the window and keeps it when an older client omits it', () => {
  const { context, read } = setup();
  assert.equal(context.saveVaccineRule({ ...ipv, born_on_or_after: '2023-05-01' }, 'admin').success, true);
  assert.equal(read(2569, '3yr')[0].born_on_or_after, '2023-05-01');

  assert.equal(context.saveVaccineRule({ ...ipv, display_name: 'IPV เข็ม 1 (แก้ไข)' }, 'admin').success, true);
  assert.equal(read(2569, '3yr')[0].born_on_or_after, '2023-05-01');

  assert.equal(context.saveVaccineRule({ ...ipv, born_on_or_after: '' }, 'admin').success, true);
  assert.equal(read(2569, '3yr')[0].born_on_or_after, '', 'an explicit empty side clears the limit');
});

test('reads a Date-coerced window cell back as the same calendar day', () => {
  const { context, cells, read, column } = setup();
  context.batchSaveRules(2569, '3yr', [{ ...ipv, born_on_or_after: '2023-05-01' }], 'admin');
  // Sheets coerced the cell into midnight 1 May 2023 in the spreadsheet time zone (UTC+7):
  // a UTC conversion would read it as 2023-04-30.
  cells.find(row => row[0] === 'ipv1')[column('born_on_or_after')] = new Date('2023-04-30T17:00:00.000Z');
  assert.equal(read(2569, '3yr')[0].born_on_or_after, '2023-05-01');
});

test('a sheet that has never been saved since the change reads every rule without a window', () => {
  const { read } = setup();
  assert.deepEqual(read(2568, '3yr').map(r => [r.born_on_or_after, r.born_before]), [['', '']]);
});

test('clone copies each rule\'s Birth Window unchanged', () => {
  const { context, cells, read, column } = setup([]);
  context.batchSaveRules(2569, '3yr', [{ ...ipv, born_on_or_after: '2023-05-01' }, { ...polio, born_before: '2023-05-01' }], 'admin');
  cells.find(row => row[0] === 'polio1')[column('born_before')] = new Date('2023-04-30T17:00:00.000Z');
  assert.equal(context.cloneRulesFromYear(2569, 2570, 'admin').success, true);
  assert.deepEqual(read(2570, '3yr').map(r => [r.display_name, r.born_on_or_after, r.born_before]), [
    ['IPV เข็ม 1', '2023-05-01', ''],
    ['โปลิโอ เข็ม 1 (สูตรเดิม)', '', '2023-05-01'],
  ]);
  const cloned = cells.find(row => row[1] === 2570 && row[5] === 'โปลิโอ เข็ม 1 (สูตรเดิม)');
  assert.equal(cloned[column('born_before')], '2023-05-01', 'the clone stores ISO text, not a Date');
});

test('seed: 3yr/5yr carry the old polio regimen beside windowed IPV; 1yr/2yr have no OPV 1/2 rules', () => {
  const { context, read } = setup([]);
  assert.equal(context.seedVaccineRules(2570, 'admin').success, true);
  const polioDose = r => ['opv1_date', 'opv2_date'].includes(r.required_fields[0]);
  const ipvDose = r => ['ipv1_date', 'ipv2_date'].includes(r.required_fields[0]);

  for (const ageGroup of ['3yr', '5yr']) {
    const rules = read(2570, ageGroup).filter(r => r.view_type === 2);
    assert.deepEqual(rules.filter(polioDose).map(r => [r.display_name, r.required_fields[0], r.target_age_months, r.is_active, r.born_on_or_after, r.born_before]), [
      ['โปลิโอ เข็ม 1 (สูตรเดิม)', 'opv1_date', 2, true, '', '2023-05-01'],
      ['โปลิโอ เข็ม 2 (สูตรเดิม)', 'opv2_date', 4, true, '', '2023-05-01'],
    ], ageGroup);
    for (const rule of rules.filter(polioDose)) {
      assert.match(rule.note, /ชนิดใดก็ได้/, `${ageGroup} note explains polio dose of any type`);
      assert.match(rule.note, /2023-05-01|1 พ\.ค\. 2566/, `${ageGroup} note says when to remove the rule`);
    }
    assert.deepEqual(rules.filter(ipvDose).map(r => [r.display_name, r.born_on_or_after, r.born_before]), [
      ['IPV เข็ม 1', '2023-05-01', ''],
      ['IPV เข็ม 2', '2023-05-01', ''],
      ['IPV 4 เดือน (สูตรเดิม)', '', '2023-05-01'],
    ], ageGroup);
  }
  for (const ageGroup of ['1yr', '2yr']) {
    const rules = read(2570, ageGroup);
    assert.deepEqual(rules.filter(polioDose), [], `${ageGroup} seeds no OPV 1/2 rule`);
    assert.ok(rules.filter(ipvDose).every(r => r.born_on_or_after === '' && r.born_before === ''), `${ageGroup} IPV has no window`);
  }
});

test('the old-regimen rules keep their own metric identity, separate from IPV', () => {
  const { context, read } = setup([]);
  context.seedVaccineRules(2570, 'admin');
  const rules = read(2570, '3yr').filter(r => r.view_type === 2);
  const keyOf = name => rules.find(r => r.display_name === name).metric_key;
  assert.notEqual(keyOf('โปลิโอ เข็ม 1 (สูตรเดิม)'), keyOf('IPV เข็ม 1'));
  assert.notEqual(keyOf('โปลิโอ เข็ม 2 (สูตรเดิม)'), keyOf('IPV เข็ม 2'));
});

test('Issue #152 — seed: the Old Polio Regimen requires its single 4-month IPV in 3yr/5yr View 2', () => {
  const { context, read } = setup([]);
  context.seedVaccineRules(2570, 'admin');
  const oldRegimenIpv = r => r.display_name === 'IPV 4 เดือน (สูตรเดิม)';

  for (const [ageGroup, removeFrom] of [['3yr', '2570'], ['5yr', '2572']]) {
    const rules = read(2570, ageGroup);
    const matches = rules.filter(oldRegimenIpv);
    assert.deepEqual(matches.map(r => [
      r.view_type, r.vaccine_group, r.hdc_code, r.required_fields, r.logic_type,
      r.is_required_for_v2, r.is_active, r.target_age_months, r.born_on_or_after, r.born_before,
    ]), [[2, 'IPV', 'I12/D32/D42/D52', ['ipv2_date'], 'ALL', true, true, 4, '', '2023-05-01']], ageGroup);
    const [rule] = matches;
    assert.match(rule.note, /401/, `${ageGroup} note says HDC does not count IPV-P 401`);
    assert.match(rule.note, new RegExp(`ปีงบ ${removeFrom}`), `${ageGroup} note says when to remove the rule`);
    const ipv2 = rules.find(r => r.view_type === 2 && r.display_name === 'IPV เข็ม 2');
    assert.notEqual(rule.metric_key, ipv2.metric_key, `${ageGroup} keeps its own metric identity`);
  }
  for (const ageGroup of ['1yr', '2yr']) {
    assert.deepEqual(read(2570, ageGroup).filter(oldRegimenIpv), [], `${ageGroup} has no old-regimen IPV rule`);
  }
});
