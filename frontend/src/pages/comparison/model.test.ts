import { describe, expect, it } from 'vitest';
import type { DashboardSummaryData, DashboardSummaryRow, EpiTargetTable } from '../../shared/types/dashboardSummary';
import {
  COMPARISON_AGE_GROUPS,
  buildAnnualComparisonModel,
  getComparisonFiscalYears,
  getDefaultComparisonYears,
} from './model';

/**
 * Ticket #46 — test-first pure annual-dashboard comparison contract.
 * Fixtures are entirely synthetic aggregate snapshots. No persons or real datasets.
 * The existing backend remains the authority for _all > legacy annual row precedence.
 */
function annualRow(
  targetTable: EpiTargetTable,
  fiscalYear: number,
  data: Partial<DashboardSummaryData> = {},
): DashboardSummaryRow {
  return {
    id: targetTable + '_' + fiscalYear + '_all',
    targetTable,
    fiscalYear,
    updated_at: '2026-09-20T14:30:00.000Z',
    summaryData: {
      total: 100,
      view1Coverage: 80,
      view1PassedDoses: 80,
      view1TotalDoses: 100,
      view2Coverage: 90,
      view2Passed: 90,
      view2ApplicableTotal: 100,
      view2PendingCount: 0,
      ...data,
    },
  };
}

const age = (model: ReturnType<typeof buildAnnualComparisonModel>, group: EpiTargetTable) => {
  const entry = model.ageGroups.find(item => item.targetTable === group);
  expect(entry, 'must render all four group identities').toBeDefined();
  return entry!;
};

describe('Ticket #46 — fiscal-year authority and cross-group selector', () => {
  it('T01 unions only usable annual years from all four age groups, without duplicates or clock years', () => {
    const years = getComparisonFiscalYears({
      Epi_1_Year: [2569, 2567, 2569],
      Epi_2_Year: [2568],
      Epi_3_Year: [2566, 2569],
      Epi_5_Year: [],
      UnrelatedTable: [2599],
    });
    expect(years).toEqual([2566, 2567, 2568, 2569]);
    expect(getDefaultComparisonYears(years)).toEqual([2568, 2569]);
    expect(getDefaultComparisonYears([2569])).toEqual([2569]);
    expect(getDefaultComparisonYears([])).toEqual([]);
    expect(getComparisonFiscalYears({ Epi_2_Year: [2569] })).toEqual([2569]);
  });

  it('T02 retains four groups in 1/2/3/5 order and normalizes selected years ascending/deduplicated', () => {
    const model = buildAnnualComparisonModel(
      [annualRow('Epi_2_Year', 2568), annualRow('Epi_1_Year', 2569)],
      [2569, 2567, 2569, 2568],
      () => undefined,
    );
    expect(model.selectedYears).toEqual([2567, 2568, 2569]);
    expect(model.ageGroups.map(item => item.targetTable)).toEqual(
      COMPARISON_AGE_GROUPS.map(item => item.targetTable),
    );
    expect(model.ageGroups.map(item => item.view1.map(point => point.fiscalYear))).toEqual([
      [2567, 2568, 2569], [2567, 2568, 2569],
      [2567, 2568, 2569], [2567, 2568, 2569],
    ]);
    expect(age(model, 'Epi_1_Year').view2[0].state).toBe('no-summary');
    expect(age(model, 'Epi_2_Year').view2[2].state).toBe('no-summary');
    expect(buildAnnualComparisonModel([], [], () => undefined).ageGroups.every(item =>
      item.view1.length === 0 && item.view2.length === 0,
    )).toBe(true);
  });
});

describe('Ticket #46 — View 1 and View 2 measurement boundaries', () => {
  it('T03 does not mix dose-level View 1 and person-level View 2 coverage, counts or targets', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_1_Year', 2569, {
        view1Coverage: 72.5, view1PassedDoses: 145, view1TotalDoses: 200,
        view2Coverage: 60, view2Passed: 30, view2ApplicableTotal: 50,
        view2PendingCount: 50,
      }),
    ], [2569], (view) => view === 1 ? 95 : 90);
    const group = age(model, 'Epi_1_Year');
    expect(group.view1[0]).toMatchObject({
      state: 'available', coverage: 72.5, numerator: 145, denominator: 200, target: 95,
      pending: null, failed: null,
    });
    expect(group.view2[0]).toMatchObject({
      state: 'available', coverage: 60, numerator: 30, denominator: 50,
      pending: 50, failed: 20, target: 90,
    });
    expect(group.view1[0].delta).toBeNull();
    expect(group.view2[0].delta).toBeNull();
  });

  it('T04 keeps a missing annual group/FY distinct from a genuine 0 percent of positive denominator', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_5_Year', 2569, {
        view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 12,
        view2Coverage: 0, view2Passed: 0, view2ApplicableTotal: 7, view2PendingCount: 5,
      }),
    ], [2569], () => undefined);
    expect(age(model, 'Epi_1_Year').view1[0]).toMatchObject({
      state: 'no-summary', coverage: null, updatedAt: null,
    });
    expect(age(model, 'Epi_5_Year').view1[0]).toMatchObject({
      state: 'available', coverage: 0, numerator: 0, denominator: 12,
    });
    expect(age(model, 'Epi_5_Year').view2[0]).toMatchObject({
      state: 'available', coverage: 0, numerator: 0, denominator: 7, failed: 7,
    });
  });

  it('T05 does not chart a fake 0% when View 1 or View 2 has a known zero denominator', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_3_Year', 2569, {
        view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 0,
        view2Coverage: 0, view2Passed: 0, view2ApplicableTotal: 0, view2PendingCount: 10,
      }),
    ], [2569], () => 90);
    expect(age(model, 'Epi_3_Year').view1[0]).toMatchObject({
      state: 'not-evaluable', coverage: null, numerator: 0, denominator: 0, target: 90,
    });
    expect(age(model, 'Epi_3_Year').view2[0]).toMatchObject({
      state: 'not-evaluable', coverage: null, numerator: 0, denominator: 0, pending: 10,
    });
  });

  it('T06 preserves supported legacy V2 coverage without inventing denominator, failed or pending', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_1_Year', 2568, {
        total: 100, view2Coverage: 80, view2Passed: 8,
        view2ApplicableTotal: undefined, view2PendingCount: undefined,
        view1Coverage: undefined, view1PassedDoses: undefined, view1TotalDoses: undefined,
      }),
    ], [2568], () => undefined);
    expect(age(model, 'Epi_1_Year').view2[0]).toMatchObject({
      state: 'legacy-denominator-unavailable', coverage: 80, numerator: 8,
      denominator: null, failed: null, pending: null,
    });
    expect(age(model, 'Epi_1_Year').view1[0]).toMatchObject({
      state: 'metric-unavailable', coverage: null, numerator: null, denominator: null,
    });
  });
});

