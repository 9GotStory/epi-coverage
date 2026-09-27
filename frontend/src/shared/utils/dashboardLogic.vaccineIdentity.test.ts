// @vitest-environment jsdom
/**
 * Issue #26 RED contracts — current summary vaccine identity persistence.
 *
 * Canonical contract: docs/specs/comparison-page-improvement.md §6 Decision E.
 * Locked architecture seam (Issue #26): `calcGroupSummary` may receive the
 * snapshot-time `VaccineRule[]` used for that computation as an additional
 * OPTIONAL argument after the existing four; evaluator semantics
 * (`evaluateDynamicV1/V2`) remain UNCHANGED — enrichment joins evaluator output
 * `display_name`s to the SAME rule set used to compute the snapshot
 * (intra-snapshot lookup only; display_name is NEVER the cross-year identity).
 *
 * Expected today: RED — breakdown entries carry only
 * { name, passed, total, coverage }; metric_key/vaccine_group are absent.
 * The tests use local forward test types (no production type edits during RED).
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import type { GroupSummary } from './dashboardLogic';
import type { VaccineRule, View1Evaluation } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/** Forward persisted-entry shape (Decision E current contract) for assertions only. */
type ForwardVaccineBreakdownEntry = {
  metric_key?: string;
  vaccine_group?: string;
  name: string;
  passed: number;
  total: number;
  coverage: number;
};
type ForwardGroupSummary = Omit<GroupSummary, 'view1Breakdown' | 'view2Breakdown'> & {
  view1Breakdown: ForwardVaccineBreakdownEntry[];
  view2Breakdown: ForwardVaccineBreakdownEntry[];
};
/** Issue #26 locked seam: optional 5th parameter carrying the snapshot-time rules. */
type ForwardCalc = (
  data: EpiRecord[],
  evalView1Fn: (r: EpiRecord) => View1Evaluation,
  evalView2Fn: (r: EpiRecord) => VaccineStatus,
  fiscalYear?: number,
  rules?: VaccineRule[],
) => ForwardGroupSummary;

const calc = calcGroupSummary as unknown as ForwardCalc;

/** Synthetic snapshot-time rule carrying the forward identity fields. */
function rule(overrides: Partial<VaccineRule> & { metric_key?: string }): VaccineRule {
  return {
    rule_id: 'r-1',
    fiscal_year: 2569,
    age_group: '1yr',
    view_type: 2,
    vaccine_group: 'DTP',
    display_name: 'DTP เข็ม 1',
    required_fields: ['dtp1_date'],
    branch_alt_fields: [],
    logic_type: 'ALL',
    is_required_for_v2: true,
    is_active: true,
    ...overrides,
  } as VaccineRule;
}

/** Stub evaluators producing engine-shaped output keyed by display_name (engine semantics untouched). */
const evalV1For = (names: string[]) => (): View1Evaluation =>
  ({
    passedCount: names.length,
    results: Object.fromEntries(names.map(n => [n, true])),
    missingVaccines: [],
    pendingRuleNames: [],
    unknownRuleNames: [],
    unknownVaccines: [],
  }) as unknown as View1Evaluation;
const emptyV1 = evalV1For([]);

const evalV2For = (passed: string[], missing: string[]) => (): VaccineStatus =>
  ({
    isFullyImmunized: missing.length === 0,
    passedVaccines: passed,
    missingVaccines: missing,
    pendingVaccines: [],
  }) as unknown as VaccineStatus;

const record = (): EpiRecord => ({ hoscode: '06413', hosname: 'บ้านหนุน', birth: '2025-01-15' }) as unknown as EpiRecord;

