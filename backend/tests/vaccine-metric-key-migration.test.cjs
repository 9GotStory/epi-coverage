/**
 * Issue #59 RED contracts — admin-safe one-time migration for vaccine metric_key.
 *
 * Product contract (ticket #59, following the read-only findings in #58):
 *   - `migrateVaccineMetricKeys(adminEmail)` is an ADMIN-ONLY route; the audited
 *     actor is the server-derived authenticated admin email — client-supplied
 *     emails are ignored;
 *   - everything is validated BEFORE the first mutation and any ambiguous schema
 *     (duplicate/missing required headers) or identity collision (duplicate
 *     rule_id, resolved-key collision within one fiscal_year + age_group +
 *     view_type) fails closed with ZERO writes;
 *   - a missing metric_key header appends EXACTLY one column at the end — never
 *     reorders existing columns; blank/missing keys initialize to the row's own
 *     rule_id; established non-empty keys are preserved byte-for-byte;
 *   - no other cell ever changes (rule semantics, updated_at, updated_by, display
 *     names, active state included) and no Dashboard_Summaries write/recompute
 *     happens here (#58 stays open);
 *   - idempotent rerun: no duplicate column, no key churn, no value writes;
 *     the result reports created/initialized/preserved/total counts;
 *   - commit honesty follows Issue #76: an attempted write that throws or a
 *     read-back mismatch is commit_uncertain, never a success claim.
 *
 * Seams under test (agreed contract seams): the real `migrateVaccineMetricKeys`
 * public function on a synthetic vaccine_rules sheet, and the REAL backend
 * Router's doPost dispatch (its actual admin gate code executes; only boundary
 * collaborators are stubbed). Harness follows tests/vaccine-rules-write-safety.
 * test.cjs (node:test + vm + synthetic sheet). All fixtures are synthetic.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHEETTEXT_SOURCE = fs.readFileSync(path.join(__dirname, '../src/SheetText.js'), 'utf8'); // Issue #77: shared formula-injection escape
const RULES_SOURCE = fs.readFileSync(path.join(__dirname, '../src/VaccineRules.js'), 'utf8');
const ROUTER_SOURCE = fs.readFileSync(path.join(__dirname, '../src/Router.js'), 'utf8');

/** Live FY2569 shape (verified in #58): 17 columns, date_checks present, NO metric_key. */
const LEGACY_HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'date_checks', 'updated_at', 'updated_by',
];
/** Forward schema (Decision E): metric_key stored before date_checks. */
const FORWARD_HEADERS = [
  'rule_id', 'fiscal_year', 'age_group', 'view_type', 'vaccine_group', 'display_name',
  'hdc_code', 'required_fields', 'logic_type', 'branch_alt_fields', 'is_required_for_v2',
  'is_active', 'target_age_months', 'note', 'metric_key', 'date_checks', 'updated_at', 'updated_by',
];

const SEED_STAMP = new Date('2026-09-10T09:00:00.000Z');
const SEED_ACTOR = 'seed@district.example';
const MIGRATION_ACTOR = 'admin@district.example';

/** Build one synthetic rule row array (sheet-typed values) in the given header order. */
function rowIn(headers, overrides = {}) {
  const values = {
    rule_id: 'aaaaaaaa-0000-4000-8000-000000000001', fiscal_year: 2569, age_group: '1yr',
    view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031',
    required_fields: '["dtp1_date"]', logic_type: 'ALL', branch_alt_fields: '[]',
    is_required_for_v2: true, is_active: true, target_age_months: 2, note: '', metric_key: '',
    date_checks: '', updated_at: SEED_STAMP, updated_by: SEED_ACTOR, ...overrides,
  };
  return headers.map(h => (values[h] === undefined ? '' : values[h]));
}

/**
 * Synthetic vaccine_rules sheet + VM harness for VaccineRules.js.
 * ops records every mutating sheet operation so fail-closed/idempotency
 * assertions observe the real write surface, not private flags.
 */
