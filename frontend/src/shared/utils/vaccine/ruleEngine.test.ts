import { describe, it, expect } from 'vitest';
import { hasDose, getDataErrors, evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from './ruleEngine';
import type { VaccineRule } from './ruleEngine';
import type { EpiRecord } from '../../types';

describe('ruleEngine', () => {
  const mockRecord: EpiRecord = {
    hoscode: '00000',
    hosname: 'Mock',
    pid: '000000',
    cid: '1234567890123',
    name: 'Test',
    lname: 'User',
    birth: '2022-01-01',
    bcg_date: '2022-01-01',
    hbv1_date: '2022-01-01',
    dtp1_date: '2022-03-01',
    dtp2_date: '2022-05-01',
    dtp3_date: '2022-07-01',
    rv21_date: '2022-03-01',
    rv22_date: '2022-05-01',
    rv33_date: '-', // No 3rd dose
  };

  describe('hasDose', () => {
    it('returns true if field has a valid date string', () => {
      expect(hasDose(mockRecord, 'dtp1_date')).toBe(true);
    });

    it('returns false if field is "-" or empty', () => {
      expect(hasDose(mockRecord, 'rv33_date')).toBe(false);
      expect(hasDose(mockRecord, 'je1_date')).toBe(false);
    });

    it('returns true for a birth-dose vaccine given on the birth date when allowOnBirth=true (จาก config)', () => {
      // allowOnBirth มาจาก rule.target_age_months === 0 เท่านั้น — ไม่มีการเดาจากชื่อ field
      expect(hasDose(mockRecord, 'bcg_date', true)).toBe(true);
      expect(hasDose(mockRecord, 'hbv1_date', true)).toBe(true);
    });

    it('returns false for a dose on the birth date when allowOnBirth=false (ไม่มี fallback)', () => {
      // rule ไม่ได้ตั้ง target_age_months = 0 → วันที่ตรงวันเกิด = ข้อมูลผิด = ยังไม่ได้รับ
      expect(hasDose(mockRecord, 'bcg_date', false)).toBe(false);
      expect(hasDose(mockRecord, 'bcg_date')).toBe(false);
    });

    it('returns false for a NON-birth-dose vaccine entered as the birth date (HDC ไม่นับ)', () => {
      const rec: EpiRecord = { ...mockRecord, dtp1_date: '2022-01-01' };
      expect(hasDose(rec, 'dtp1_date')).toBe(false);
    });

    it('returns false when the date is before the birth date', () => {
      const rec: EpiRecord = { ...mockRecord, dtp1_date: '2021-12-31' };
      expect(hasDose(rec, 'dtp1_date')).toBe(false);
    });
  });

  describe('getDataErrors (birth-dose vaccines)', () => {
    // จำลอง rule ของ BCG/HBV1 ที่ config target_age_months = 0 (birth dose) ตาม seed จริง
    const birthDoseRules: VaccineRule[] = [
      { rule_id: 'bcg', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'BCG', display_name: 'BCG (010)', hdc_code: '010',
        required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0 },
      { rule_id: 'hbv1', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (041)', hdc_code: '041',
        required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0 },
      { rule_id: 'dtp1', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'DTP', display_name: 'DTP1 (031)', hdc_code: '031',
        required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true },
    ];

    it('does NOT flag BCG/HBV1 when given on the birth date (birth-dose)', () => {
      // เด็กเกิดและได้ BCG+HBV1 วันเดียวกัน → ถูกต้อง ห้ามฟ้อง "ข้อมูลวันที่ผิด"
      const rec: EpiRecord = {
        ...mockRecord,
        birth: '2024-10-08', bcg_date: '2024-10-08', hbv1_date: '2024-10-08',
        dtp1_date: undefined as unknown as string, // กัน dtp1 เก่าของ mock ตอนแปลงเป็น before-birth
      };
      const errors = getDataErrors(rec, birthDoseRules);
      expect(errors).not.toContain('BCG (010)');
      expect(errors).not.toContain('HBV เข็ม 1 (041)');
      expect(errors).toEqual([]);
    });

    it('flags a non-birth-dose vaccine (DTP1) when entered as the birth date', () => {
      // DTP1 ไม่ใช่วัคซีนแรกเกิด ถ้าลงเป็นวันเกิด = ผิด
      const rec: EpiRecord = { ...mockRecord, birth: '2024-10-08', dtp1_date: '2024-10-08' };
      const errors = getDataErrors(rec, birthDoseRules);
      expect(errors).toContain('DTP1 (031) (DTP เข็ม 1: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต)');
    });

    it('flags any vaccine when the date is before the birth date', () => {
      const rec: EpiRecord = { ...mockRecord, birth: '2024-10-08', bcg_date: '2024-10-07' };
      const errors = getDataErrors(rec, birthDoseRules);
      expect(errors).toContain('BCG (010) (BCG: วันที่ฉีดก่อนวันเกิด)');
    });

    it('flags a birth-date dose when the rule does NOT config target_age_months=0 (config คือความจริงเดียว)', () => {
      // อธิบาย contract: ถ้าไม่ config ระบบจะไม่เดาให้ — ต้องตั้ง target_age_months ใน rule เสมอ
      const noConfigRules: VaccineRule[] = [
        { ...birthDoseRules[0], rule_id: 'bcg-noconf', target_age_months: undefined },
      ];
      const rec: EpiRecord = { ...mockRecord, birth: '2024-10-08', bcg_date: '2024-10-08' };
      const errors = getDataErrors(rec, noConfigRules);
      expect(errors).toContain('BCG (010) (BCG: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต)');
    });
  });

  describe('evaluateDynamicV1 & V2', () => {
    const rules: VaccineRule[] = [
      {
        rule_id: '1', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'DTP', display_name: 'DTP1', hdc_code: '031',
        required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true
      },
      {
        rule_id: '2', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'Rota', display_name: 'Rota1', hdc_code: 'R11/R21',
        required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, is_active: true
      },
      {
        rule_id: '3', fiscal_year: 2568, age_group: '1yr', view_type: 2,
        vaccine_group: 'DTP', display_name: 'DTP ครบ 3 เข็ม', hdc_code: '031-033',
        required_fields: ['dtp1_date', 'dtp2_date', 'dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true
      },
      {
        rule_id: '4', fiscal_year: 2568, age_group: '1yr', view_type: 2,
        vaccine_group: 'Rota', display_name: 'Rota (ครบ)', hdc_code: '',
        required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, is_active: true
      }
    ];

    it('evaluateDynamicV1 - ALL logic (passed)', () => {
      const result = evaluateDynamicV1(mockRecord, rules);
      expect(result.results['DTP1']).toBe(true);
      expect(result.missingVaccines).not.toContain('DTP1');
    });

    it('evaluateDynamicV1 - BRANCH logic (path 1 passed)', () => {
      const result = evaluateDynamicV1(mockRecord, rules);
      expect(result.results['Rota1']).toBe(true);
    });

    it('evaluateDynamicV2 - ALL logic (passed)', () => {
      const result = evaluateDynamicV2(mockRecord, rules);
      expect(result.passedVaccines).toContain('DTP ครบ 3 เข็ม');
    });

    it('evaluateDynamicV2 - BRANCH logic (path 1 passed)', () => {
      const result = evaluateDynamicV2(mockRecord, rules);
      expect(result.passedVaccines).toContain('Rota (ครบ)');
      expect(result.isFullyImmunized).toBe(true);
    });

    it('evaluateDynamicV2 - ALL logic (missing dose)', () => {
      const incompleteRecord = { ...mockRecord, dtp3_date: '-' };
      const result = evaluateDynamicV2(incompleteRecord, rules);
      expect(result.passedVaccines).not.toContain('DTP ครบ 3 เข็ม');
      expect(result.missingVaccines).toContain('DTP ครบ 3 เข็ม');
      expect(result.isFullyImmunized).toBe(false);
    });

    it('suppresses missing when the rule has a data error (แสดงเฉพาะ data error)', () => {
      // dtp1 ลงเป็นวันเกิด → rule ไม่ผ่าน และมี data error → ต้องไม่โผล่ใน missingVaccines ซ้ำ
      const rec: EpiRecord = { ...mockRecord, dtp1_date: '2022-01-01' };
      const result = evaluateDynamicV1(rec, rules);
      expect(result.results['DTP1']).toBe(false);
      expect(result.missingVaccines).not.toContain('DTP1');
      expect(getDataErrors(rec, rules)).toContain('DTP1 (DTP เข็ม 1: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต)');
    });

    it('classifies a not-yet-due child as PENDING and reports pendingRuleNames', () => {
      // MMR1 เกณฑ์อายุ 9 เดือน — เด็กอายุ 4 เดือน (ณ evaluationDate) ต้องเป็น pending ไม่ใช่ missing
      const mmrRule: VaccineRule = {
        rule_id: '5', fiscal_year: 2568, age_group: '1yr', view_type: 1,
        vaccine_group: 'MMR', display_name: 'MMR1', hdc_code: '061',
        required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true,
        is_active: true, target_age_months: 9
      };
      const result = evaluateDynamicV1({ ...mockRecord, mmr1_date: undefined as unknown as string }, [mmrRule], new Date('2022-05-01'));
      expect(result.missingVaccines).toEqual([]);
      expect(result.pendingVaccines).toContain('MMR1');
      expect(result.pendingRuleNames).toContain('MMR1');
    });

    it('HDC Override - result = "ผ่าน" clears missing and backfills passedVaccines', () => {
      const overrideRecord = { ...mockRecord, dtp3_date: '-', result: 'ผ่าน' };
      const result = evaluateDynamicV2(overrideRecord, rules);
      expect(result.isFullyImmunized).toBe(true);
      expect(result.status).toBe('PASS');
      expect(result.missingVaccines).toEqual([]);
      // กลุ่มที่ local ไม่ผ่านถูกย้ายเข้า passedVaccines เพื่อให้ breakdown รวมเท่า headline
      expect(result.passedVaccines).toContain('DTP ครบ 3 เข็ม');
    });

    it('HDC Override - result = "ไม่ผ่าน"', () => {
      const overrideRecord = { ...mockRecord, result: 'ไม่ผ่าน' };
      const result = evaluateDynamicV2(overrideRecord, rules);
      expect(result.isFullyImmunized).toBe(false);
      expect(result.status).toBe('FAIL');
      expect(result.missingVaccines).toContain('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
    });
  });
});

describe('rules-driven View 1 evaluation (no hardcode)', () => {
  const baseRecord: EpiRecord = {
    hoscode: '00000', hosname: 'Mock', pid: '00000', cid: '1234567890123',
    name: 'Test', lname: 'User', birth: '2022-01-01', bcg_date: '2022-01-01', dtp1_date: '2022-03-01',
  };
  const v1Rule = (overrides: Partial<VaccineRule>): VaccineRule => ({
    rule_id: 'r', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'DTP',
    display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL',
    is_required_for_v2: true, is_active: true, target_age_months: 2, ...overrides,
  });

  it('excludes out-of-plan rules (view_type=1, is_required_for_v2=false) from counting', () => {
    const rules = [v1Rule({}), v1Rule({ rule_id: 'pcv', display_name: 'PCV เข็ม 1', required_fields: ['pcv1_date'], is_required_for_v2: false })];
    const result = evaluateDynamicV1({ ...baseRecord, pcv1_date: undefined } as unknown as EpiRecord, rules);
    expect(Object.keys(result.results)).toEqual(['DTP เข็ม 1']);
    expect(result.unknownVaccines).toEqual([]);
    expect(result.missingVaccines).toEqual([]);
    expect(result.passedCount).toBe(1);
  });

  it('treats a field absent from the source_columns manifest as unknown, not missing', () => {
    const rules = markSourceAware([v1Rule({})]);
    const missing = { ...baseRecord, dtp1_date: '', source_columns: '["bcg_date"]' } as EpiRecord;
    const unknown = evaluateDynamicV1(missing, rules);
    expect(unknown.unknownRuleNames).toEqual(['DTP เข็ม 1']);
    expect(unknown.missingVaccines).toEqual([]);
    // manifest ระบุคอลัมน์แล้ว แต่เซลล์ว่าง → missing จริง
    const blank = evaluateDynamicV1({ ...missing, source_columns: '["bcg_date","dtp1_date"]' }, rules);
    expect(blank.unknownRuleNames).toEqual([]);
    expect(blank.missingVaccines).toEqual(['DTP เข็ม 1']);
  });

  it('reports nothing missing when there are no rules at all', () => {
    const result = evaluateDynamicV1(baseRecord, []);
    expect(result.missingVaccines).toEqual([]);
    expect(result.pendingVaccines).toEqual([]);
    expect(result.results).toEqual({});
  });
});

describe('date configuration drives evaluation', () => {
  const rule: VaccineRule = { rule_id: 'hbv', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'HBV', hdc_code: '', required_fields: ['hbv1_date'], logic_type: 'ALL', is_active: true, is_required_for_v2: true, date_checks: { before_birth: false, allow_on_birth: true, same_day_pairs: [], ordered_pairs: [] } };
  it('respects disabled birth checks and explicit cross-vaccine pairs', () => {
    const record = { birth: '2024-01-01', hbv1_date: '2023-12-31', dtp1_date: '2023-12-31' } as EpiRecord;
    expect(evaluateDynamicV1(record, [rule]).results.HBV).toBe(true);
    const configured = { ...rule, date_checks: { ...rule.date_checks!, same_day_pairs: [{ field: 'hbv1_date', other_field: 'dtp1_date' }] } };
    expect(evaluateDynamicV1(record, [configured]).results.HBV).toBe(false);
    expect(evaluateDynamicV2({ ...record, result: 'ผ่าน' }, [{ ...configured, view_type: 2 }]).status).toBe('PASS');
  });
  it('does not compare Rota alternatives as if they were separate doses', () => {
    const rota = { ...rule, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH' as const, date_checks: undefined };
    const record = { birth: '2024-01-01', rv21_date: '2024-03-01', rv31_date: '2024-03-01' } as EpiRecord;
    expect(evaluateDynamicV1(record, [rota]).results['Rota เข็ม 1']).toBe(true);
  });
});
