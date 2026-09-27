/**
 * Issue #26 RED contracts — backend vaccine-rule metric identity lifecycle.
 *
 * Canonical product contract: docs/specs/comparison-page-improvement.md §6
 * Decision E ("Vaccine cross-year identity is forward-only"):
 *   - `metric_key` is the canonical cross-FY logical identity; `rule_id` stays
 *     rule-instance identity;
 *   - no metric_key when absent/null/undefined/empty; valid key = non-empty string;
 *   - existing rule without a valid key: effective forward key = its rule_id;
 *   - new manual rule initializes metric_key = rule_id once; unauthorized supplied
 *     keys for new rules fail closed;
 *   - ordinary save/batch-save never silently reassign an established key;
 *   - cross-FY clone: NEW rule_id, preserved source EFFECTIVE key (absent/empty
 *     falls back to source rule_id);
 *   - seed/reset starts NEW identities (safe split, never name-matched continuity).
 *
 * Seams under test (agreed contract seams, not private implementation details):
 * the `vaccine_rules` forward schema, `getVaccineRules` effective-key read,
 * `saveVaccineRule`, `batchSaveRules`, `cloneRulesFromYear`, `seedVaccineRules`.
 * Harness follows tests/vaccine-date-checks.test.cjs (node:test + vm + synthetic
 * sheet). All data is synthetic. No evaluator/date-check/HDC semantics are changed.
 *
 * Expected today: RED — the canonical schema/read/save/clone/seed paths do not
 * implement the metric_key contract (A3/A7/A11 are allowed preservation passes:
 * generic row copy already round-trips a stored valid key).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');

/** Forward vaccine_rules schema (Decision E): today's canonical schema plus metric_key. */
const HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

/** Deterministic UUID generator so seeded/cloned identities are stable in assertions. */
function createUuidCounter() {
  let n = 0;
  return () => `uuid-${++n}`;
}

function makeRuleSheet({ rows = [] } = {}) {
  const cells = [HEADERS.slice(), ...rows.map(r => r.map(v => (v === undefined ? '' : v)))];
  return {
    cells,
    getLastRow: () => cells.length,
    getDataRange() { return { getValues: () => cells.map(row => Array.from({ length: HEADERS.length }, (_, i) => row[i] ?? '')) }; },
    getRange(row, column, height = 1, width = 1) {
      return {
        setNumberFormat() { return this; },
        setValues(values) {
          values.forEach((entry, i) => {
            entry.forEach((value, j) => { cells[row - 1 + i] ||= []; cells[row - 1 + i][column - 1 + j] = value; });
          });
          return this;
        },
        clearContent() { for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) cells[row - 1 + i][column - 1 + j] = ''; },
      };
    },
    appendRow(values) { cells.push([...values]); return this; },
    deleteRow(rowNumber) { cells.splice(rowNumber, 1); },
  };
}

/** Build one synthetic rule row array in HEADERS order from a partial object. */
function rowOf(rule) {
  return HEADERS.map(header => (rule[header] === undefined ? '' : rule[header]));
}

/** Synthetic base rule (stringified JSON fields), overridable per test. */
function baseRule(overrides = {}) {
  return rowOf({
    rule_id: 'rule-A', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031',
    required_fields: '["dtp1_date"]', logic_type: 'ALL', branch_alt_fields: '[]',
    is_required_for_v2: true, is_active: true, target_age_months: 2,
    ...overrides,
  });
}

function createHarness({ rows = [] } = {}) {
  const sheet = makeRuleSheet({ rows });
  const ss = { getSheetByName: name => (name === 'vaccine_rules' ? sheet : null) };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((key, i) => [key, row[i]])),
    logAction() {},
    Utilities: { getUuid: createUuidCounter() },
    console,
  });
  vm.runInContext(RULES_SOURCE, context);
  return { context, sheet };
}

const ruleIndex = HEADERS.indexOf('rule_id');

// --- A1 — forward schema contract ---------------------------------------------------------------

test('A1: setup schema persists metric_key on vaccine_rules', () => {
  // Behavioral setup execution would require disproportionate unrelated sheet mocking
  // (full Users/facilities/epi-schema creation), so this is the narrow source-contract
  // form explicitly allowed by the Issue #26 RED plan.
  const setupSource = fs.readFileSync(path.join(__dirname, '../src/Setup.js'), 'utf8');
  const vaccineRulesBlock = setupSource.split("'vaccine_rules'")[1]?.split(']', 1)[0] ?? '';
  assert.ok(
    vaccineRulesBlock.includes("'metric_key'"),
    'vaccine_rules static schema must persist metric_key (Decision E forward contract)'
  );
});

// --- A2/A3 — effective identity on read ----------------------------------------------------------

