/**
 * Issue #104 — seed defaults follow docs/features.md §3.1.
 * - 3yr View 2 JE/LAJE is one complete-series rule: (j11 AND j12) OR (je1 AND je2 AND je3);
 *   two independent BRANCH rules let a mixed j11 + je3 history pass.
 *   3yr View 1 stays the per-dose j12 | je3 rule that the verified HDC s_epi3 `je3`
 *   crosswalk (frontend hdcAnnualReference.ts) matches by shape.
 * - An explicit target_age_months in a seed rule is written as-is (it used to be
 *   replaced by the computed max of its fields).
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
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

function seed(fiscalYear) {
  const cells = [HEADERS.slice()];
  const sheet = {
    getLastRow: () => cells.length,
    getDataRange: () => ({ getValues: () => cells.map(row => HEADERS.map((_, i) => row[i] ?? '')) }),
    getRange: (row, col, height = 1, width = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[col - 1 + j] ?? '')),
      setNumberFormat() { return this; },
      setValues(values) { values.forEach((value, i) => { cells[row - 1 + i] ||= []; value.forEach((v, j) => { cells[row - 1 + i][col - 1 + j] = v; }); }); return this; },
      clearContent() { for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) if (cells[row - 1 + i]) cells[row - 1 + i][col - 1 + j] = ''; },
    }),
  };
  let id = 0;
  const context = vm.createContext({
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    arrayToObj: (h, r) => Object.fromEntries(h.map((k, i) => [k, r[i]])),
    logAction() {},
    Utilities: { getUuid: () => `uuid-${++id}` },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(SHEETTEXT_SOURCE, context);
  vm.runInContext(RULES_SOURCE, context);
  assert.equal(context.seedVaccineRules(fiscalYear, 'admin').success, true);
  return ageGroup => JSON.parse(JSON.stringify(context.getVaccineRules(fiscalYear, ageGroup)));
}

const usesJe = rule => [...rule.required_fields, ...rule.branch_alt_fields].some(f => /^(j1|je)\d_date$/.test(f));

test('3yr View 2 seeds JE/LAJE as one complete-series rule', () => {
  const je = seed(2570)('3yr').filter(r => r.view_type === 2 && usesJe(r));
  assert.equal(je.length, 1, '3yr View 2 has exactly one JE/LAJE rule');
  assert.equal(je[0].logic_type, 'BRANCH');
  assert.deepEqual(je[0].required_fields, ['j11_date', 'j12_date']);
  assert.deepEqual(je[0].branch_alt_fields, ['je1_date', 'je2_date', 'je3_date']);
  assert.equal(je[0].target_age_months, 30);
});

test('3yr View 1 keeps the per-dose rule matched by the HDC s_epi3 crosswalk', () => {
  const je = seed(2570)('3yr').filter(r => r.view_type === 1 && usesJe(r));
  assert.equal(je.length, 1);
  assert.deepEqual(je[0].required_fields, ['j12_date']);
  assert.deepEqual(je[0].branch_alt_fields, ['je3_date']);
});

test('explicit seed target_age_months is kept (LAJE/JE 1 ปี = 12, not the computed 13)', () => {
  const read = seed(2570);
  for (const [ageGroup, view] of [['2yr', 1], ['2yr', 2], ['5yr', 2]]) {
    const rule = read(ageGroup).find(r => r.view_type === view && r.display_name === 'LAJE/JE 1 ปี');
    assert.ok(rule, `${ageGroup} View ${view} has LAJE/JE 1 ปี`);
    assert.equal(rule.target_age_months, 12);
  }
});