describe('Ticket #46 — change detection, provenance and safety', () => {
  it('T07 finds deltas only within same age/view across actual selected FYs including gaps and flat results', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_1_Year', 2567, { view1Coverage: 80, view2Coverage: 70 }),
      annualRow('Epi_1_Year', 2569, { view1Coverage: 80, view2Coverage: 90 }),
      annualRow('Epi_2_Year', 2567, { view1Coverage: 40, view2Coverage: 80 }),
      annualRow('Epi_2_Year', 2569, { view1Coverage: 60, view2Coverage: 50 }),
    ], [2569, 2568, 2567], () => undefined);
    const first = age(model, 'Epi_1_Year');
    const second = age(model, 'Epi_2_Year');
    expect(first.view1[0].delta).toBeNull();
    expect(first.view1[1].delta).toBeNull();
    expect(first.view1[2].delta).toEqual({ previousFiscalYear: 2567, points: 0 });
    expect(first.view2[2].delta?.previousFiscalYear).toBe(2567);
    expect(first.view2[2].delta?.points).toBeCloseTo(20);
    expect(second.view1[2].delta?.points).toBeCloseTo(20);
    expect(second.view2[2].delta?.points).toBeCloseTo(-30);
    expect(second.view2[1].coverage).toBeNull();
  });

  it('T08 resolves per-view/FY targets independently and keeps original computation timestamps', () => {
    const first = annualRow('Epi_1_Year', 2568);
    const second = { ...annualRow('Epi_1_Year', 2569), updated_at: '2026-09-23T12:22:00.000Z' };
    const model = buildAnnualComparisonModel(
      [first, second],
      [2568, 2569],
      (view, fiscalYear) => view === 1 ? (fiscalYear === 2568 ? 87 : 92) : (fiscalYear === 2569 ? 90 : undefined),
    );
    const group = age(model, 'Epi_1_Year');
    expect(group.view1.map(point => point.target)).toEqual([87, 92]);
    expect(group.view2.map(point => point.target)).toEqual([null, 90]);
    expect(group.view1[1].updatedAt).toBe('2026-09-23T12:22:00.000Z');
    expect(group.view2[0].updatedAt).toBe(first.updated_at);
  });

  it('T09 rejects invalid metric numbers and denominator inconsistencies instead of producing NaN charts', () => {
    const model = buildAnnualComparisonModel([
      annualRow('Epi_1_Year', 2568, {
        view1Coverage: Number.NaN, view2Coverage: Number.POSITIVE_INFINITY,
      }),
      annualRow('Epi_1_Year', 2569, {
        view1Coverage: 105, view2Coverage: 90,
        view2ApplicableTotal: 10, view2Passed: 90, view2PendingCount: 0,
      }),
    ], [2569, 2568], () => Number.NaN);
    expect(age(model, 'Epi_1_Year').view1[0].coverage).toBeNull();
    expect(age(model, 'Epi_1_Year').view2[0].state).toBe('metric-unavailable');
    expect(age(model, 'Epi_1_Year').view1[1].state).toBe('metric-unavailable');
    expect(age(model, 'Epi_1_Year').view2[1].state).toBe('metric-unavailable');
    expect(age(model, 'Epi_1_Year').view2[1].target).toBeNull();
  });

  it('T10 does not mutate stored aggregate snapshots or years passed by the caller', () => {
    const rows = [annualRow('Epi_1_Year', 2568), annualRow('Epi_1_Year', 2569)];
    const years = [2569, 2568];
    const originalRows = structuredClone(rows);
    buildAnnualComparisonModel(rows, years, () => 90);
    expect(rows).toEqual(originalRows);
    expect(years).toEqual([2569, 2568]);
  });

  it('T11 fails closed if the backend unexpectedly returns two annual rows for one group/FY', () => {
    const one = annualRow('Epi_1_Year', 2569);
    const two = { ...one, id: 'Epi_1_Year_2569_legacy' };
    expect(() => buildAnnualComparisonModel([one, two], [2569], () => 90)).toThrow();
  });

  it('T12 preserves configured target 0, while missing target is not silently 0', () => {
    const model = buildAnnualComparisonModel(
      [annualRow('Epi_1_Year', 2569)],
      [2569],
      view => view === 1 ? 0 : undefined,
    );
    expect(age(model, 'Epi_1_Year').view1[0].target).toBe(0);
    expect(age(model, 'Epi_1_Year').view2[0].target).toBeNull();
  });
});
