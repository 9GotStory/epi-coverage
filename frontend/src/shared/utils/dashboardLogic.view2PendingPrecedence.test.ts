/**
 * Issue #119 (design #117, ADR-0006) — a Confirmed Missing Dose takes precedence
 * over a Pending Rule in the View 2 summary.
 *
 * Seam under test: `calcGroupSummary()` fed by the REAL `evaluateDynamicV2()` +
 * `markSourceAware()` engine — the same pair the upload flow uses. No engine is
 * stubbed on the View 2 path; a fixed evaluation date keeps age-based results stable.
 *
 * Reported symptom: a young child with BCG past its Target Age and no date, and MMR
 * dose 1 not yet due, was FAIL per child but counted in `view2PendingCount` by the
 * summary — out of the denominator, the failure count and every breakdown.
 *
 * Contract after the fix:
 *   - View 2 Pending = at least one Pending Rule and no Confirmed Missing Dose.
 *   - A child with both is an applicable failure; the Pending Rule stays out of its
 *     own per-rule denominator.
 *   - HDC precedence is unchanged (#101 owns it).
 *   - Exact partition: applicable + View 2 Pending + not evaluable === total.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/** กฎ V2 จำลองจาก seed 1 ปี: BCG (อายุเป้าหมาย 0) + MMR เข็ม 1 (อายุเป้าหมาย 9 เดือน) */
const bcgRule: VaccineRule = {
  rule_id: 'v2-bcg', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'BCG',
  display_name: 'BCG 1 เข็ม', hdc_code: '010',
  required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
  target_age_months: 0,
};
const mmrRule: VaccineRule = {
  rule_id: 'v2-mmr', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'MMR',
  display_name: 'MMR เข็ม 1', hdc_code: '061',
  required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
  target_age_months: 9,
};
/** กฎที่สามซึ่งบางไฟล์ไม่มีคอลัมน์ — ประเมินไม่ได้ ไม่ใช่ขาด */
const dtpRule: VaccineRule = {
  rule_id: 'v2-dtp', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'DTP',
  display_name: 'DTP-HB-Hib เข็ม 1', hdc_code: '091',
  required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
  target_age_months: 2,
};
const rules = markSourceAware([bcgRule, mmrRule]);
const threeRules = markSourceAware([bcgRule, mmrRule, dtpRule]);

const EVALUATION_DATE = new Date('2026-11-11T00:00:00');
/** อายุราว 4 เดือน ณ วันประเมิน: BCG ถึงกำหนดแล้ว MMR เข็ม 1 ยังไม่ถึง */
const YOUNG_BIRTH = '2026-07-01';
/** อายุเกินทุกอายุเป้าหมาย */
const OLDER_BIRTH = '2025-01-01';