function createMigrationHarness({
  headers = LEGACY_HEADERS,
  rows = [],
  failOnHeaderWrite = false,
  failOnValueWrite = false, // throw before a data-region setValues applies
  failOnFormat = false,
  failOnInsertColumns = false,
  tamperReadback = null, // { r, c } zero-based cell reads back corrupted after the first write
  lockAvailable = true,
} = {}) {
  const cells = [headers.slice(), ...rows.map(r => r.map(v => (v === undefined ? '' : v)))];
  const ops = { headerWrites: [], valueWrites: [], formats: 0, insertedColumns: 0, clearContent: 0, deleteRow: 0 };
  const writtenCells = new Set(); // "row:col" (1-based) touched by any setValues
  const lock = { acquired: 0, released: 0 };
  const auditLog = [];
  const sheetRequests = [];
  let anyWriteApplied = false;

  const cellAt = (r, c) => {
    const value = cells[r]?.[c] ?? '';
    if (anyWriteApplied && tamperReadback && r === tamperReadback.r && c === tamperReadback.c) {
      return 'tampered-readback';
    }
    return value;
  };

  const sheet = {
    getName: () => 'vaccine_rules',
    getLastRow: () => cells.length,
    getMaxColumns: () => cells[0].length,
    insertColumnsAfter(position, howMany) {
      if (failOnInsertColumns) throw new Error('harness: insertColumnsAfter failure');
      ops.insertedColumns += howMany;
      return this;
    },
    deleteRow(n) { ops.deleteRow++; cells.splice(n - 1, 1); },
    getDataRange() {
      const width = Math.max(...cells.map(r => r.length), 1);
      return { getValues: () => cells.map((row, r) => Array.from({ length: width }, (_, c) => cellAt(r, c))) };
    },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues() {
          return Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) => cellAt(row - 1 + i, column - 1 + j)));
        },
        setNumberFormat() {
          if (failOnFormat) throw new Error('harness: number-format failure');
          ops.formats++;
          return this;
        },
        setValues(values) {
          if (row === 1) {
            if (failOnHeaderWrite) throw new Error('harness: header write failure');
            // Array.from: normalize VM-realm nested arrays so deep-strict assertions see plain test-realm arrays
            ops.headerWrites.push({ row, column, values: Array.from(values, entry => Array.from(entry)) });
          } else {
            if (failOnValueWrite) throw new Error('harness: value write failure');
            ops.valueWrites.push({ row, column, height, values: Array.from(values, entry => Array.from(entry)) });
          }
          values.forEach((entry, i) => {
            entry.forEach((value, j) => {
              writtenCells.add(`${row + i}:${column + j}`);
              cells[row - 1 + i] ||= [];
              cells[row - 1 + i][column - 1 + j] = value;
            });
          });
          anyWriteApplied = true;
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

  const ss = {
    getSheetByName: name => {
      sheetRequests.push(name);
      return name === 'vaccine_rules' ? sheet : null;
    },
  };
  const context = vm.createContext({
    getSpreadsheet: () => ss,
    arrayToObj: (sheetHeaders, row) => Object.fromEntries(sheetHeaders.map((key, i) => [key, row[i]])),
    logAction: (userId, email, action, details) => auditLog.push({ userId, email, action, details }),
    console: { error() {}, log() {}, warn() {} },
    Utilities: { getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (!lockAvailable) throw new Error('harness: lock contention');
          lock.acquired++;
        },
        releaseLock() { lock.released++; },
      }),
    },
    SpreadsheetApp: { flush() {} },
  });
  vm.runInContext(SHEETTEXT_SOURCE, context);
  vm.runInContext(RULES_SOURCE, context);
  return { context, cells, ops, writtenCells, lock, auditLog, sheetRequests };
}

const cloneCells = cells => cells.map(row => row.map(v => (v instanceof Date ? new Date(v.getTime()) : v)));

// --- #59a — legacy no-column migration (the verified live FY2569 precondition) -------------------