test('A2: legacy row with empty metric_key reads an effective forward key = rule_id (runtime identity only)', () => {
  const { context } = createHarness({ rows: [baseRule({ rule_id: 'rule-A', metric_key: '' })] });
  const rules = context.getVaccineRules(2569, '1yr');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].metric_key, 'rule-A');
});

test('A3: stored valid metric_key is read unchanged', () => {
  const { context } = createHarness({ rows: [baseRule({ rule_id: 'rule-B', metric_key: 'lineage-DTP-1' })] });
  const rules = context.getVaccineRules(2569, '1yr');
  assert.equal(rules[0].metric_key, 'lineage-DTP-1');
});

// --- A4 — new manual rule initialization ---------------------------------------------------------

test('A4: a genuinely new rule without a key initializes metric_key = rule_id; unauthorized supplied key fails closed', () => {
  const fresh = createHarness({ rows: [] });
  const newRule = {
    rule_id: 'brand-new', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'HBV', display_name: 'HBV เข็ม 1', hdc_code: '041',
    required_fields: ['hbv1_date'], branch_alt_fields: [], logic_type: 'ALL',
    is_required_for_v2: true, is_active: true, target_age_months: 0,
  };
  const ok = fresh.context.saveVaccineRule(newRule, 'admin');
  assert.equal(ok.success, true);
  const stored = fresh.context.getVaccineRules(2569, '1yr').find(r => r.rule_id === 'brand-new');
  assert.ok(stored, 'new rule must be persisted');
  assert.equal(stored.metric_key, 'brand-new');

  const hostile = createHarness({ rows: [] });
  const result = hostile.context.saveVaccineRule({ ...newRule, metric_key: 'someone-elses-lineage' }, 'admin');
  assert.equal(result.success, false, 'supplying another lineage key on a new rule must fail closed');
  assert.equal(hostile.sheet.cells.filter(row => row[ruleIndex] === 'brand-new').length, 0, 'no row may be written');
});

// --- A5 — ordinary save immutability -------------------------------------------------------------

test('A5: ordinary edit preserves an established metric_key; attempted key reassignment fails closed without partial mutation', () => {
  const harness = createHarness({
    rows: [baseRule({ rule_id: 'rule-C', metric_key: 'lineage-C', display_name: 'DTP เข็ม 1' })],
  });
  // Edit that changes only display/config fields and omits the key: allowed, key preserved.
  const allowed = harness.context.saveVaccineRule({
    rule_id: 'rule-C', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'DTP', display_name: 'DTP1 (ใหม่)', hdc_code: '031',
    required_fields: ['dtp1_date'], branch_alt_fields: [], logic_type: 'ALL',
  }, 'admin');
  assert.equal(allowed.success, true);
  let stored = harness.context.getVaccineRules(2569, '1yr').find(r => r.rule_id === 'rule-C');
  assert.equal(stored.metric_key, 'lineage-C');
  assert.equal(stored.display_name, 'DTP1 (ใหม่)');

  // Attempted ordinary reassignment of the established key: fail closed, row fully unchanged.
  const hostile = createHarness({
    rows: [baseRule({ rule_id: 'rule-C', metric_key: 'lineage-C', display_name: 'DTP เข็ม 1' })],
  });
  const before = JSON.stringify(hostile.sheet.cells);
  const rejected = hostile.context.saveVaccineRule({
    rule_id: 'rule-C', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'DTP', display_name: 'DTP1 (ใหม่)', hdc_code: '031',
    required_fields: ['dtp1_date'], branch_alt_fields: [], logic_type: 'ALL',
    metric_key: 'other-lineage',
  }, 'admin');
  assert.equal(rejected.success, false, 'established metric_key reassignment must fail closed');
  assert.equal(JSON.stringify(hostile.sheet.cells), before, 'rejected edit must not partially mutate the row');
});

// --- A6 — batch-save immutability ----------------------------------------------------------------

