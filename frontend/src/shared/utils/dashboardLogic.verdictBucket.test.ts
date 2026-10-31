/**
 * Issue #97 regression — the HDC-verdict bucket in `view2Breakdown` is NOT a
 * vaccine and must never be counted as a "vaccine without a link key".
 *
 * Seam under test: `calcGroupSummary()` fed by the REAL `evaluateDynamicV2()` +
 * `markSourceAware()` engine — the same pair the upload flow uses. The verdict
 * bucket (ลำดับความสำคัญ #89: คำตัดสิน HDC > กฎในระบบ > ประเมินไม่ได้) is emitted
 * into `missingVaccines` under its display name; it matches no vaccine rule, so
 * it intentionally carries no `metric_key`. Writer contract (#97 A): the summary
 * writer labels such non-vaccine buckets explicitly (`category: 'hdc_verdict'`)
 * so readers never have to guess from the display name.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2, HDC_VERDICT_BUCKETS, markSourceAware } from './vaccine/ruleEngine';
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

describe('Issue #97 — writer labels the HDC-verdict bucket, not just its name', () => {
  it("an HDC ไม่ผ่าน child with no local missing yields a breakdown entry with category 'hdc_verdict' and no metric_key", () => {
    // เด็กครบทุกเข็มตามกฎในระบบ แต่ HDC ตัดสิน "ไม่ผ่าน" → engine ปล่อย verdict bucket เข้า missingVaccines
    const s = summarize([
      child('HDCFAIL', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', result: 'ไม่ผ่าน' }),
    ]);
    const bucket = s.view2Breakdown.find(e => e.name === HDC_VERDICT_BUCKETS.fail);
    expect(bucket).toBeDefined();
    expect(bucket).toMatchObject({ category: 'hdc_verdict', metric_key: undefined, vaccine_group: undefined });
    // ตัวเลขเดิมไม่เปลี่ยน — category เป็นการติดป้ายเชิงสัญญาเท่านั้น
    expect(bucket).toMatchObject({ passed: 0, total: 1, coverage: 0 });
  });

  it('real vaccine-rule aggregates stay unlabelled — category is reserved for non-vaccine buckets', () => {
    const s = summarize([
      child('PASS', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05' }),
      child('HDCFAIL', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', result: 'ไม่ผ่าน' }),
    ]);
    const bcg = s.view2Breakdown.find(e => e.name === 'BCG 1 เข็ม');
    const mmr = s.view2Breakdown.find(e => e.name === 'MMR เข็ม 1');
    expect(bcg?.category).toBeUndefined();
    expect(mmr?.category).toBeUndefined();
    expect(bcg?.metric_key).toBe('bcg-lineage');
    expect(mmr?.metric_key).toBe('mmr-lineage');
  });

  it('a verdict bucket never inherits a metric_key even if a rule shares its display name (fail closed)', () => {
    const poisoned = markSourceAware([
      ...rules,
      {
        rule_id: 'v2-lookalike', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'HDC',
        display_name: HDC_VERDICT_BUCKETS.fail, hdc_code: '999',
        required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
        metric_key: 'lookalike-lineage',
      },
    ]);
    const s = calcGroupSummary(
      [child('HDCFAIL', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', result: 'ไม่ผ่าน' })],
      evalV1,
      (r: EpiRecord): VaccineStatus => evaluateDynamicV2(r, poisoned),
      2569,
      poisoned,
    );
    const bucket = s.view2Breakdown.find(e => e.name === HDC_VERDICT_BUCKETS.fail);
    expect(bucket?.category).toBe('hdc_verdict');
    expect(bucket?.metric_key).toBeUndefined();
  });
});