test('#59a legacy sheet without metric_key: appends exactly one trailing column, initializes every key = its own rule_id, changes no other cell, audits the actor', () => {
  const h = createMigrationHarness({
    rows: [
      rowIn(LEGACY_HEADERS, { rule_id: 'aaaaaaaa-0000-4000-8000-000000000001', age_group: '1yr', view_type: 1 }),
      rowIn(LEGACY_HEADERS, { rule_id: 'aaaaaaaa-0000-4000-8000-000000000002', age_group: '1yr', view_type: 2, display_name: 'DTP ครบ 4 เข็ม' }),
      LEGACY_HEADERS.map(() => ''), // blank padding row between data rows: ignored entirely, never keyed
      rowIn(LEGACY_HEADERS, { rule_id: 'aaaaaaaa-0000-4000-8000-000000000003', age_group: '2yr', view_type: 1 }),
    ],
  });
  const before = cloneCells(h.cells);

  const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(result.success, true, `migration must succeed: ${JSON.stringify(result)}`);
  assert.deepEqual(
    { created: result.created, initialized: result.initialized, preserved: result.preserved, total: result.total },
    { created: 1, initialized: 3, preserved: 0, total: 3 },
    'counts: one column created, all three rule rows initialized, none preserved, padding row not counted'
  );

  // Exactly ONE header write appending metric_key AFTER the last existing column — no reorder.
  assert.equal(h.ops.headerWrites.length, 1);
  assert.equal(h.ops.headerWrites[0].column, LEGACY_HEADERS.length + 1, 'metric_key must be appended after the last existing column');
  assert.deepEqual(h.ops.headerWrites[0].values, [['metric_key']]);
  for (let j = 0; j < LEGACY_HEADERS.length; j++) {
    assert.equal(h.cells[0][j], LEGACY_HEADERS[j], `existing header ${LEGACY_HEADERS[j]} must keep its position`);
  }

  // Every rule row stores its own rule_id as the established key; the padding row stays blank.
  const keyCol = LEGACY_HEADERS.length;
  assert.equal(h.cells[1][keyCol], 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(h.cells[2][keyCol], 'aaaaaaaa-0000-4000-8000-000000000002');
  assert.equal(h.cells[4][keyCol], 'aaaaaaaa-0000-4000-8000-000000000003');
  assert.ok(!h.cells[3][keyCol], 'blank padding row must not receive a key');

  // Byte-identical guarantee: every pre-existing cell (semantics, updated_at, updated_by) is unchanged.
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < LEGACY_HEADERS.length; j++) {
      assert.deepEqual(h.cells[i][j], before[i][j], `cell (${i},${j}) must be untouched by the migration`);
    }
  }

  // The stored identity is now real storage, not just the runtime effective-key fallback.
  const read = h.context.getVaccineRules(2569, '1yr');
  assert.equal(read.length, 2, 'both 1yr rules (view 1 and view 2) are read back');
  for (const rule of read) {
    assert.equal(rule.metric_key, rule.rule_id, 'stored metric_key now equals the rule_id');
  }

  // Audit written exactly once, attributed to the passed (server-derived) actor.
  const audits = h.auditLog.filter(l => l.action === 'migrate_vaccine_metric_keys');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].email, MIGRATION_ACTOR);

  // Contract guard: this ticket touches vaccine_rules only — no summary sheet access.
  assert.ok(h.sheetRequests.every(name => name === 'vaccine_rules'), 'migration must not touch any other sheet');
  // Issue #76 discipline: no destructive sheet operation anywhere in the migration.
  assert.equal(h.ops.clearContent + h.ops.deleteRow, 0, 'the migration must never clear or delete rows');
});

// --- #59b — established-key preservation ----------------------------------------------------------

