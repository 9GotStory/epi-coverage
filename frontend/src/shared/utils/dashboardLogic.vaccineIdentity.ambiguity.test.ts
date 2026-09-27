// @vitest-environment jsdom
/**
 * Issue #26 focused RED contract — ambiguous snapshot identity (Decision E safety rule).
 *
 * Independent review finding: calcGroupSummary's enrichment resolves an
 * evaluator-emitted display_name with a first-match rule lookup. When TWO ACTIVE
 * rules in the SAME view share a display_name but carry DIFFERENT lineages
 * (rule_id + metric_key, and preferably vaccine_group), the evaluator's
 * name-keyed numeric aggregate is already ambiguous — enrichment MUST NOT make
 * that ambiguity worse by arbitrarily persisting one of the candidate identities
 * (false cross-FY continuity).
 *
 * Decision E safety rule: uncertain identity → unavailable.
 * When snapshot-time enrichment cannot identify EXACTLY ONE eligible rule for an
 * evaluator-emitted (view_type, display_name), the breakdown entry KEEPS its
 * existing numeric/name fields but MUST NOT receive identity metadata
 * (metric_key: undefined, vaccine_group: undefined — omitted on JSON serialization).
 *
 * The evaluator's own name-keyed numeric behavior is OUT OF SCOPE here.
 * Harness follows dashboardLogic.vaccineIdentity.test.ts (real calcGroupSummary,
 * synthetic rules/records/evaluator stubs, no source-text assertions). All data
 * synthetic. Both views are exercised because they share the enrichment mechanism.
 *
 * Expected today: RED — current enrichment selects the first matching active rule
 * and persists that rule's metric_key/vaccine_group on the ambiguous entry.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import type { VaccineRule, View1Evaluation } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/** Synthetic snapshot-time rule carrying the forward identity fields. */
function rule(overrides: Partial<VaccineRule>): VaccineRule {
  return {
    rule_id: 'r-base',
    fiscal_year: 2569,
    age_group: '1yr',
    view_type: 2,
    vaccine_group: 'DTP',
    display_name: 'DTP ซ้ำ',
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

describe('#26 — ambiguous snapshot identity (RED)', () => {
  it('E1: two ACTIVE same-view rules sharing a display_name but differing in lineage leave the View 2 entry identity-less', () => {
    const ambiguous = 'DTP ซ้ำ';
    // Two active View 2 rules, same display_name, DIFFERENT rule_id + metric_key + vaccine_group:
    // neither candidate identity may be chosen arbitrarily for the shared aggregate.
    const ruleA = rule({ rule_id: 'rule-A', view_type: 2, display_name: ambiguous, vaccine_group: 'DTP', metric_key: 'lineage-A' });
    const ruleB = rule({ rule_id: 'rule-B', view_type: 2, display_name: ambiguous, vaccine_group: 'DTP รวมเข็ม', metric_key: 'lineage-B' });
    // The evaluator emits ONE aggregate under the shared display_name (existing name-keyed behavior).
    const summary = calcGroupSummary([record(), record()], emptyV1, evalV2For([ambiguous], []), 2569, [ruleA, ruleB]);

    const entries = summary.view2Breakdown.filter(e => e.name === ambiguous);
    expect(entries.length, 'the evaluator emits one aggregate under the shared display_name').toBe(1);
    const entry = entries[0];
    // Existing numeric/name contract is retained untouched.
    expect(entry.name).toBe(ambiguous);
    expect(entry.passed).toBe(2);
    expect(entry.total).toBe(2);
    expect(entry.coverage).toBe(100);
    // Decision E safety rule: uncertain identity → unavailable — never lineage-A, never lineage-B.
    expect(entry.metric_key).toBeUndefined();
    expect(entry.vaccine_group).toBeUndefined();

    // Serialized snapshot must not persist a false continuity: undefined identity
    // fields are naturally omitted by JSON.
    const restored = JSON.parse(JSON.stringify(summary)) as { view2Breakdown: Record<string, unknown>[] };
    const restoredEntry = restored.view2Breakdown.find(e => e.name === ambiguous);
    expect(restoredEntry).toBeDefined();
    expect('metric_key' in (restoredEntry as object)).toBe(false);
    expect('vaccine_group' in (restoredEntry as object)).toBe(false);
  });

  it('E2: the same safety rule covers the shared enrichment mechanism in View 1', () => {
    const ambiguous = 'HBV ซ้ำ';
    const ruleC = rule({ rule_id: 'rule-C', view_type: 1, display_name: ambiguous, vaccine_group: 'HBV', metric_key: 'lineage-C' });
    const ruleD = rule({ rule_id: 'rule-D', view_type: 1, display_name: ambiguous, vaccine_group: 'HBV รวมเข็ม', metric_key: 'lineage-D' });
    const summary = calcGroupSummary([record()], evalV1For([ambiguous]), evalV2For([], []), 2569, [ruleC, ruleD]);

    const entries = summary.view1Breakdown.filter(e => e.name === ambiguous);
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry.name).toBe(ambiguous);
    expect(entry.passed).toBe(1);
    expect(entry.total).toBe(1);
    expect(entry.coverage).toBe(100);
    expect(entry.metric_key).toBeUndefined();
    expect(entry.vaccine_group).toBeUndefined();
  });
});
