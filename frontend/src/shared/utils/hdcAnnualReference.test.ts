import { describe, expect, it } from 'vitest';
import type { VaccineBreakdownEntry } from '../types/dashboardSummary';
import type { VaccineRule } from './vaccine/ruleEngine';
import { findHdcEpi1Metric, summarizeHdcEpi1 } from './hdcAnnualReference';

const REPORT_ID = 'c88658f4d09acb8c76e6c06ffb58ebaf';

// Aggregate-only fixture with all required month columns; no person data.
function hdcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const months = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
  const fields: Record<string, unknown> = {
    id: REPORT_ID, b_year: '2569', hospcode: '06413',
    areacode: '54060101', date_com: '20261007231223',
  };
  for (const month of months) {
    fields[`target${month}`] = 0;
    for (const metric of ['bcg', 'dtp1', 'dtp2']) fields[`${metric}_${month}`] = 0;
  }
  return { ...fields, target10: 100, target11: 81,
    bcg_10: 99, bcg_11: 81,
    dtp1_10: 98, dtp1_11: 80,
    dtp2_10: 99, dtp2_11: 80, ...overrides };
}

function rule(code: string, field: string, name: string, overrides: Partial<VaccineRule> = {}): VaccineRule {
  return {
    rule_id: `id-${code}`, fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: code === '010' ? 'BCG' : 'DTP', display_name: name,
    hdc_code: code, required_fields: [field], logic_type: 'ALL', is_active: true,
    is_required_for_v2: true, ...overrides,
  };
}

describe('HDC OpenData annual EPI1 reference', () => {
  it('sums 12 monthly numerators/targets as counts, not an average of percentages', () => {
    const result = summarizeHdcEpi1([hdcRow()], 2569);
    expect(result).not.toBeNull();
    expect(result?.target).toBe(181);
    expect(result?.numerators).toEqual({ bcg: 180, dtp1: 178, dtp2: 179 });
    expect(result?.dateCom).toBe('20261007231223');
    expect(result?.rowCount).toBe(1);
  });

  it('keeps only Song district rows of the exact report and fiscal year, including on proxy fallback', () => {
    const result = summarizeHdcEpi1([
      hdcRow({ hospcode: '06413', areacode: '54060101' }),
      hdcRow({ hospcode: '06414', areacode: '54060102',
        target10: 2, target11: 0, bcg_10: 1, bcg_11: 0, dtp1_10: 1, dtp1_11: 0, dtp2_10: 1, dtp2_11: 0 }),
      hdcRow({ areacode: '54070101' }),
      hdcRow({ b_year: '2568' }),
      hdcRow({ id: 'another-report' }),
    ], 2569);
    expect(result?.target).toBe(183);
    expect(result?.numerators.bcg).toBe(181);
    expect(result?.rowCount).toBe(2);
    expect(summarizeHdcEpi1([hdcRow({ b_year: '2570' })], 2569)).toBeNull();
  });

  it('rejects duplicate locality/facility rows, mixed snapshots, malformed and missing counters', () => {
    expect(() => summarizeHdcEpi1([hdcRow(), hdcRow()], 2569)).toThrow();
    expect(() => summarizeHdcEpi1([hdcRow(), hdcRow({areacode:'54060102', date_com:'20261008231223'})], 2569)).toThrow();
    expect(() => summarizeHdcEpi1([hdcRow({ bcg_10: -1 })], 2569)).toThrow();
    expect(() => summarizeHdcEpi1([hdcRow({ dtp1_11: 'not-a-number' })], 2569)).toThrow();
    expect(() => summarizeHdcEpi1([hdcRow({ bcg_10: null })], 2569)).toThrow();
    const incomplete = hdcRow();
    delete incomplete.dtp2_09;
    expect(() => summarizeHdcEpi1([incomplete], 2569)).toThrow();
    expect(() => summarizeHdcEpi1([hdcRow({ target10: 1, bcg_10: 99 })], 2569)).toThrow();
  });

  it('rejects totals that cannot be evaluated and never fabricates zero percentages', () => {
    const months = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
    const empty = hdcRow(Object.fromEntries(months.flatMap(m => [
      [`target${m}`, 0], [`bcg_${m}`, 0], [`dtp1_${m}`, 0], [`dtp2_${m}`, 0],
    ])));
    expect(() => summarizeHdcEpi1([empty], 2569)).toThrow();
  });
});

describe('HDC EPI1 mapping (evidence-gated)', () => {
  it('matches only confirmed rules and snapshot identities, not names alone', () => {
    const r = rule('010', 'bcg_date', 'BCG');
    const item: VaccineBreakdownEntry = { name:'BCG', metric_key:r.rule_id, passed:178, total:181, coverage:98.34 };
    expect(findHdcEpi1Metric(item, [r], 2569)).toBe('bcg');
    expect(findHdcEpi1Metric(item, [r], 2570)).toBeNull();
    expect(findHdcEpi1Metric({...item, metric_key:undefined}, [r], 2569)).toBeNull();
    expect(findHdcEpi1Metric({...item, metric_key:'another'}, [r], 2569)).toBeNull();
    expect(findHdcEpi1Metric(item, [r, {...r, rule_id:'other'}], 2569)).toBeNull();
    expect(findHdcEpi1Metric(item, [r], 2569)).not.toBe('dtp1');
  });

  it('maps DTP months 2/4, but never treats DTP-HB3 as automatically equivalent to DTP month 6', () => {
    const one=rule('031','dtp1_date','DTP เข็ม 1');
    const two=rule('032','dtp2_date','DTP เข็ม 2');
    const three=rule('033','dtp3_date','DTP เข็ม 3');
    const item=(r:VaccineRule):VaccineBreakdownEntry=>({name:r.display_name, metric_key:r.rule_id, passed:1,total:2,coverage:50});
    expect(findHdcEpi1Metric(item(one),[one,two,three],2569)).toBe('dtp1');
    expect(findHdcEpi1Metric(item(two),[one,two,three],2569)).toBe('dtp2');
    expect(findHdcEpi1Metric(item(three),[one,two,three],2569)).toBeNull();
    expect(findHdcEpi1Metric(item(one),[{...one,required_fields:['dtp2_date']}],2569)).toBeNull();
    expect(findHdcEpi1Metric(item(one),[{...one,is_active:false}],2569)).toBeNull();
  });
});