test('#59b established keys are preserved byte-for-byte and never rewritten; only blank key cells are written', () => {
  const h = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-established-1', metric_key: 'lineage-DTP-1' }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-blank-1', metric_key: '' }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-established-2', metric_key: 'lineage-MMR-2' }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-blank-2', metric_key: '' }),
    ],
  });
  const before = cloneCells(h.cells);
  const keyCol = FORWARD_HEADERS.indexOf('metric_key');

  const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(result.success, true);
  assert.deepEqual(
    { created: result.created, initialized: result.initialized, preserved: result.preserved, total: result.total },
    { created: 0, initialized: 2, preserved: 2, total: 4 }
  );

  // No column is appended when the header already exists.
  assert.equal(h.ops.headerWrites.length, 0);

  // Established keys survive byte-for-byte...
  assert.equal(h.cells[1][keyCol], 'lineage-DTP-1');
  assert.equal(h.cells[3][keyCol], 'lineage-MMR-2');
  // ...blank keys initialize to their own rule_id...
  assert.equal(h.cells[2][keyCol], 'rule-blank-1');
  assert.equal(h.cells[4][keyCol], 'rule-blank-2');

  // ...and the write surface touched ONLY the blank key cells (established cells are never rewritten).
  // (writtenCells addresses are 1-based sheet coordinates: header is row 1, data starts at row 2.)
  assert.ok(!h.writtenCells.has(`2:${keyCol + 1}`) && !h.writtenCells.has(`4:${keyCol + 1}`),
    'established key cells must not be rewritten');
  assert.ok(h.writtenCells.has(`3:${keyCol + 1}`) && h.writtenCells.has(`5:${keyCol + 1}`),
    'blank key cells must be written');
  for (const address of h.writtenCells) {
    const [row, col] = address.split(':').map(Number);
    assert.equal(col, keyCol + 1, `the migration may only write the metric_key column (saw row ${row} col ${col})`);
  }

  // Every cell outside the initialized keys is byte-identical.
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < FORWARD_HEADERS.length; j++) {
      if (j === keyCol && (i === 2 || i === 4)) continue;
      assert.deepEqual(h.cells[i][j], before[i][j]);
    }
  }

  assert.equal(h.auditLog.filter(l => l.action === 'migrate_vaccine_metric_keys').length, 1);
});

// --- #59c — idempotent rerun ------------------------------------------------------------------------

test('#59c rerun is a verified no-op: no duplicate column, no key churn, zero writes', () => {
  const h = createMigrationHarness({
    rows: [
      rowIn(LEGACY_HEADERS, { rule_id: 'aaaaaaaa-0000-4000-8000-000000000001', age_group: '1yr', view_type: 1 }),
      rowIn(LEGACY_HEADERS, { rule_id: 'aaaaaaaa-0000-4000-8000-000000000002', age_group: '1yr', view_type: 2 }),
    ],
  });
  assert.equal(h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).success, true);
  const afterFirst = cloneCells(h.cells);
  const opsAfterFirst = {
    headerWrites: h.ops.headerWrites.length, valueWrites: h.ops.valueWrites.length,
    formats: h.ops.formats, insertedColumns: h.ops.insertedColumns,
  };

  const second = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(second.success, true, `rerun must succeed: ${JSON.stringify(second)}`);
  assert.deepEqual(
    { created: second.created, initialized: second.initialized, preserved: second.preserved, total: second.total },
    { created: 0, initialized: 0, preserved: 2, total: 2 },
    'rerun reports nothing created/initialized — every key now counts as preserved'
  );
  assert.equal(h.ops.headerWrites.length, opsAfterFirst.headerWrites, 'no second header write (no duplicate column)');
  assert.equal(h.ops.valueWrites.length, opsAfterFirst.valueWrites, 'zero value writes on rerun (no key churn)');
  assert.equal(h.ops.formats, opsAfterFirst.formats, 'no re-formatting on rerun');
  assert.equal(h.ops.insertedColumns, opsAfterFirst.insertedColumns);
  assert.deepEqual(h.cells, afterFirst, 'sheet state is bit-for-bit identical after the rerun');
});

// --- #59d — ambiguous schema fails closed ------------------------------------------------------------

