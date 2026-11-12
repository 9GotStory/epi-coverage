import { describe, it, expect } from 'vitest';
import { evaluateDynamicV1, evaluateDynamicV2 } from './ruleEngine';
import type { VaccineRule } from './ruleEngine';
import type { EpiRecord } from '../../types';

// Issue #102 (ADR-0006 ข้อ 4): คำเตือนวันที่ = "ตรวจสอบประวัติ" ไม่ใช่เข็มขาด
const noChecks = { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] };
const rule = (overrides: Partial<VaccineRule>): VaccineRule => ({
  rule_id: 'r', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'DTP',
  display_name: 'DTP ครบ 3 เข็ม', hdc_code: '', required_fields: ['dtp1_date', 'dtp2_date', 'dtp3_date'],
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, date_checks: noChecks, ...overrides,
});
const dtp = rule({
  rule_id: 'dtp',
  date_checks: { ...noChecks, same_day_pairs: [{ field: 'dtp2_date', other_field: 'dtp3_date' }] },
});
const mmr = rule({ rule_id: 'mmr', vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', required_fields: ['mmr1_date'], target_age_months: 9 });
const child: EpiRecord = {
  hoscode: '00001', hosname: 'Synthetic', pid: '1', cid: '0000000000001', name: 'ทดสอบ', lname: 'สังเคราะห์',
  birth: '2024-01-01', dtp1_date: '2024-03-01', dtp2_date: '2024-05-01', dtp3_date: '2024-07-01', mmr1_date: '2024-10-01',
};
const asOf = new Date('2025-02-01');

describe('evaluateDynamicV1 — ตรวจสอบประวัติ (Issue #102)', () => {
  const dtp1 = rule({ rule_id: 'dtp1', view_type: 1, display_name: 'DTP เข็ม 1', required_fields: ['dtp1_date'] });
  const dtp3 = rule({ rule_id: 'dtp3', view_type: 1, display_name: 'DTP เข็ม 3', required_fields: ['dtp3_date'] });

  it('a dose rule with only a date warning is a review rule — not passed, not missing', () => {
    const result = evaluateDynamicV1({ ...child, dtp1_date: '2023-12-31' }, [dtp1, dtp3], asOf);
    expect(result).toMatchObject({ missingVaccines: [], reviewRuleNames: ['DTP เข็ม 1'], passedCount: 1, results: { 'DTP เข็ม 1': false, 'DTP เข็ม 3': true } });
  });

  it('a blank date is still missing', () => {
    const result = evaluateDynamicV1({ ...child, dtp1_date: '2023-12-31', dtp3_date: '' }, [dtp1, dtp3], asOf);
    expect(result).toMatchObject({ missingVaccines: ['DTP เข็ม 3'], reviewRuleNames: ['DTP เข็ม 1'] });
  });
});

describe('evaluateDynamicV2 — ตรวจสอบประวัติ (Issue #102)', () => {
  it('a child whose only problem is a date warning is REVIEW, not FAIL, and HDC ผ่าน is no mismatch', () => {
    const result = evaluateDynamicV2({ ...child, dtp3_date: '2024-05-01', result: 'ผ่าน' }, [dtp, mmr], asOf);
    expect(result).toMatchObject({
      status: 'REVIEW', isFullyImmunized: false,
      missingVaccines: [], reviewVaccines: ['DTP ครบ 3 เข็ม'], passedVaccines: ['MMR เข็ม 1'],
      hdcVerdict: 'PASS', hdcMismatch: false,
    });
  });

  it('a blank required date wins over a date warning in the same rule — Confirmed Missing Dose, still a mismatch with HDC ผ่าน', () => {
    const result = evaluateDynamicV2({ ...child, dtp1_date: '2023-12-31', dtp3_date: '', result: 'ผ่าน' }, [dtp, mmr], asOf);
    expect(result).toMatchObject({ status: 'FAIL', missingVaccines: ['DTP ครบ 3 เข็ม'], reviewVaccines: [], hdcMismatch: true });
  });

  it('a non-empty date in a wrong format is a date to review, not a missing dose', () => {
    const result = evaluateDynamicV2({ ...child, dtp2_date: '01/05/2567' }, [dtp, mmr], asOf);
    expect(result).toMatchObject({ status: 'REVIEW', missingVaccines: [], reviewVaccines: ['DTP ครบ 3 เข็ม'] });
  });

  it('precedence: Confirmed Missing Dose > ตรวจสอบประวัติ > View 2 Pending > ประเมินไม่ได้', () => {
    const review = { ...child, dtp3_date: '2024-05-01' };
    // อีกกฎขาดจริง → FAIL
    expect(evaluateDynamicV2({ ...review, mmr1_date: '' }, [dtp, mmr], asOf).status).toBe('FAIL');
    // อีกกฎยังไม่ถึงอายุเป้าหมาย → REVIEW
    expect(evaluateDynamicV2({ ...review, mmr1_date: '' }, [dtp, mmr], new Date('2024-08-01'))).toMatchObject({ status: 'REVIEW', pendingVaccines: ['MMR เข็ม 1'] });
    // อีกกฎไฟล์ไม่มีคอลัมน์ → REVIEW
    const noMmrColumn = { ...review, mmr1_date: undefined, source_columns: JSON.stringify(['dtp1_date', 'dtp2_date', 'dtp3_date']) };
    expect(evaluateDynamicV2(noMmrColumn, [dtp, { ...mmr, source_aware: true }], asOf)).toMatchObject({ status: 'REVIEW', notEvaluableVaccines: ['MMR เข็ม 1'] });
  });

  it('a not-yet-due rule stays Pending even when its other dates carry a warning', () => {
    const result = evaluateDynamicV2({ ...child, dtp1_date: '2023-12-31', dtp3_date: '' }, [{ ...dtp, target_age_months: 6 }], new Date('2024-06-15'));
    expect(result).toMatchObject({ status: 'PENDING', pendingVaccines: ['DTP ครบ 3 เข็ม'], reviewVaccines: [] });
  });
});

describe('warning scope covers every date of the rule (owner decision 2026-11-12, Issue #102)', () => {
  const rota = rule({
    rule_id: 'rota', vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วน)', logic_type: 'BRANCH',
    required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'],
  });
  const anyOpv = rule({ rule_id: 'opv', vaccine_group: 'OPV', display_name: 'OPV อย่างน้อย 1 เข็ม', logic_type: 'ANY', required_fields: ['opv1_date', 'opv2_date'] });

  it('a stray warning on the unused BRANCH path still makes the rule ตรวจสอบประวัติ', () => {
    const record = { ...child, rv21_date: '2024-03-01', rv22_date: '2024-05-01', rv31_date: '2023-12-31' };
    expect(evaluateDynamicV2(record, [rota], asOf)).toMatchObject({ status: 'REVIEW', reviewVaccines: ['Rota (ครบถ้วน)'] });
  });

  it('a warning on another dose of an ANY rule still makes the rule ตรวจสอบประวัติ', () => {
    const record = { ...child, opv1_date: '2024-03-01', opv2_date: '2023-12-31' };
    expect(evaluateDynamicV2(record, [anyOpv], asOf)).toMatchObject({ status: 'REVIEW', reviewVaccines: ['OPV อย่างน้อย 1 เข็ม'] });
  });
});
