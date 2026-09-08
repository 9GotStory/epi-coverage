const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/VaccineRules.js'), 'utf8');
const headers = ['rule_id', 'fiscal_year', 'age_group', 'view_type', 'required_fields', 'branch_alt_fields', 'logic_type', 'is_active', 'hdc_code'];
const checks = { before_birth: true, allow_on_birth: false, same_day_pairs: [{ field: 'hbv1_date', other_field: 'dtp1_date' }], ordered_pairs: [] };
const rule = { rule_id: 'a', fiscal_year: 2569, age_group: '1yr', view_type: 1, required_fields: ['hbv1_date'], branch_alt_fields: [], logic_type: 'ALL', is_active: true, hdc_code: '041', date_checks: checks };
function setup() {
  const cells = [headers.slice(), ['old', 2568, '1yr', 1, '["bcg_date"]', '[]', 'ALL', true, '010']];
  const sheet = {
    getLastRow: () => cells.length,
    getDataRange: () => ({ getValues: () => cells.map(row => Array.from({ length: cells[0].length }, (_, i) => row[i] ?? '')) }),
    getRange: (row, col, height = 1, width = 1) => ({
      setNumberFormat() { return this; },
      setValues(values) {
        assert.equal(values.length, height);
        values.forEach((value, i) => { assert.equal(value.length, width); cells[row - 1 + i] ||= []; value.forEach((v, j) => { cells[row - 1 + i][col - 1 + j] = v; }); });
        return this;
      },
      clearContent() { for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) cells[row - 1 + i][col - 1 + j] = ''; },
    }),
  };
  const context = vm.createContext({ getSpreadsheet: () => ({ getSheetByName: () => sheet }), arrayToObj: (h, r) => Object.fromEntries(h.map((k, i) => [k, r[i]])), logAction() {}, Utilities: { getUuid: () => 'uuid' } });
  vm.runInContext(source, context);
  return { context, cells };
}
test('batch save adds a column without resetting other years and reloads JSON', () => {
  const { context, cells } = setup();
  assert.equal(context.batchSaveRules(2569, '1yr', [rule], 'admin').success, true);
  assert.deepEqual(cells[1].slice(0, headers.length), ['old', 2568, '1yr', 1, '["bcg_date"]', '[]', 'ALL', true, '010']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getVaccineRules(2569, '1yr')[0].date_checks)), checks);
  assert.equal(cells[2][8], '041');
});
test('invalid and self pairs are rejected before any sheet write', () => {
  for (const pair of [{ field: 'hbv1_date', other_field: 'hbv1_date' }, { field: 'hbv1_date', other_field: 'unknown_date' }]) {
    const { context, cells } = setup();
    const before = JSON.stringify(cells);
    assert.equal(context.batchSaveRules(2569, '1yr', [{ ...rule, date_checks: { ...checks, same_day_pairs: [pair] } }], 'admin').success, false);
    assert.equal(JSON.stringify(cells), before);
  }
});
test('single save preserves existing configuration when an older client omits it', () => {
  const { context } = setup();
  assert.equal(context.saveVaccineRule(rule, 'admin').success, true);
  const { date_checks, ...legacy } = rule;
  assert.equal(context.saveVaccineRule(legacy, 'admin').success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getVaccineRules(2569, '1yr')[0].date_checks)), checks);
});
test('explicit empty lists survive save and clone', () => {
  const { context } = setup();
  const disabled = { ...checks, before_birth: false, allow_on_birth: true, same_day_pairs: [] };
  context.batchSaveRules(2569, '1yr', [{ ...rule, date_checks: disabled }], 'admin');
  assert.equal(context.cloneRulesFromYear(2569, 2570, 'admin').success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getVaccineRules(2570, '1yr')[0].date_checks)), disabled);
});