test('#59d duplicate or missing required headers fail closed with zero mutation', () => {
  const cases = [
    {
      what: 'duplicate rule_id header',
      headers: [...LEGACY_HEADERS, 'rule_id'],
      rows: [rowIn([...LEGACY_HEADERS, 'rule_id'], { rule_id: 'r-1' })],
    },
    {
      what: 'duplicate metric_key header',
      headers: [...FORWARD_HEADERS, 'metric_key'],
      rows: [rowIn([...FORWARD_HEADERS, 'metric_key'], { rule_id: 'r-1', metric_key: 'k-1' })],
    },
    {
      what: 'missing view_type header',
      headers: LEGACY_HEADERS.filter(hd => hd !== 'view_type'),
      rows: [rowIn(LEGACY_HEADERS.filter(hd => hd !== 'view_type'), { rule_id: 'r-1' })],
    },
  ];
  for (const { what, headers, rows } of cases) {
    const h = createMigrationHarness({ headers, rows });
    const before = cloneCells(h.cells);
    const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
    assert.equal(result.success, false, `${what}: must fail closed`);
    assert.ok(result.error, `${what}: must explain the rejection`);
    assert.equal(h.ops.headerWrites.length + h.ops.valueWrites.length + h.ops.formats + h.ops.insertedColumns, 0,
      `${what}: zero mutation`);
    assert.deepEqual(h.cells, before, `${what}: sheet untouched`);
    assert.equal(h.lock.released, 1, `${what}: lock still released exactly once`);
    assert.equal(h.auditLog.length, 0, `${what}: no success audit`);
  }
});

// --- #59e — invalid row identities fail closed --------------------------------------------------------

test('#59e non-empty row without rule_id, duplicate rule_id, and non-string metric_key each fail closed with zero mutation', () => {
  const cases = [
    {
      what: 'non-empty row missing rule_id',
      headers: FORWARD_HEADERS,
      rows: [
        rowIn(FORWARD_HEADERS, { rule_id: 'r-1' }),
        rowIn(FORWARD_HEADERS, { rule_id: '', display_name: 'orphan row with data but no id' }),
      ],
    },
    {
      what: 'duplicate rule_id',
      headers: FORWARD_HEADERS,
      rows: [
        rowIn(FORWARD_HEADERS, { rule_id: 'r-dup', view_type: 1 }),
        rowIn(FORWARD_HEADERS, { rule_id: 'r-dup', view_type: 1, display_name: 'DTP เข็ม 2' }),
      ],
    },
    {
      what: 'non-string metric_key cell',
      headers: FORWARD_HEADERS,
      rows: [rowIn(FORWARD_HEADERS, { rule_id: 'r-1', metric_key: 12345 })],
    },
  ];
  for (const { what, headers, rows } of cases) {
    const h = createMigrationHarness({ headers, rows });
    const before = cloneCells(h.cells);
    const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
    assert.equal(result.success, false, `${what}: must fail closed`);
    assert.ok(result.error, `${what}: must explain the rejection`);
    assert.equal(h.ops.headerWrites.length + h.ops.valueWrites.length + h.ops.formats + h.ops.insertedColumns, 0,
      `${what}: zero mutation`);
    assert.deepEqual(h.cells, before, `${what}: sheet untouched`);
  }
});

// --- #59f — resolved-key collision within one FY + age_group + view_type fails closed ----------------

test('#59f resolved-key collision inside one fiscal_year + age_group + view_type fails closed before any write', () => {
  // An established key equal to another row's rule_id in the SAME scope would collide once
  // the blank row is initialized — the whole migration must refuse, not half-apply.
  const h = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-a', metric_key: 'shared-lineage', view_type: 1 }),
      rowIn(FORWARD_HEADERS, { rule_id: 'shared-lineage', metric_key: '', view_type: 1, display_name: 'DTP เข็ม 2' }),
    ],
  });
  const before = cloneCells(h.cells);
  const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(result.success, false, 'collision must fail closed');
  assert.match(result.error, /shared-lineage|collisions|collision/i);
  assert.equal(h.ops.headerWrites.length + h.ops.valueWrites.length, 0, 'zero mutation');
  assert.deepEqual(h.cells, before);

  // Established-vs-established collision in the same scope is equally rejected.
  const h2 = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-a', metric_key: 'dupe', view_type: 2 }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-b', metric_key: 'dupe', view_type: 2, display_name: 'MMR ครบ' }),
    ],
  });
  assert.equal(h2.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).success, false);
  assert.equal(h2.ops.headerWrites.length + h2.ops.valueWrites.length, 0);

  // The same string in a DIFFERENT view_type of the same FY/age is a distinct identity (allowed).
  const h3 = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-a', metric_key: 'view-scoped', view_type: 1 }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-b', metric_key: 'view-scoped', view_type: 2, display_name: 'MMR ครบ' }),
    ],
  });
  assert.equal(h3.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).success, true, 'same key in another view_type is a different identity');
});

