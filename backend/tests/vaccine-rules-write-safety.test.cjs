/**
 * Issue #76 RED contracts — transaction-safe vaccine_rules writes.
 *
 * Before this fix every rules mutation was a lock-free whole-sheet read-modify-write:
 * `batchSaveRules` CLEARED the entire data region then rewrote it (a transient failure
 * in that window emptied every year's rules), `seedVaccineRules(force)` deleted rows
 * one by one before appending, and concurrent saves silently erased each other.
 *
 * The hardened contract under test, through the real public functions:
 *   - every mutation holds the bounded script lock across read→decide→commit and
 *     releases exactly once (finally), including on failure;
 *   - commits are ONE padded rectangular setValues — zero clearContent, zero deleteRow —
 *     with a shrinking ruleset's stale tail blanked by the same write;
 *   - honest commit states: format-throw → commit_failure (values provably unwritten);
 *     any write/flush/read-back failure or a genuine read-back mismatch →
 *     commit_uncertain, never a success claim;
 *   - lock contention → rules_busy with zero mutation.
 *
 * All fixtures are synthetic; no real rules, accounts, or person data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');
const HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

function createHarness({
  failOnNumberFormat = false,
  failOnWriteBeforeMutation = false,
  failOnWriteAfterMutation = false,
  failOnFlush = false,
  tamperReadback = null, // { row, col, value } — one-based inside the committed rectangle
  lockAvailable = true,
} = {}) {
  const cells = [HEADERS.slice()];
  const events = [];
  const ops = { clearContent: 0, deleteRow: 0, dataWrites: 0, numberFormats: 0 };
  const lock = { attempted: 0, acquired: 0, released: 0 };
  let committed = false;

  const sheet = {
    getName: () => 'vaccine_rules',
    getLastRow: () => cells.length,
    deleteRow(n) { ops.deleteRow++; cells.splice(n - 1, 1); },
    getDataRange() {
      events.push('sheet:read');
      return { getValues: () => cells.map(row => Array.from({ length: HEADERS.length }, (_, i) => row[i] ?? '')) };
    },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues() {
          const out = Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) => cells[row - 1 + i]?.[column - 1 + j] ?? ''));
          if (committed && tamperReadback && row === 2) {
            const i = tamperReadback.row - 1, j = tamperReadback.col - 1;
            if (out[i] && j < width) out[i][j] = tamperReadback.value;
          }
          return out;
        },
        setNumberFormat() {
          if (failOnNumberFormat) throw new Error('harness: number-format failure');
          ops.numberFormats++;
          return this;
        },
        setValues(values) {
          if (row >= 2) {
            if (failOnWriteBeforeMutation) throw new Error('harness: write failure (before mutation)');
            ops.dataWrites++; events.push('sheet:write');
            values.forEach((entry, i) => {
              cells[row - 1 + i] = Array.from({ length: HEADERS.length }, (_, j) => entry[j] ?? '');
            });
            committed = true;
            if (failOnWriteAfterMutation) throw new Error('harness: write failure (after mutation)');
          }
          return this;
        },
        clearContent() {
          ops.clearContent++;
          for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) cells[row - 1 + i] ||= [], cells[row - 1 + i][column - 1 + j] = '';
          return this;
        },
      };
    },
  };

  const ss = { getSheetByName: name => (name === 'vaccine_rules' ? sheet : null) };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    arrayToObj: (headers, row) => Object.fromEntries(headers.map((key, i) => [key, row[i]])),
    logAction() {},
    console: { error() {}, log() {}, warn() {} },
    Utilities: { getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          lock.attempted++;
          if (!lockAvailable) throw new Error('harness: lock contention');
          lock.acquired++; events.push('lock:acquire');
        },
        releaseLock() { lock.released++; events.push('lock:release'); },
      }),
    },
    SpreadsheetApp: { flush() { if (failOnFlush) throw new Error('harness: flush failure'); } },
  });
  vm.runInContext(RULES_SOURCE, context);
  return { context, cells, events, ops, lock, readRules: (fy, age) => context.getVaccineRules(fy, age) };
}

const baseRule = (overrides = {}) => ({
  rule_id: 'r-new', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV',
  display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], branch_alt_fields: [],
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0, ...overrides,
});

test('#76a batch save replaces one age group via one padded rectangular write — no clearContent, no deleteRow, stale tail blanked', () => {
  const h = createHarness();
  const four = [1, 2, 3, 4].map(n => baseRule({ rule_id: `r-${n}`, display_name: `R${n}` }));
  assert.equal(h.context.batchSaveRules(2569, '1yr', four, 'admin').success, true);
  assert.equal(h.ops.clearContent, 0, 'the destructive clear-before-write window is gone');
  assert.equal(h.ops.deleteRow, 0);
  assert.equal(h.ops.dataWrites, 1, 'exactly ONE managed data write');
  assert.equal(h.readRules(2569, '1yr').length, 4);

  // Shrinking batch: 2 rules replace 4 — the stale tail must be blanked by the same write.
  const two = [baseRule({ rule_id: 'r-a' }), baseRule({ rule_id: 'r-b' })];
  assert.equal(h.context.batchSaveRules(2569, '1yr', two, 'admin').success, true);
  assert.equal(h.ops.clearContent, 0, 'still zero clearContent while shrinking');
  assert.equal(h.ops.deleteRow, 0, 'still zero deleteRow while shrinking');
  assert.equal(h.readRules(2569, '1yr').length, 2);
  const tail = h.cells.slice(1).filter(row => row.every(cell => cell === '' || cell == null));
  assert.equal(tail.length, 2, 'the two stale rows are blank padding, not leftover rules');

  // Other fiscal years survive a later batch untouched.
  assert.equal(h.context.batchSaveRules(2570, '1yr', [baseRule({ rule_id: 'other-year', fiscal_year: 2570 })], 'admin').success, true);
  assert.equal(h.readRules(2569, '1yr').length, 2, '2569 rules survive the 2570 batch');
  assert.equal(h.readRules(2570, '1yr').length, 1);
});

test('#76b the script lock spans read→write and is released exactly once on success and on failure', () => {
  const ok = createHarness();
  assert.equal(ok.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin').success, true);
  const order = name => ok.events.indexOf(name);
  assert.ok(order('lock:acquire') !== -1 && order('sheet:read') !== -1 && order('sheet:write') !== -1);
  assert.ok(order('lock:acquire') < order('sheet:read'), 'lock acquired before the read');
  assert.ok(order('sheet:read') < order('sheet:write'), 'write happens after the read under the same lock');
  assert.ok(ok.events.lastIndexOf('lock:release') > order('sheet:write'), 'release is the last lifecycle event');
  assert.equal(ok.lock.acquired, 1);
  assert.equal(ok.lock.released, 1);

  const failing = createHarness({ failOnWriteAfterMutation: true });
  assert.equal(failing.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin').success, false);
  assert.equal(failing.lock.acquired, 1, 'failure path also acquires once');
  assert.equal(failing.lock.released, 1, 'release-in-finally fires exactly once on failure');
});

test('#76c format-throw → commit_failure with values provably untouched', () => {
  const h = createHarness({ failOnNumberFormat: true });
  // The sheet starts header-only, so "untouched" means still header-only with zero value writes.
  const result = h.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin');
  assert.equal(result.success, false, 'a format-throw is never a success');
  assert.equal(result.status, 'commit_failure', 'values never written → honest commit_failure');
  assert.equal(h.ops.dataWrites, 0, 'setValues was never invoked');
  assert.equal(h.cells.length, 1, 'no value rows exist');
  assert.equal(h.lock.released, 1);
});

test('#76d write throws before mutation → commit_uncertain and rows intact', () => {
  const h = createHarness({ failOnWriteBeforeMutation: true });
  // Seed one existing rule from a healthy harness, then attack the write on a fresh one:
  // the sheet starts empty, so a non-mutating throw must leave it empty and unclaimed.
  const result = h.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin');
  assert.equal(result.success, false);
  assert.equal(result.status, 'commit_uncertain', 'an attempted write that threw is ambiguous — never commit_failure, never success');
  assert.equal(h.cells.length, 1, 'nothing was applied in this window');
  assert.equal(h.lock.released, 1);
});

test('#76e write applies then throws → commit_uncertain; no success claim; lock released', () => {
  const h = createHarness({ failOnWriteAfterMutation: true });
  const result = h.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin');
  assert.equal(result.success, false, 'a lost response after an applied write is never reported as success');
  assert.equal(result.status, 'commit_uncertain');
  assert.equal(h.readRules(2569, '1yr').length, 1, 'the applied row is visible for inspection');
  assert.equal(h.lock.released, 1);
});

test('#76f genuine read-back mismatch → commit_uncertain (verification is not decorative)', () => {
  const h = createHarness({ tamperReadback: { row: 1, col: 1, value: 'tampered-rule-id' } });
  const result = h.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin');
  assert.equal(result.success, false, 'a mismatching read-back must not be reported as success');
  assert.equal(result.status, 'commit_uncertain');
});

test('#76g lock contention → rules_busy with zero mutation and no release', () => {
  const h = createHarness({ lockAvailable: false });
  const result = h.context.batchSaveRules(2569, '1yr', [baseRule()], 'admin');
  assert.equal(result.success, false);
  assert.equal(result.status, 'rules_busy');
  assert.equal(h.ops.dataWrites, 0, 'zero writes under contention');
  assert.equal(h.cells.length, 1, 'sheet untouched');
  assert.equal(h.lock.released, 0, 'a lock that was never acquired is never released');
});

test('#76h seed force resets its year through the rectangle — no deleteRow, other years preserved', () => {
  const h = createHarness();
  assert.equal(h.context.seedVaccineRules(2569, 'admin').success, true);
  const seeded2569 = h.readRules(2569, '1yr').length;
  assert.ok(seeded2569 > 0);
  assert.equal(h.context.batchSaveRules(2570, '1yr', [baseRule({ rule_id: 'yr70', fiscal_year: 2570 })], 'admin').success, true);

  const opsBefore = { ...h.ops };
  const force = h.context.seedVaccineRules(2569, 'admin', true);
  assert.equal(force.success, true, 'force re-seed succeeds');
  assert.equal(h.ops.deleteRow, opsBefore.deleteRow, 'force no longer deletes rows one by one');
  assert.equal(h.ops.clearContent, opsBefore.clearContent, 'force never clears the sheet');
  assert.ok(h.readRules(2569, '1yr').length > 0, 're-seeded year has rules again');
  assert.equal(h.readRules(2570, '1yr').length, 1, 'the other fiscal year survives the force re-seed');
});

test('#76i clone commits through the verified rectangle and preserves source lineage key', () => {
  const h = createHarness();
  assert.equal(h.context.batchSaveRules(2568, '1yr', [baseRule({ rule_id: 'src', fiscal_year: 2568 })], 'admin').success, true);
  const opsBefore = { ...h.ops };
  const clone = h.context.cloneRulesFromYear(2568, 2569, 'admin');
  assert.equal(clone.success, true);
  assert.equal(clone.cloned, 1);
  assert.equal(h.ops.clearContent, opsBefore.clearContent);
  assert.equal(h.ops.deleteRow, opsBefore.deleteRow);
  const cloned = h.readRules(2569, '1yr');
  assert.equal(cloned.length, 1);
  assert.equal(cloned[0].metric_key, 'src', 'clone keeps the source effective lineage key (Decision E)');
  assert.equal(h.lock.released >= 2, true, 'each mutation releases its own lock');
});
