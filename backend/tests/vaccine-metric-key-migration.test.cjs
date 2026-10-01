/**
 * Issue #59 RED contracts — admin-safe vaccine metric_key migration.
 *
 * The migration is deliberately narrow: vaccine_rules only. It must establish
 * forward logical identity without recomputing Dashboard_Summaries or changing
 * vaccine-rule semantics.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');
const ROUTER_SOURCE = fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8');

const LEGACY_HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'updated_at', 'updated_by', 'date_checks',
];

function row(headers, values = {}) {
  return headers.map(h => values[h] ?? '');
}

function makeSheet(headers, rows) {
  const cells = [headers.slice(), ...rows.map(r => r.slice())];
  let maxColumns = Math.max(26, headers.length);
  const snapshot = () => cells.map(r => r.slice());
  const sheet = {
    cells,
    getLastRow: () => cells.length,
    getLastColumn: () => Math.max(0, ...cells.map(r => r.length)),
    getMaxColumns: () => maxColumns,
    insertColumnsAfter(_after, count) { maxColumns += count; },
    getDataRange() {
      return {
        getValues: () => cells.map(r => Array.from({ length: sheet.getLastColumn() }, (_, i) => r[i] ?? '')),
      };
    },
    getRange(r, c, h = 1, w = 1) {
      return {
        setValues(values) {
          assert.equal(values.length, h);
          values.forEach((entry, i) => {
            assert.equal(entry.length, w);
            cells[r - 1 + i] ||= [];
            entry.forEach((value, j) => { cells[r - 1 + i][c - 1 + j] = value; });
          });
          return this;
        },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setNumberFormat() { return this; },
      };
    },
  };
  return { sheet, snapshot };
}

function createRulesHarness(headers = LEGACY_HEADERS, rows = []) {
  const { sheet, snapshot } = makeSheet(headers, rows);
  const audit = [];
  const ss = { getSheetByName: name => name === 'vaccine_rules' ? sheet : null };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    arrayToObj: (hs, r) => Object.fromEntries(hs.map((h, i) => [h, r[i]])),
    logAction: (...args) => audit.push(args),
    Utilities: { getUuid: () => 'unused-uuid' },
    console,
  });
  vm.runInContext(RULES_SOURCE, context);
  return { context, sheet, snapshot, audit };
}

function basicRule(id, overrides = {}, headers = LEGACY_HEADERS) {
  return row(headers, {
    rule_id: id,
    fiscal_year: 2569,
    age_group: '1yr',
    view_type: 1,
    vaccine_group: 'DTP',
    display_name: 'DTP ' + id,
    required_fields: '["dtp1_date"]',
    logic_type: 'ALL',
    branch_alt_fields: '[]',
    is_required_for_v2: true,
    is_active: true,
    target_age_months: 2,
    updated_at: '2026-09-10',
    updated_by: 'before-migration',
    date_checks: '{}',
    ...overrides,
  });
}

test('M1 legacy sheet appends metric_key once and initializes each existing row from its rule_id without changing A:Q', () => {
  const rows = [basicRule('rule-A'), basicRule('rule-B')];
  const { context, sheet, snapshot, audit } = createRulesHarness(LEGACY_HEADERS, rows);
  const before = snapshot();

  assert.equal(typeof context.migrateVaccineMetricKeys, 'function', 'migration helper must exist');
  const result = context.migrateVaccineMetricKeys('admin@example.invalid');

  assert.equal(result.success, true);
  assert.equal(result.createdColumn, true);
  assert.equal(result.initialized, 2);
  assert.equal(result.preserved, 0);
  assert.equal(result.total, 2);
  assert.equal(sheet.cells[0][17], 'metric_key');
  assert.equal(sheet.cells[1][17], 'rule-A');
  assert.equal(sheet.cells[2][17], 'rule-B');
  for (let r = 0; r < before.length; r++) {
    assert.deepEqual(sheet.cells[r].slice(0, 17), before[r].slice(0, 17), 'existing A:Q cells must stay byte-equivalent');
  }
  assert.equal(audit.length, 1, 'successful migration writes one audit event');
});

test('M2 migration is idempotent and preserves established non-empty keys', () => {
  const headers = [...LEGACY_HEADERS, 'metric_key'];
  const rows = [
    basicRule('rule-A', { metric_key: 'lineage-A' }, headers),
    basicRule('rule-B', { metric_key: '' }, headers),
  ];
  const { context, sheet, snapshot } = createRulesHarness(headers, rows);

  const first = context.migrateVaccineMetricKeys('admin@example.invalid');
  assert.equal(first.success, true);
  assert.equal(first.createdColumn, false);
  assert.equal(first.initialized, 1);
  assert.equal(first.preserved, 1);
  assert.equal(sheet.cells[1][17], 'lineage-A');
  assert.equal(sheet.cells[2][17], 'rule-B');

  const afterFirst = snapshot();
  const second = context.migrateVaccineMetricKeys('admin@example.invalid');
  assert.equal(second.success, true);
  assert.equal(second.createdColumn, false);
  assert.equal(second.initialized, 0);
  assert.equal(second.preserved, 2);
  assert.deepEqual(snapshot(), afterFirst, 'idempotent rerun must cause no key churn or duplicate column');
});

test('M3 duplicate required header fails closed before any mutation', () => {
  const headers = [...LEGACY_HEADERS, 'rule_id'];
  const rows = [basicRule('rule-A', {}, headers)];
  const { context, snapshot } = createRulesHarness(headers, rows);
  const before = snapshot();
  const result = context.migrateVaccineMetricKeys('admin@example.invalid');
  assert.equal(result.success, false);
  assert.deepEqual(snapshot(), before);
});

test('M4 duplicate/non-empty rule_id fails closed before any mutation', () => {
  const rows = [basicRule('same'), basicRule('same')];
  const { context, snapshot } = createRulesHarness(LEGACY_HEADERS, rows);
  const before = snapshot();
  const result = context.migrateVaccineMetricKeys('admin@example.invalid');
  assert.equal(result.success, false);
  assert.deepEqual(snapshot(), before);
});

test('M5 duplicate resolved key in same FY + age_group + view_type fails closed, but same lineage across FYs is allowed', () => {
  const headers = [...LEGACY_HEADERS, 'metric_key'];

  const badRows = [
    basicRule('rule-A', { metric_key: 'same-lineage' }, headers),
    basicRule('rule-B', { metric_key: 'same-lineage' }, headers),
  ];
  const bad = createRulesHarness(headers, badRows);
  const badBefore = bad.snapshot();
  assert.equal(bad.context.migrateVaccineMetricKeys('admin@example.invalid').success, false);
  assert.deepEqual(bad.snapshot(), badBefore);

  const goodRows = [
    basicRule('rule-A', { metric_key: 'same-lineage', fiscal_year: 2569 }, headers),
    basicRule('rule-B', { metric_key: 'same-lineage', fiscal_year: 2570 }, headers),
  ];
  const good = createRulesHarness(headers, goodRows);
  const ok = good.context.migrateVaccineMetricKeys('admin@example.invalid');
  assert.equal(ok.success, true);
  assert.equal(ok.initialized, 0);
  assert.equal(ok.preserved, 2);
});

function routerHarness(role = 'admin') {
  const calls = [];
  const context = vm.createContext({
    console: { error() {}, log() {} },
    validateTokenAndGetRole: () => ({ valid: true, role, email: 'server-admin@example.invalid' }),
    migrateVaccineMetricKeys: (...args) => {
      calls.push(args);
      return { success: true, marker: 'migration-called' };
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => ({ text, setMimeType(mimeType) { return { text, mimeType }; } }),
    },
  });
  vm.runInContext(ROUTER_SOURCE, context);
  return { context, calls };
}

function postEvent(body = {}) {
  return {
    parameter: { action: 'migrateVaccineMetricKeys', auth_token: 'synthetic-token' },
    postData: { contents: JSON.stringify({ action: 'migrateVaccineMetricKeys', adminEmail: 'client-spoof@example.invalid', ...body }) },
  };
}

test('M6 Router exposes migration only to admin roles and passes server-derived actor email', () => {
  const admin = routerHarness('admin');
  const response = JSON.parse(admin.context.doPost(postEvent()).text);
  assert.equal(response.status, 200);
  assert.equal(response.data.marker, 'migration-called');
  assert.deepEqual(admin.calls, [['server-admin@example.invalid']],
    'client-supplied adminEmail must never become the audit actor');

  const user = routerHarness('user');
  const denied = JSON.parse(user.context.doPost(postEvent()).text);
  assert.equal(denied.status, 403);
  assert.equal(user.calls.length, 0);
});