describe('#26 — summary vaccine identity persistence (RED)', () => {
  it('B1/B2: current View 1 and View 2 breakdown entries persist metric_key + snapshot vaccine_group with unchanged numerics', () => {
    const v1Rule = rule({ rule_id: 'r-v1', view_type: 1, display_name: 'DTP เข็ม 1', vaccine_group: 'DTP', metric_key: 'v1-dtp1' });
    const v2Rule = rule({ rule_id: 'r-v2', view_type: 2, display_name: 'BCG 1 เข็ม', vaccine_group: 'BCG', metric_key: 'v2-bcg1' });
    const summary = calc(
      [record(), record()],
      evalV1For(['DTP เข็ม 1']),
      evalV2For(['BCG 1 เข็ม'], []),
      2569,
      [v1Rule, v2Rule],
    );
    const v1 = summary.view1Breakdown.find(e => e.name === 'DTP เข็ม 1');
    const v2 = summary.view2Breakdown.find(e => e.name === 'BCG 1 เข็ม');
    expect(v1).toBeDefined();
    expect(v1?.metric_key).toBe('v1-dtp1');
    expect(v1?.vaccine_group).toBe('DTP');
    expect(v1?.passed).toBe(2);
    expect(v1?.total).toBe(2);
    expect(v1?.coverage).toBe(100);
    expect(v2).toBeDefined();
    expect(v2?.metric_key).toBe('v2-bcg1');
    expect(v2?.vaccine_group).toBe('BCG');
    expect(v2?.passed).toBe(2);
    expect(v2?.total).toBe(2);
    expect(v2?.coverage).toBe(100);
  });

  it('B3: snapshot rule with empty metric_key persists the effective rule_id — never an empty key', () => {
    const legacyLive = rule({ rule_id: 'legacy-live-rule', metric_key: '', display_name: 'HBV เข็ม 1', vaccine_group: 'HBV' });
    const summary = calc([record()], emptyV1, evalV2For(['HBV เข็ม 1'], []), 2569, [legacyLive]);
    const entry = summary.view2Breakdown.find(e => e.name === 'HBV เข็ม 1');
    expect(entry?.metric_key).toBe('legacy-live-rule');
  });

  it('B4: a valid stored key is persisted exactly as-is', () => {
    const stable = rule({ rule_id: 'r-2', metric_key: 'stable-lineage', display_name: 'MMR เข็ม 1', vaccine_group: 'MMR' });
    const summary = calc([record()], emptyV1, evalV2For(['MMR เข็ม 1'], []), 2569, [stable]);
    expect(summary.view2Breakdown.find(e => e.name === 'MMR เข็ม 1')?.metric_key).toBe('stable-lineage');
  });

  it('B5/B6: vaccine_group and name come from the same snapshot rule set; name stays display-only metadata', () => {
    const dtp = rule({ rule_id: 'r-3', view_type: 2, metric_key: 'dtp-1', vaccine_group: 'DTP', display_name: 'DTP เข็ม 1' });
    const summary = calc([record()], emptyV1, evalV2For(['DTP เข็ม 1'], []), 2569, [dtp]);
    const entry = summary.view2Breakdown.find(e => e.name === 'DTP เข็ม 1');
    expect(entry?.vaccine_group).toBe('DTP'); // snapshot-time metadata, not later inference
    expect(entry?.name).toBe('DTP เข็ม 1'); // snapshot-time display text
    expect(entry?.metric_key).toBe('dtp-1'); // identity is the key, not the name
  });

  it('B7: the same metric_key string in View 1 and View 2 stays two separate identities in separate arrays', () => {
    const shared = 'shared-lineage';
    const v1Rule = rule({ rule_id: 'r-v1x', view_type: 1, metric_key: shared, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1' });
    const v2Rule = rule({ rule_id: 'r-v2x', view_type: 2, metric_key: shared, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1' });
    const summary = calc(
      [record()],
      evalV1For(['DTP เข็ม 1']),
      evalV2For(['DTP เข็ม 1'], []),
      2569,
      [v1Rule, v2Rule],
    );
    expect(summary.view1Breakdown.some(e => e.metric_key === shared)).toBe(true);
    expect(summary.view2Breakdown.some(e => e.metric_key === shared)).toBe(true);
    expect(summary.view1Breakdown).not.toBe(summary.view2Breakdown);
    expect(summary.view1Breakdown.length + summary.view2Breakdown.length).toBeGreaterThanOrEqual(2);
  });

  it('B8: JSON round-trip retains the identity metadata', () => {
    const v2Rule = rule({ rule_id: 'r-j', metric_key: 'json-lineage', vaccine_group: 'Hib', display_name: 'Hib เข็ม 1' });
    const summary = calc([record()], emptyV1, evalV2For(['Hib เข็ม 1'], []), 2569, [v2Rule]);
    const restored = JSON.parse(JSON.stringify(summary)) as ForwardGroupSummary;
    const entry = restored.view2Breakdown.find(e => e.name === 'Hib เข็ม 1');
    expect(entry?.metric_key).toBe('json-lineage');
    expect(entry?.vaccine_group).toBe('Hib');
    expect(entry?.name).toBe('Hib เข็ม 1');
    expect(entry?.passed).toBe(1);
    expect(entry?.total).toBe(1);
  });

  it('B9: every breakdown entry written under snapshot rules carries a valid non-empty metric_key', () => {
    const rules = [
      rule({ rule_id: 'r-a', view_type: 1, metric_key: 'k-a', display_name: 'DTP เข็ม 1', vaccine_group: 'DTP' }),
      rule({ rule_id: 'r-b', view_type: 2, metric_key: '', display_name: 'BCG 1 เข็ม', vaccine_group: 'BCG' }),
      rule({ rule_id: 'r-c', view_type: 2, metric_key: 'k-c', display_name: 'MMR เข็ม 1', vaccine_group: 'MMR' }),
    ];
    const summary = calc(
      [record(), record()],
      evalV1For(['DTP เข็ม 1']),
      evalV2For(['BCG 1 เข็ม', 'MMR เข็ม 1'], []),
      2569,
      rules,
    );
    for (const entry of [...summary.view1Breakdown, ...summary.view2Breakdown]) {
      expect(typeof entry.metric_key).toBe('string');
      expect((entry.metric_key ?? '').length).toBeGreaterThan(0);
      expect(entry.metric_key).not.toBe('');
    }
    // The empty-key rule resolves to its own rule_id (effective forward identity).
    expect(summary.view2Breakdown.find(e => e.name === 'BCG 1 เข็ม')?.metric_key).toBe('r-b');
  });
});
