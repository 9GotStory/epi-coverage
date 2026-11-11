/**
 * Issue #101 regression (supersedes the #97 writer bucket) — the View 2 summary
 * is decided by the configured rules only, so `view2Breakdown` holds vaccine-rule
 * aggregates and never a non-vaccine HDC-verdict bucket.
 *
 * Seam under test: `calcGroupSummary()` fed by the REAL `evaluateDynamicV2()` +
 * `markSourceAware()` engine — the same pair the upload flow uses. Readers still
 * skip `category: 'hdc_verdict'` entries in summaries stored before #101.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/** กฎ V2 จำลองจาก seed 1 ปี: BCG (ALL) + MMR เข็ม 1 (ALL) พร้อม identity ตามสัญญา #26 */
const rules = markSourceAware([
  {
    rule_id: 'v2-bcg', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'BCG',
    display_name: 'BCG 1 เข็ม', hdc_code: '010',
    required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
    target_age_months: 0, metric_key: 'bcg-lineage',
  },
  {
    rule_id: 'v2-mmr', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'MMR',
    display_name: 'MMR เข็ม 1', hdc_code: '061',
    required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
    target_age_months: 9, metric_key: 'mmr-lineage',
  },
]);

/** Synthetic child past every target age; identifier-shaped fields are fake. */
const child = (id: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth: '2022-01-01',
  source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date']),
  ...extra,
});

const evalV1 = () => evaluateDynamicV1(
  { hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-x', cid: '0000000000000', name: 'x', lname: 'ทดสอบ', birth: '2022-01-01' } as EpiRecord,
  [],
);

const summarize = (data: EpiRecord[]) =>
  calcGroupSummary(data, evalV1, (r: EpiRecord): VaccineStatus => evaluateDynamicV2(r, rules), 2569, rules);

describe('Issue #101 — the View 2 summary carries no HDC-verdict bucket', () => {
  it('counts an HDC ไม่ผ่าน child whom the rules pass as an applicable pass, with vaccine-rule entries only', () => {
    const s = summarize([
      child('HDCFAIL', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', result: 'ไม่ผ่าน' }),
    ]);
    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2Passed).toBe(1);
    expect(s.view2Breakdown.map(e => e.name).sort()).toEqual(['BCG 1 เข็ม', 'MMR เข็ม 1']);
    expect(s.view2Breakdown.every(e => e.category === undefined)).toBe(true);
  });

  it('fails closed without View 2 rules — every child not evaluable, never a 100% pass', () => {
    const v1Only = rules.map(rule => ({ ...rule, view_type: 1 }));
    const s = calcGroupSummary(
      [child('A', { bcg_date: '', result: 'ไม่ผ่าน' }), child('B', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05' })],
      evalV1, (r: EpiRecord): VaccineStatus => evaluateDynamicV2(r, v1Only), 2569, v1Only,
    );
    expect(s).toMatchObject({ total: 2, view2Passed: 0, view2ApplicableTotal: 0, view2PendingCount: 0, view2NotEvaluableCount: 2, view2Coverage: 0 });
  });

  it('keeps metric_key identity on the vaccine-rule entries', () => {
    const s = summarize([
      child('PASS', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05' }),
      child('HDCFAIL', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', result: 'ไม่ผ่าน' }),
    ]);
    expect(s.view2Breakdown.find(e => e.name === 'BCG 1 เข็ม')).toMatchObject({ metric_key: 'bcg-lineage', passed: 2, total: 2 });
    expect(s.view2Breakdown.find(e => e.name === 'MMR เข็ม 1')).toMatchObject({ metric_key: 'mmr-lineage', passed: 2, total: 2 });
  });
});