test('A6: batchSaveRules rejects established-key reassignment and never erases keys on older-client omission', () => {
  const hostile = createHarness({
    rows: [baseRule({ rule_id: 'rule-C', metric_key: 'lineage-C', display_name: 'DTP เข็ม 1' })],
  });
  const before = JSON.stringify(hostile.sheet.cells);
  const rejected = hostile.context.batchSaveRules(2569, '1yr', [{
    rule_id: 'rule-C', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031',
    required_fields: ['dtp1_date'], branch_alt_fields: [], logic_type: 'ALL',
    metric_key: 'other-lineage',
  }], 'admin');
  assert.equal(rejected.success, false, 'batch reassignment of an established key must fail closed');
  assert.equal(JSON.stringify(hostile.sheet.cells), before, 'rejected batch must leave the (FY, ageGroup) set unchanged');

  const legacy = createHarness({
    rows: [baseRule({ rule_id: 'rule-C', metric_key: 'lineage-C', display_name: 'DTP เข็ม 1' })],
  });
  const ok = legacy.context.batchSaveRules(2569, '1yr', [{
    rule_id: 'rule-C', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'DTP', display_name: 'DTP เข็ม 1 (แก้ไข)', hdc_code: '031',
    required_fields: ['dtp1_date'], branch_alt_fields: [], logic_type: 'ALL',
    // older client: metric_key omitted entirely
  }], 'admin');
  assert.equal(ok.success, true);
  const stored = legacy.context.getVaccineRules(2569, '1yr').find(r => r.rule_id === 'rule-C');
  assert.equal(stored.metric_key, 'lineage-C', 'omission must not erase an established key');
  assert.equal(stored.display_name, 'DTP เข็ม 1 (แก้ไข)');
});

// --- A7/A8/A9 — clone lineage --------------------------------------------------------------------

test('A7: clone with an established key creates a NEW rule_id and preserves the lineage key (and all rule semantics)', () => {
  const { context } = createHarness({
    rows: [baseRule({ rule_id: 'source-A', metric_key: 'lineage-A', fiscal_year: 2569 })],
  });
  assert.equal(context.cloneRulesFromYear(2569, 2570, 'admin').success, true);
  const cloned = context.getVaccineRules(2570, '1yr');
  assert.equal(cloned.length, 1);
  assert.notEqual(cloned[0].rule_id, 'source-A');
  assert.equal(cloned[0].metric_key, 'lineage-A');
  // A11 (boundary): identity work must not disturb rule semantics — clone stays byte-equal on config fields.
  const source = context.getVaccineRules(2569, '1yr')[0];
  for (const field of ['view_type', 'vaccine_group', 'display_name', 'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2', 'is_active', 'target_age_months']) {
    assert.deepEqual(cloned[0][field], source[field], `clone must preserve ${field}`);
  }
});

test('A8: clone with an absent/empty key falls back to the source rule_id — never persists an empty lineage', () => {
  const { context } = createHarness({
    rows: [baseRule({ rule_id: 'source-B', metric_key: '', fiscal_year: 2569 })],
  });
  assert.equal(context.cloneRulesFromYear(2569, 2570, 'admin').success, true);
  const cloned = context.getVaccineRules(2570, '1yr')[0];
  assert.notEqual(cloned.rule_id, 'source-B');
  assert.equal(cloned.metric_key, 'source-B');
});

test('A9: clone lineage is transitive — the original effective key survives a clone of a clone', () => {
  const { context } = createHarness({ rows: [baseRule({ rule_id: 'A', metric_key: '', fiscal_year: 2569 })] });
  assert.equal(context.cloneRulesFromYear(2569, 2570, 'admin').success, true);
  const second = context.getVaccineRules(2570, '1yr')[0];
  assert.equal(second.rule_id !== 'A' && second.metric_key === 'A', true, 'first clone materializes the effective key');
  assert.equal(context.cloneRulesFromYear(2570, 2571, 'admin').success, true);
  const third = context.getVaccineRules(2571, '1yr')[0];
  assert.notEqual(third.rule_id, second.rule_id);
  assert.equal(third.metric_key, 'A', 'second-generation clone must keep the original lineage key');
});

// --- A10 — seed/reset safe split -----------------------------------------------------------------

test('A10: seeded rules start NEW identities (metric_key = own rule_id); same display_name across seed years never merges lineages', () => {
  const { context } = createHarness({ rows: [] });
  assert.equal(context.seedVaccineRules(2570, 'admin').success, true);
  assert.equal(context.seedVaccineRules(2571, 'admin').success, true);
  for (const fy of [2570, 2571]) {
    const rules = context.getVaccineRules(fy, '1yr');
    assert.ok(rules.length > 0, `seed must create rules for ${fy}`);
    for (const rule of rules) {
      assert.ok(typeof rule.metric_key === 'string' && rule.metric_key.length > 0, `${fy}/${rule.display_name}: seeded key must be non-empty`);
      assert.equal(rule.metric_key, rule.rule_id, `${fy}/${rule.display_name}: seeded key must be its own new rule_id`);
    }
  }
  // Safe split: identical display_name in two seeded years must carry distinct lineage keys.
  const first = context.getVaccineRules(2570, '1yr').find(r => r.display_name === 'DTP เข็ม 1');
  const second = context.getVaccineRules(2571, '1yr').find(r => r.display_name === 'DTP เข็ม 1');
  assert.ok(first && second, 'seeded fixture must contain the shared display_name');
  assert.notEqual(first.metric_key, second.metric_key, 'force-recreated years must not recover continuity by name');
});
