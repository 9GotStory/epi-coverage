/**
 * Issue #23 RED contracts — Summary Contract v2: persist the View 2 applicable
 * denominator and pending population.
 *
 * Seam under test: `calcGroupSummary()` (`dashboardLogic.ts`). It already computes
 * the applicable denominator internally as the local `view2Total` variable
 * (dashboardLogic.ts:36,84,119) but does NOT return it. Ticket #23 requires the
 * returned/persisted summary to carry:
 *   - `view2ApplicableTotal` — records participating in the View 2 coverage denominator;
 *   - `view2PendingCount`    — records excluded from that denominator by current
 *                              View 2 pending semantics.
 * `view2Failed` is derived at consumption time only and must NOT be persisted.
 *
 * Boundaries protected by these tests:
 *   - `evaluateDynamicV2()` and `VaccineStatus` are NOT changed by #23 — HDC
 *     override semantics are exercised through the REAL engine with minimal
 *     synthetic fixtures (the existing ruleEngine.test.ts already covers the
 *     `ผ่าน` clearing override; this file does not re-specify the engine).
 *   - No historical migration/backfill is expected; nothing here touches
 *     persisted rows.
 *
 * Partition model (approved invariant, verified against the current loop): every
 * cohort record is exactly one of {applicable, pending} after the HDC override —
 * there is no third exclusion state in `calcGroupSummary()`.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import type { GroupSummary } from './dashboardLogic';
import { evaluateDynamicV2 } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/**
 * Ticket #23 forward contract. All added properties are optional so the cast-free
 * widening is valid TypeScript TODAY (RED) while asserting the fields' runtime
 * presence. GREEN must make these required on `GroupSummary` (current writer).
 */
type ForwardGroupSummary = GroupSummary & {
  view2ApplicableTotal?: number;
  view2PendingCount?: number;
};

const summarize = (...args: Parameters<typeof calcGroupSummary>): ForwardGroupSummary =>
  calcGroupSummary(...args);

// --- synthetic fixtures ------------------------------------------------------

/** Minimal synthetic individual record (identifier-shaped fields are fake). */
const rec = (id: string): EpiRecord => ({
  hoscode: '00000',
  hosname: 'สถานบริการจำลอง',
  pid: `P-${id}`,
  cid: `00000000000${id.length}`,
  name: id,
  lname: 'ทดสอบ',
  birth: '2024-01-01',
});

/** Harmless View 1 stub — View 1 aggregation is out of scope for #23. */
const v1Eval = () => ({ passedCount: 0, missingVaccines: [], results: {} });

/** Post-override View 2 statuses (the states `calcGroupSummary` receives). */
const passedV2: VaccineStatus = { isFullyImmunized: true, status: 'PASS', missingVaccines: [], pendingVaccines: [], passedVaccines: ['BCG'] };
const failedV2: VaccineStatus = { isFullyImmunized: false, status: 'FAIL', missingVaccines: ['DTP'], pendingVaccines: [], passedVaccines: ['BCG'] };
const pendingV2: VaccineStatus = { isFullyImmunized: false, status: 'PENDING', missingVaccines: [], pendingVaccines: ['HBV'], passedVaccines: [] };

const cohortWith = (statuses: VaccineStatus[]) => {
  const byName = new Map(statuses.map((status, index) => [`R${index}`, status]));
  return {
    records: statuses.map((_, index) => rec(`R${index}`)),
    v2Eval: (r: EpiRecord): VaccineStatus => {
      const status = byName.get(r.name);
      if (!status) throw new Error(`fixture missing status for ${r.name}`);
      return status;
    },
  };
};

// --- Group A: applicable and pending counts ---------------------------------

describe('Issue #23 — Group A: applicable/pending counts', () => {
  it('returns view2ApplicableTotal=2 and view2PendingCount=2 for a mixed cohort (RED: fields absent)', () => {
    const { records, v2Eval } = cohortWith([passedV2, failedV2, pendingV2, pendingV2]);
    const s = summarize(records, v1Eval, v2Eval);

    // Existing behavior (must stay): cohort 4, passed 1, coverage 1/2 = 50%.
    expect(s.total).toBe(4);
    expect(s.view2Passed).toBe(1);
    expect(s.view2Coverage).toBe(50);

    // Ticket #23 contract (RED: undefined today).
    expect(s.view2ApplicableTotal).toBe(2);
    expect(s.view2PendingCount).toBe(2);
  });
});

// --- Group B: exact invariants -----------------------------------------------

describe('Issue #23 — Group B: current-contract invariants', () => {
  const cases: Array<[name: string, statuses: VaccineStatus[]]> = [
    ['mixed', [passedV2, failedV2, pendingV2, pendingV2]],
    ['all-applicable', [passedV2, passedV2, failedV2]],
    ['all-pending', [pendingV2, pendingV2]],
    ['empty', []],
  ];

  for (const [name, statuses] of cases) {
    it(`satisfies 0 <= passed <= applicable <= total and applicable + pending === total (${name})`, () => {
      const { records, v2Eval } = cohortWith(statuses);
      const s = summarize(records, v1Eval, v2Eval);
      // `?? NaN` keeps the assertions TypeScript-valid in RED while failing loudly:
      // a missing contract field is NaN here, never a silently-passing undefined.
      const applicable = s.view2ApplicableTotal ?? NaN;
      const pending = s.view2PendingCount ?? NaN;

      expect(s.view2Passed).toBeGreaterThanOrEqual(0);
      expect(applicable).toBeGreaterThanOrEqual(s.view2Passed);
      expect(s.total).toBeGreaterThanOrEqual(applicable);
      expect(applicable + pending).toBe(s.total);
    });
  }

  it('derives the failed count as applicable - passed (non-negative, exact)', () => {
    const { records, v2Eval } = cohortWith([passedV2, failedV2, pendingV2, pendingV2]);
    const s = summarize(records, v1Eval, v2Eval);
    const failed = (s.view2ApplicableTotal ?? NaN) - s.view2Passed;
    expect(failed).toBeGreaterThanOrEqual(0);
    expect(failed).toBe(1);
  });
});

