/**
 * Issue #148 — adding and deleting a Vaccine Rule through Batch Save, and structural rule
 * validation on every write path.
 *
 * Seam under test: the public VaccineRules.js functions `batchSaveRules` and `saveVaccineRule`
 * under the vm sheet harness. Observations are what the sheet holds, what is rejected with
 * the sheet untouched, and what the audit log says. All fixtures are synthetic: no real
 * health data, CID, facility identifiers or secrets.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHEETTEXT_SOURCE = fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8');
const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');
const HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'born_on_or_after', 'born_before',
  'updated_at', 'updated_by',
];

const storedRow = ({ rule_id, fiscal_year = 2569, age_group = '1yr', view_type = 1, vaccine_group = 'HBV', display_name,
  required_fields = ['hbv1_date'], logic_type = 'ALL', branch_alt_fields = [], target_age_months = 0, metric_key = '' }) =>
  [rule_id, fiscal_year, age_group, view_type, vaccine_group, display_name, '', JSON.stringify(required_fields), logic_type,
    JSON.stringify(branch_alt_fields), true, true, target_age_months, '', metric_key, '', '', '', '', ''];

const STORED = [
  storedRow({ rule_id: 'hbv1', display_name: 'HBV เข็ม 1', metric_key: 'hbv1-lineage' }),
  storedRow({ rule_id: 'bcg', vaccine_group: 'BCG', display_name: 'BCG', required_fields: ['bcg_date'], metric_key: 'bcg-lineage' }),
  storedRow({ rule_id: 'old-opv', vaccine_group: 'OPV', display_name: 'OPV เข็ม 1 (สูตรเดิม)', required_fields: ['opv1_date'], target_age_months: 2 }),
  storedRow({ rule_id: 'other-age', age_group: '2yr', display_name: 'HBV เข็ม 1' }),
  storedRow({ rule_id: 'other-year', fiscal_year: 2568, display_name: 'HBV เข็ม 1' }),
];

function setup(rows = STORED) {
  const cells = [HEADERS.slice(), ...rows.map(row => row.slice())];
  const audit = [];
  const writes = { count: 0 };
  const sheet = {
    getLastRow: () => cells.length,
    getDataRange: () => ({ getValues: () => cells.map(row => Array.from({ length: cells[0].length }, (_, i) => row[i] ?? '')) }),
    getRange: (row, col, height = 1, width = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[col - 1 + j] ?? '')),
      setNumberFormat() { return this; },
      setValues(values) {
        writes.count++;
        values.forEach((value, i) => { cells[row - 1 + i] ||= []; value.forEach((v, j) => { cells[row - 1 + i][col - 1 + j] = v; }); });
        return this;
      },
    }),
  };
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: () => sheet, getSpreadsheetTimeZone: () => 'Asia/Bangkok' }),
    arrayToObj: (h, r) => Object.fromEntries(h.map((k, i) => [k, r[i]])),
    logAction: (userId, email, action, details) => audit.push({ action, details }),
    Utilities: { getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(SHEETTEXT_SOURCE, context);
  vm.runInContext(RULES_SOURCE, context);
  const read = (fy = 2569, ageGroup = '1yr') => JSON.parse(JSON.stringify(context.getVaccineRules(fy, ageGroup)));
  const snapshot = () => JSON.stringify(cells);
  return { context, cells, audit, writes, read, snapshot };
}

const newRule = (overrides = {}) => ({
  rule_id: '4f1c2d3e-0000-4000-8000-000000000001', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'MMR',
  display_name: 'MMR เข็ม 1', hdc_code: '073', required_fields: ['mmr1_date'], branch_alt_fields: [], logic_type: 'ALL',
  is_required_for_v2: true, is_active: true, target_age_months: 9,
  date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] }, ...overrides,
});

test('an addition is inserted with metric_key = rule_id and leaves other fiscal years and age groups untouched', () => {
  const h = setup();
  const otherRows = () => JSON.stringify(h.cells.filter(row => row[0] === 'other-age' || row[0] === 'other-year'));
  const before = otherRows();
  const result = h.context.batchSaveRules(2569, '1yr', [...h.read(), newRule()], 'admin', []);
  assert.equal(result.success, true, result.error);
  const added = h.read().find(r => r.rule_id === newRule().rule_id);
  assert.equal(added.metric_key, newRule().rule_id, 'a new rule starts its own cross-year identity');
  assert.equal(added.display_name, 'MMR เข็ม 1');
  assert.equal(h.read().length, 4);
  assert.equal(otherRows(), before);
});

test('a listed deletion removes the rule, and the remaining rules keep their established metric_key', () => {
  const h = setup();
  const kept = h.read().filter(r => r.rule_id !== 'old-opv');
  const result = h.context.batchSaveRules(2569, '1yr', kept, 'admin', ['old-opv']);
  assert.equal(result.success, true, result.error);
  const after = h.read();
  assert.deepEqual(after.map(r => r.rule_id).sort(), ['bcg', 'hbv1']);
  assert.equal(after.find(r => r.rule_id === 'hbv1').metric_key, 'hbv1-lineage');
  assert.equal(after.find(r => r.rule_id === 'bcg').metric_key, 'bcg-lineage');
  assert.equal(h.read(2569, '2yr').length, 1, 'the same rule name in another age group stays');
  assert.equal(h.read(2568, '1yr').length, 1, 'the same rule name in another fiscal year stays');
});

test('a stored rule omitted from the request without being named for deletion is rejected, with no write', () => {
  const h = setup();
  const before = h.snapshot();
  const result = h.context.batchSaveRules(2569, '1yr', h.read().filter(r => r.rule_id !== 'old-opv'), 'admin');
  assert.equal(result.success, false);
  assert.match(result.error, /old-opv/);
  assert.equal(h.snapshot(), before);
  assert.equal(h.writes.count, 0);
});

test('a deleted_rule_ids entry that is not a stored rule of that fiscal year and age group is rejected, with no write', () => {
  for (const unknown of ['no-such-rule', 'other-age', 'other-year']) {
    const h = setup();
    const before = h.snapshot();
    const result = h.context.batchSaveRules(2569, '1yr', h.read(), 'admin', [unknown]);
    assert.equal(result.success, false, unknown);
    assert.match(result.error, new RegExp(unknown));
    assert.equal(h.snapshot(), before);
  }
});

test('an id that is both incoming and deleted is rejected, with no write', () => {
  const h = setup();
  const before = h.snapshot();
  const result = h.context.batchSaveRules(2569, '1yr', h.read(), 'admin', ['bcg']);
  assert.equal(result.success, false);
  assert.match(result.error, /bcg/);
  assert.equal(h.snapshot(), before);
});

test('a request that repeats a rule_id is rejected, with no write', () => {
  const h = setup();
  const before = h.snapshot();
  const rules = h.read();
  const result = h.context.batchSaveRules(2569, '1yr', [...rules, { ...rules[0], display_name: 'ชื่ออื่น' }], 'admin', []);
  assert.equal(result.success, false);
  assert.match(result.error, /hbv1/);
  assert.equal(h.snapshot(), before);
});

test('deleting every rule of the age group is rejected, with no write', () => {
  const h = setup();
  const before = h.snapshot();
  const result = h.context.batchSaveRules(2569, '1yr', [], 'admin', ['hbv1', 'bcg', 'old-opv']);
  assert.equal(result.success, false);
  assert.match(result.error, /no rules/);
  assert.equal(h.snapshot(), before);
});

test('deleted_rule_ids that is not an array of rule ids is rejected, with no write', () => {
  for (const malformed of ['old-opv', [42], [null], {}]) {
    const h = setup();
    const before = h.snapshot();
    const result = h.context.batchSaveRules(2569, '1yr', h.read().filter(r => r.rule_id !== 'old-opv'), 'admin', malformed);
    assert.equal(result.success, false, JSON.stringify(malformed));
    assert.match(result.error, /deleted_rule_ids/);
    assert.equal(h.snapshot(), before);
  }
});

// Each case breaks one structural rule; the error must name the rule.
const STRUCTURAL_VIOLATIONS = [
  ['empty display_name', { display_name: '   ' }],
  ['missing display_name', { display_name: undefined }],
  ['empty vaccine_group', { vaccine_group: '' }],
  ['view_type other than 1 or 2', { view_type: 3 }],
  ['view_type as text', { view_type: '1' }],
  ['unknown logic_type', { logic_type: 'SOME' }],
  ['no required_fields', { required_fields: [] }],
  ['required_fields not an array', { required_fields: 'mmr1_date' }],
  ['malformed column name', { required_fields: ['MMR1_date'] }],
  ['column name without _date', { required_fields: ['mmr1'] }],
  ['column name with a formula', { required_fields: ['=mmr1_date'] }],
  ['BRANCH without alternative columns', { logic_type: 'BRANCH', branch_alt_fields: [] }],
  ['malformed alternative column name', { logic_type: 'BRANCH', branch_alt_fields: ['mmr 2_date'] }],
  ['negative target age', { target_age_months: -1 }],
  ['fractional target age', { target_age_months: 2.5 }],
  ['target age as text', { target_age_months: '9' }],
];

test('batchSaveRules rejects each structural violation, with no write and an error naming the rule', () => {
  for (const [label, overrides] of STRUCTURAL_VIOLATIONS) {
    const h = setup();
    const before = h.snapshot();
    const result = h.context.batchSaveRules(2569, '1yr', [...h.read(), newRule(overrides)], 'admin', []);
    assert.equal(result.success, false, label);
    assert.match(result.error, new RegExp(newRule().rule_id), label);
    assert.equal(h.snapshot(), before, label);
  }
});

test('saveVaccineRule applies the same structural validation, with no write', () => {
  for (const [label, overrides] of STRUCTURAL_VIOLATIONS) {
    const h = setup();
    const before = h.snapshot();
    const result = h.context.saveVaccineRule(newRule(overrides), 'admin');
    assert.equal(result.success, false, label);
    assert.match(result.error, new RegExp(newRule().rule_id), label);
    assert.equal(h.snapshot(), before, label);
  }
});

test('a rule without a target age, or with target age 0, is structurally valid', () => {
  for (const target_age_months of [undefined, null, '', 0]) {
    const h = setup();
    const result = h.context.batchSaveRules(2569, '1yr', [...h.read(), newRule({ target_age_months })], 'admin', []);
    assert.equal(result.success, true, `${JSON.stringify(target_age_months)}: ${result.error}`);
    assert.equal(h.context.saveVaccineRule(newRule({ rule_id: 'single', display_name: 'อื่น', target_age_months }), 'admin').success, true);
  }
});

test('a pre-existing malformed stored rule blocks the batch, with an error naming that rule', () => {
  const h = setup([...STORED, storedRow({ rule_id: 'broken', vaccine_group: '', display_name: 'กฎเสีย' })]);
  const before = h.snapshot();
  const rules = h.read().map(r => (r.rule_id === 'bcg' ? { ...r, note: 'แก้หมายเหตุ' } : r));
  const result = h.context.batchSaveRules(2569, '1yr', rules, 'admin', []);
  assert.equal(result.success, false);
  assert.match(result.error, /broken/);
  assert.equal(h.snapshot(), before);
  // Deleting the malformed rule is the way out.
  const fixed = h.context.batchSaveRules(2569, '1yr', rules.filter(r => r.rule_id !== 'broken'), 'admin', ['broken']);
  assert.equal(fixed.success, true, fixed.error);
});

test('the audit entry lists the added and deleted rule ids and names, and no personal data', () => {
  const h = setup();
  const rules = [...h.read().filter(r => r.rule_id !== 'old-opv'), newRule()];
  assert.equal(h.context.batchSaveRules(2569, '1yr', rules, 'admin@example.test', ['old-opv']).success, true);
  const entry = h.audit.find(e => e.action === 'batch_save_rules');
  assert.ok(entry);
  assert.match(entry.details, /fiscal_year=2569/);
  assert.match(entry.details, /age_group=1yr/);
  assert.match(entry.details, /Batch saved 3 rules/);
  const added = /added=(\[.*?\])/.exec(entry.details);
  const deleted = /deleted=(\[.*?\])/.exec(entry.details);
  assert.deepEqual(JSON.parse(added[1]), [{ rule_id: newRule().rule_id, display_name: 'MMR เข็ม 1' }]);
  assert.deepEqual(JSON.parse(deleted[1]), [{ rule_id: 'old-opv', display_name: 'OPV เข็ม 1 (สูตรเดิม)' }]);
});

test('an older-style request (no deleted_rule_ids, full rule set) still saves', () => {
  const h = setup();
  const rules = h.read().map(r => (r.rule_id === 'hbv1' ? { ...r, note: 'แก้ไข' } : r));
  const result = h.context.batchSaveRules(2569, '1yr', rules, 'admin');
  assert.equal(result.success, true, result.error);
  assert.equal(h.read().find(r => r.rule_id === 'hbv1').note, 'แก้ไข');
  assert.equal(h.read().length, 3);
});

test('every seeded rule set passes structural validation when saved back unchanged', () => {
  const h = setup([]);
  assert.equal(h.context.seedVaccineRules(2569, 'admin').success, true);
  for (const ageGroup of ['1yr', '2yr', '3yr', '5yr']) {
    const result = h.context.batchSaveRules(2569, ageGroup, h.read(2569, ageGroup), 'admin');
    assert.equal(result.success, true, `${ageGroup}: ${result.error}`);
  }
});