const FULL_COLUMNS = { source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date', 'dtp1_date']) };
const NO_DTP_COLUMN = { source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date']) };

const child = (id: string, birth: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth, ...FULL_COLUMNS, ...extra,
});

/** View 1 is out of scope for #119 — a deterministic stub keeps assertions on the V2 path. */
const evalV1 = () => evaluateDynamicV1(
  { hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-x', cid: '0000000000000', name: 'x', lname: 'ทดสอบ', birth: OLDER_BIRTH } as EpiRecord,
  [],
);

const summarize = (data: EpiRecord[], ruleSet: VaccineRule[] = rules) =>
  calcGroupSummary(data, evalV1, (r: EpiRecord): VaccineStatus => evaluateDynamicV2(r, ruleSet, EVALUATION_DATE));

const breakdown = (s: ReturnType<typeof summarize>, name: string) => s.view2Breakdown.find(item => item.name === name);

describe('Issue #119 — Confirmed Missing Dose over Pending Rule in the View 2 summary', () => {
  it('counts a child with a Confirmed Missing Dose and a Pending Rule as an applicable failure', () => {
    const s = summarize([
      child('MISSING-BCG-MMR-NOT-DUE', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '' }),
      // เด็กโตที่ครบทุกเข็ม ทำให้ MMR มีตัวหารจริงเพื่อพิสูจน์ว่าเด็ก pending ไม่ถูกเพิ่มเข้าไป
      child('OLDER-COMPLETE', OLDER_BIRTH, { bcg_date: '2025-01-02', mmr1_date: '2025-10-05' }),
    ]);

    expect(s.view2ApplicableTotal).toBe(2);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2NotEvaluableCount).toBe(0);
    expect(s.view2Passed).toBe(1);
    expect(s.view2Coverage).toBe(50);
    expect(breakdown(s, 'BCG 1 เข็ม')).toMatchObject({ passed: 1, total: 2 });
    // กฎที่ยังไม่ถึงกำหนดไม่เข้าตัวหารรายกฎ แม้เด็กจะอยู่ในตัวหาร View 2
    expect(breakdown(s, 'MMR เข็ม 1')).toMatchObject({ passed: 1, total: 1 });
    expect(s.facilityBreakdownV2[0]).toMatchObject({ hoscode: '00000', total: 2, passed: 1 });
  });

  it('keeps that child an applicable failure when a third rule is also not evaluable', () => {
    const s = summarize(
      [child('MISSING-PENDING-UNKNOWN', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', ...NO_DTP_COLUMN })],
      threeRules,
    );

    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2NotEvaluableCount).toBe(0);
    expect(s.view2Passed).toBe(0);
    expect(breakdown(s, 'BCG 1 เข็ม')).toMatchObject({ passed: 0, total: 1 });
    // กฎที่ประเมินไม่ได้คงแสดงที่ total 0 (#89/#103)
    expect(breakdown(s, 'DTP-HB-Hib เข็ม 1')).toMatchObject({ passed: 0, total: 0 });
    expect(breakdown(s, 'MMR เข็ม 1')).toBeUndefined();
  });

  it('keeps a child with only a Pending Rule as View 2 Pending (#23)', () => {
    const s = summarize([child('ON-SCHEDULE', YOUNG_BIRTH, { bcg_date: '2026-07-02', mmr1_date: '' })]);

    expect(s.view2PendingCount).toBe(1);
    expect(s.view2ApplicableTotal).toBe(0);
    expect(s.view2Passed).toBe(0);
    expect(s.facilityBreakdownV2[0]).toMatchObject({ hoscode: '00000', total: 0, passed: 0 });
  });

  it('keeps a child with only a Pending Rule View 2 Pending under HDC "ไม่ผ่าน" (#23 AC5, unchanged)', () => {
    const s = summarize([child('ON-SCHEDULE-HDC-FAIL', YOUNG_BIRTH, { bcg_date: '2026-07-02', mmr1_date: '', result: 'ไม่ผ่าน' })]);

    expect(s.view2PendingCount).toBe(1);
    expect(s.view2ApplicableTotal).toBe(0);
  });

  it('lets HDC "ผ่าน" still move a missing-plus-pending child into applicable passed (unchanged until #101)', () => {
    const s = summarize([child('HDC-PASS', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', result: 'ผ่าน' })]);

    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2Passed).toBe(1);
    // ข้อยกเว้นเดิม: HDC ผ่าน backfill Pending Rule เข้ากลุ่มผ่าน จึงเข้าตัวหารรายกฎ
    expect(breakdown(s, 'MMR เข็ม 1')).toMatchObject({ passed: 1, total: 1 });
  });

  it('counts a child with a Confirmed Missing Dose and a Pending Rule under HDC "ไม่ผ่าน" as an applicable failure', () => {
    const s = summarize([child('HDC-FAIL', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', result: 'ไม่ผ่าน' })]);

    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2Passed).toBe(0);
    expect(breakdown(s, 'BCG 1 เข็ม')).toMatchObject({ passed: 0, total: 1 });
  });

  it('partitions a mixed cohort exactly into applicable + View 2 Pending + not evaluable', () => {
    const YOUNG_DTP = { dtp1_date: '2026-09-01' };
    const s = summarize([
      child('MISSING-PENDING', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', ...YOUNG_DTP }),
      child('MISSING-PENDING-UNKNOWN', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', ...NO_DTP_COLUMN }),
      child('ON-SCHEDULE', YOUNG_BIRTH, { bcg_date: '2026-07-02', mmr1_date: '', ...YOUNG_DTP }),
      child('ON-SCHEDULE-HDC-FAIL', YOUNG_BIRTH, { bcg_date: '2026-07-02', mmr1_date: '', result: 'ไม่ผ่าน', ...YOUNG_DTP }),
      child('HDC-PASS', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', result: 'ผ่าน', ...YOUNG_DTP }),
      child('HDC-FAIL', YOUNG_BIRTH, { bcg_date: '', mmr1_date: '', result: 'ไม่ผ่าน', ...YOUNG_DTP }),
      child('OLDER-COMPLETE', OLDER_BIRTH, { bcg_date: '2025-01-02', mmr1_date: '2025-10-05', dtp1_date: '2025-03-01' }),
      child('OLDER-NO-DTP-COLUMN', OLDER_BIRTH, { bcg_date: '2025-01-02', mmr1_date: '2025-10-05', ...NO_DTP_COLUMN }),
    ], threeRules);

    // applicable: MISSING-PENDING, MISSING-PENDING-UNKNOWN, HDC-PASS, HDC-FAIL, OLDER-COMPLETE
    // View 2 Pending: ON-SCHEDULE ทั้งสองคน; ประเมินไม่ได้: OLDER-NO-DTP-COLUMN
    expect(s.total).toBe(8);
    expect(s.view2ApplicableTotal).toBe(5);
    expect(s.view2PendingCount).toBe(2);
    expect(s.view2NotEvaluableCount).toBe(1);
    expect(s.view2Passed).toBe(2); // HDC-PASS + OLDER-COMPLETE
    expect(s.view2Coverage).toBe(40);
    expect(s.view2ApplicableTotal + s.view2PendingCount + s.view2NotEvaluableCount).toBe(s.total);
    expect(s.view2Passed).toBeLessThanOrEqual(s.view2ApplicableTotal);
    expect(s.view2ApplicableTotal).toBeLessThanOrEqual(s.total);
    expect(s.facilityBreakdownV2[0]).toMatchObject({ hoscode: '00000', total: 5, passed: 2 });
  });
});