// --- Group C: all-applicable edge --------------------------------------------

describe('Issue #23 — Group C: all-applicable cohort', () => {
  it('applicable === total, pending === 0, and passed < applicable keeps failed derivation meaningful', () => {
    const { records, v2Eval } = cohortWith([passedV2, passedV2, failedV2]);
    const s = summarize(records, v1Eval, v2Eval);

    expect(s.total).toBe(3);
    expect(s.view2Passed).toBe(2);
    expect(s.view2ApplicableTotal).toBe(3);
    expect(s.view2PendingCount).toBe(0);
    expect((s.view2ApplicableTotal ?? NaN) - s.view2Passed).toBe(1);
  });
});

// --- Group D: all-pending edge ------------------------------------------------

describe('Issue #23 — Group D: all-pending cohort', () => {
  it('passed=0, applicable=0, pending=total; coverage 0 is legitimate (denominator 0, unchanged)', () => {
    const { records, v2Eval } = cohortWith([pendingV2, pendingV2]);
    const s = summarize(records, v1Eval, v2Eval);

    // Existing semantics preserved: coverage 0 with zero denominator.
    expect(s.total).toBe(2);
    expect(s.view2Passed).toBe(0);
    expect(s.view2Coverage).toBe(0);

    expect(s.view2ApplicableTotal).toBe(0);
    expect(s.view2PendingCount).toBe(2);
  });
});

// --- Group E: empty cohort ----------------------------------------------------

describe('Issue #23 — Group E: empty cohort', () => {
  it('locks safe zeros and the exact partition 0 + 0 = 0', () => {
    const s = summarize([], v1Eval, (r: EpiRecord) => { throw new Error(`unexpected record ${r.name}`); });

    expect(s.total).toBe(0);
    expect(s.view2Passed).toBe(0);
    expect(s.view2Coverage).toBe(0);
    expect(s.view2ApplicableTotal).toBe(0);
    expect(s.view2PendingCount).toBe(0);
  });
});

// --- Group F: HDC override preservation through the REAL engine ---------------

// One synthetic view-2 rule with an unreachable target age, so a child without
// the dose is locally PENDING regardless of when the test runs.
const pendingRule: VaccineRule = {
  rule_id: 'fixture-hbv', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'HBV',
  display_name: 'HBV', hdc_code: '', required_fields: ['hbv1_date'], logic_type: 'ALL',
  is_required_for_v2: true, is_active: true, target_age_months: 600,
};

const locallyPendingChild = (): EpiRecord => ({ ...rec('R0'), result: undefined });

describe('Issue #23 — Group F: HDC override boundary (real evaluateDynamicV2, unchanged)', () => {
  it('F1: HDC "ผ่าน" clears local pending — the record becomes applicable and passed (engine preservation + summary RED)', () => {
    const record = { ...locallyPendingChild(), result: 'ผ่าน' };
    const engine = evaluateDynamicV2(record, [pendingRule]);

    // Engine preservation (passes today; existing ruleEngine.test.ts also covers the override).
    expect(engine.status).toBe('PASS');
    expect(engine.pendingVaccines).toEqual([]);

    // Summary must count it in the applicable denominator, not pending.
    const s = summarize([record], v1Eval, () => engine);
    expect(s.total).toBe(1);
    expect(s.view2Passed).toBe(1);
    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2PendingCount).toBe(0);
  });

  it('F2: HDC "ไม่ผ่าน" with local PENDING stays pending — excluded from the applicable denominator', () => {
    const record = { ...locallyPendingChild(), result: 'ไม่ผ่าน' };
    const engine = evaluateDynamicV2(record, [pendingRule]);

    // Engine preservation: a local PENDING survives an HDC fail (no PENDING state in HDC export).
    expect(engine.status).toBe('PENDING');
    expect((engine.pendingVaccines ?? []).length).toBeGreaterThan(0);

    // Summary must count it as pending, never applicable.
    const s = summarize([record], v1Eval, () => engine);
    expect(s.total).toBe(1);
    expect(s.view2Passed).toBe(0);
    expect(s.view2ApplicableTotal).toBe(0);
    expect(s.view2PendingCount).toBe(1);
  });
});

// --- Group G: serialization/persistence contract ------------------------------

describe('Issue #23 — Group G: persisted JSON contract (writer serializes calcGroupSummary output)', () => {
  it('JSON round-trip preserves the new fields and does NOT contain view2Failed', () => {
    const { records, v2Eval } = cohortWith([passedV2, failedV2, pendingV2, pendingV2]);
    const s = summarize(records, v1Eval, v2Eval);

    // The writer persists JSON.stringify(calcGroupSummary(...)) unchanged, so the
    // round-tripped object is the persisted contract.
    const persisted = JSON.parse(JSON.stringify(s)) as ForwardGroupSummary;

    expect(persisted.view2ApplicableTotal).toBe(2);
    expect(persisted.view2PendingCount).toBe(2);
    expect('view2Failed' in persisted).toBe(false);
  });
});