// --- #59g — same lineage key across different fiscal years is allowed ---------------------------------

test('#59g cross-FY lineage continuity is allowed: the same resolved key in another fiscal year never collides', () => {
  const h = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-2569-a', metric_key: 'lineage-K', fiscal_year: 2569 }),
      rowIn(FORWARD_HEADERS, { rule_id: 'rule-2570-a', metric_key: 'lineage-K', fiscal_year: 2570 }),
      // Clone-shaped continuity: the FY2570 instance carries FY2569's lineage as its established
      // key while FY2569's own row is still blank (resolves to its rule_id) — same resolved key
      // string, different fiscal year, so it is one lineage, not a collision.
      rowIn(FORWARD_HEADERS, { rule_id: 'root-2569', metric_key: '', fiscal_year: 2569, age_group: '2yr' }),
      rowIn(FORWARD_HEADERS, { rule_id: 'clone-2570', metric_key: 'root-2569', fiscal_year: 2570, age_group: '2yr' }),
    ],
  });
  const result = h.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(result.success, true, `cross-FY lineage must be accepted: ${JSON.stringify(result)}`);
  assert.deepEqual(
    { created: result.created, initialized: result.initialized, preserved: result.preserved, total: result.total },
    { created: 0, initialized: 1, preserved: 3, total: 4 }
  );
});

// --- #59h — commit honesty (Issue #76 discipline) ------------------------------------------------------

test('#59h commit states are honest: pre-write failure → commit_failure, post-attempt failure/tamper → commit_uncertain, lock busy → rules_busy', () => {
  // Structural insert failure happens before any value write → provably nothing applied.
  const insertFail = createMigrationHarness({ failOnInsertColumns: true, rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })] });
  const insertResult = insertFail.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(insertResult.success, false);
  assert.equal(insertResult.status, 'commit_failure');
  assert.equal(insertFail.ops.valueWrites.length, 0, 'no value write was attempted');

  // A value write that throws may or may not have applied → never a success claim.
  const writeFail = createMigrationHarness({ failOnValueWrite: true, rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })] });
  const writeResult = writeFail.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(writeResult.success, false);
  assert.equal(writeResult.status, 'commit_uncertain');
  assert.equal(writeFail.auditLog.filter(l => l.action === 'migrate_vaccine_metric_keys').length, 1,
    'the no-success-claimed state is audited');

  // A header write that throws is equally ambiguous (the column may exist).
  const headerFail = createMigrationHarness({ failOnHeaderWrite: true, rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })] });
  assert.equal(headerFail.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).status, 'commit_uncertain');

  // Read-back verification has teeth: a corrupted readback of an UNRELATED column must fail
  // the commit (the migration must prove it changed nothing outside the key column).
  const tampered = createMigrationHarness({
    headers: FORWARD_HEADERS,
    rows: [rowIn(FORWARD_HEADERS, { rule_id: 'r-1', metric_key: '' })],
    tamperReadback: { r: 1, c: FORWARD_HEADERS.indexOf('display_name') },
  });
  assert.equal(tampered.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).status, 'commit_uncertain');

  // Same teeth on the APPEND path (the live legacy-FY2569 shape): a corrupted readback of a
  // NEWLY initialized key cell must fail the commit — never a success claim.
  const tamperedAppend = createMigrationHarness({
    rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })],
    tamperReadback: { r: 1, c: LEGACY_HEADERS.length },
  });
  assert.equal(tamperedAppend.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).status, 'commit_uncertain',
    'an initialized key that does not read back must not be reported as success');

  // A format failure after the header landed is equally ambiguous — never success.
  const formatFail = createMigrationHarness({ failOnFormat: true, rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })] });
  assert.equal(formatFail.context.migrateVaccineMetricKeys(MIGRATION_ACTOR).status, 'commit_uncertain');

  // Lock contention: zero mutation, no release, no audit.
  const busy = createMigrationHarness({ lockAvailable: false, rows: [rowIn(LEGACY_HEADERS, { rule_id: 'r-1' })] });
  const busyResult = busy.context.migrateVaccineMetricKeys(MIGRATION_ACTOR);
  assert.equal(busyResult.success, false);
  assert.equal(busyResult.status, 'rules_busy');
  assert.equal(busy.ops.headerWrites.length + busy.ops.valueWrites.length, 0);
  assert.equal(busy.lock.released, 0);
});

// --- #59i — real Router: admin gate + server-derived actor ---------------------------------------------

/** Load the REAL router with minimal boundary stubs; `calls` records migration arguments. */
function createRouterHarness({ valid = true, role = 'admin', email = MIGRATION_ACTOR } = {}) {
  const calls = [];
  const context = vm.createContext({
    console: { error() {}, log() {} },
    validateTokenAndGetRole: () => (valid ? { valid: true, role, email } : { valid: false, error: 'synthetic invalid session' }),
    migrateVaccineMetricKeys: (...args) => {
      calls.push(args);
      return { success: true, created: 0, initialized: 0, preserved: 0, total: 0 };
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => ({ text, setMimeType(mimeType) { return { text, mimeType }; } }),
    },
  });
  vm.runInContext(ROUTER_SOURCE, context);
  return { context, calls };
}

const migrationEvent = body => ({
  parameter: { action: 'migrateVaccineMetricKeys', auth_token: 'synthetic-admin-token-59' },
  postData: { contents: JSON.stringify(body) },
});
const responseOf = output => JSON.parse(output.text);

test('#59i Router gates the migration behind the real admin check and derives the audited actor server-side', () => {
  // Admin: dispatched exactly once, with ONLY the session email — never a second client argument.
  const admin = createRouterHarness();
  const res = responseOf(admin.context.doPost(migrationEvent({ action: 'migrateVaccineMetricKeys' })));
  assert.equal(res.status, 200);
  assert.equal(admin.calls.length, 1, 'migrateVaccineMetricKeys called exactly once');
  assert.equal(admin.calls[0].length, 1, 'exactly one argument — the server-derived email');
  assert.equal(admin.calls[0][0], MIGRATION_ACTOR, 'the actor is the authenticated session email');

  // A client-supplied email must never be forwarded for attribution.
  const spoof = createRouterHarness();
  responseOf(spoof.context.doPost(migrationEvent({ action: 'migrateVaccineMetricKeys', adminEmail: 'attacker@example.invalid' })));
  assert.equal(spoof.calls.length, 1);
  assert.equal(spoof.calls[0][0], MIGRATION_ACTOR, 'client-supplied adminEmail must be ignored');
  assert.ok(!spoof.calls[0].includes('attacker@example.invalid'), 'the spoofed email must never reach the migration');

  // Non-admin sessions are rejected by the router's real admin gate.
  const user = createRouterHarness({ role: 'user' });
  const resUser = responseOf(user.context.doPost(migrationEvent({ action: 'migrateVaccineMetricKeys' })));
  assert.equal(resUser.status, 403, 'non-admin requests are forbidden');
  assert.equal(user.calls.length, 0, 'the migration must not run for non-admins');

  // Unauthenticated requests never reach the dispatch.
  const anon = createRouterHarness({ valid: false });
  const resAnon = responseOf(anon.context.doPost(migrationEvent({ action: 'migrateVaccineMetricKeys' })));
  assert.equal(resAnon.status, 401, 'invalid sessions are unauthorized');
  assert.equal(anon.calls.length, 0, 'the migration must not run without a valid session');
});
