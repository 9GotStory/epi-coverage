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
      expect(errors).toContain('DTP1 (031): วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต');
    });

    it('flags any vaccine when the date is before the birth date', () => {
      const rec: EpiRecord = { ...mockRecord, birth: '2024-10-08', bcg_date: '2024-10-07' };
      const errors = getDataErrors(rec, birthDoseRules);
      expect(errors).toContain('BCG (010): วันที่ฉีดก่อนวันเกิด');
    });

    it('flags a birth-date dose when the rule does NOT config target_age_months=0 (config คือความจริงเดียว)', () => {
      // อธิบาย contract: ถ้าไม่ config ระบบจะไม่เดาให้ — ต้องตั้ง target_age_months ใน rule เสมอ
      const noConfigRules: VaccineRule[] = [
        { ...birthDoseRules[0], rule_id: 'bcg-noconf', target_age_months: undefined },
      ];
      const rec: EpiRecord = { ...mockRecord, birth: '2024-10-08', bcg_date: '2024-10-08' };
      const errors = getDataErrors(rec, noConfigRules);
      expect(errors).toContain('BCG (010): วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต');
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
      expect(getDataErrors(rec, rules)).toContain('DTP1: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต');
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

  // Issue #78: BRANCH ตัดสินได้ต่อเมื่อไฟล์/manifest ยืนยันคอลัมน์ครบทั้งสองทางเลือก
  const rotaFullRules = markSourceAware([v1Rule({
    rule_id: 'rota-full', display_name: 'Rota (ครบ)', vaccine_group: 'Rota',
    required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'],
    logic_type: 'BRANCH', target_age_months: 6,
  })]);

  it('marks a BRANCH rule not evaluable when the file lacks one branch\'s columns, even for a child who completed the visible branch (Issue #78)', () => {
    // ไฟล์มีคอลัมน์ชุด 2 เข็ม (rv21, rv22) แต่ไม่มี rv31-33 — เด็กครบชุด 2 เข็มก็ตัดสิน "ครบ" ทั้งกฎไม่ได้
    // เพราะเด็กที่ได้ชุด 3 เข็มดูไม่เห็น นับเฉพาะคนผ่านเป็นตัวหารจะได้ coverage เทียม 100%
    const record = {
      ...baseRecord,
      rv21_date: '2024-03-01', rv22_date: '2024-05-01',
      source_columns: JSON.stringify(['bcg_date', 'dtp1_date', 'rv21_date', 'rv22_date']),
    } as EpiRecord;
    const result = evaluateDynamicV1(record, rotaFullRules);
    expect(result.unknownRuleNames).toEqual(['Rota (ครบ)']);
    expect(result.missingVaccines).toEqual([]);
    expect(result.pendingVaccines).toEqual([]);
    expect(result.passedCount).toBe(0);
  });

  it('evaluates a BRANCH rule normally when the file confirms both branches — pass and missing both count in the denominator', () => {
    const columns = { source_columns: JSON.stringify(['bcg_date', 'dtp1_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']) };
    const complete2Dose = evaluateDynamicV1({ ...baseRecord, rv21_date: '2024-03-01', rv22_date: '2024-05-01', ...columns } as EpiRecord, rotaFullRules);
    expect(complete2Dose.unknownRuleNames).toEqual([]);
    expect(complete2Dose.results['Rota (ครบ)']).toBe(true);
    expect(complete2Dose.passedCount).toBe(1);
    const noRota = evaluateDynamicV1({ ...baseRecord, ...columns } as EpiRecord, rotaFullRules);
    expect(noRota.unknownRuleNames).toEqual([]);
    expect(noRota.missingVaccines).toEqual(['Rota (ครบ)']);
    expect(noRota.passedCount).toBe(0);
  });

  it('applies the same rule to the LAJE/JE alternative — j12 without je3 columns is not evaluable (Issue #78)', () => {
    // ตัวอย่างที่สองของ Issue #78: ไฟล์ 3/5 ปีมี LAJE แต่ไม่มีคอลัมน์ JE — กลไกเดียวกันทุกกฎ BRANCH
    const rules = markSourceAware([v1Rule({
      rule_id: 'laje-je3', display_name: 'LAJE เข็ม 2 / JE เข็ม 3', vaccine_group: 'JE',
      required_fields: ['j12_date'], branch_alt_fields: ['je3_date'],
      logic_type: 'BRANCH', target_age_months: 30,
    })]);
    const record = {
      ...baseRecord, j12_date: '2024-07-01',
      source_columns: JSON.stringify(['bcg_date', 'dtp1_date', 'j12_date']),
    } as EpiRecord;
    const result = evaluateDynamicV1(record, rules);
    expect(result.unknownRuleNames).toEqual(['LAJE เข็ม 2 / JE เข็ม 3']);
    expect(result.passedCount).toBe(0);
  });

  it('treats a legacy row without a manifest as unconfirmable for the hidden branch — not evaluable, not passed (Issue #78)', () => {
    // แถวเก่าก่อนมี source_columns: ค่าว่างยืนยันไม่ได้ว่าไฟล์มีคอลัมน์นั้นจริง (docs/hdc-column-upgrade.md)
    // เด็กที่ครบชุด 2 เข็มจึงผ่านเกณฑ์ "อย่างเป็นทางการ" ไม่ได้ — ตัวเลข coverage รวมจะเทียม
    const legacy = { ...baseRecord, rv21_date: '2024-03-01', rv22_date: '2024-05-01', source_columns: '' } as EpiRecord;
    const result = evaluateDynamicV1(legacy, rotaFullRules);
    expect(result.unknownRuleNames).toEqual(['Rota (ครบ)']);
    expect(result.passedCount).toBe(0);
  });

  it('still evaluates a legacy row that evidences both branches with non-empty values', () => {
    // ขอบเขตของแถวเก่า: ค่าไม่ว่างคือหลักฐานคอลัมน์ — แถวที่มีค่าครบทั้งสองทางยังประเมินได้ (และผ่านอยู่แล้วโดยผลของข้อมูล)
    const legacy = {
      ...baseRecord,
      rv21_date: '2024-03-01', rv22_date: '2024-05-01',
      rv31_date: '2024-03-01', rv32_date: '2024-05-01', rv33_date: '2024-07-01',
      source_columns: '',
    } as EpiRecord;
    const result = evaluateDynamicV1(legacy, rotaFullRules);
    expect(result.unknownRuleNames).toEqual([]);
    expect(result.results['Rota (ครบ)']).toBe(true);
  });

  it('degenerates a BRANCH rule without branch_alt_fields to primary-only evaluation', () => {
    // กติกาไม่มีทางเลือก = ไม่มีคอลัมน์ที่ต้องยืนยันเพิ่ม ห้ามกลายเป็นประเมินไม่ได้ถาวร
    const noAlt = v1Rule({ rule_id: 'rota-1', display_name: 'Rota เข็ม 1', vaccine_group: 'Rota', required_fields: ['rv21_date'], logic_type: 'BRANCH', target_age_months: 2 });
    const rules = markSourceAware([noAlt]);
    const columns = { source_columns: JSON.stringify(['bcg_date', 'dtp1_date', 'rv21_date']) };
    const withDose = evaluateDynamicV1({ ...baseRecord, rv21_date: '2024-03-01', ...columns } as EpiRecord, rules);
    expect(withDose.unknownRuleNames).toEqual([]);
    expect(withDose.results['Rota เข็ม 1']).toBe(true);
    const noDose = evaluateDynamicV1({ ...baseRecord, ...columns } as EpiRecord, rules);
    expect(noDose.unknownRuleNames).toEqual([]);
    expect(noDose.missingVaccines).toEqual(['Rota เข็ม 1']);
  });

  it('reports nothing missing when there are no rules at all', () => {
    const result = evaluateDynamicV1(baseRecord, []);
    expect(result.missingVaccines).toEqual([]);
    expect(result.pendingVaccines).toEqual([]);
    expect(result.results).toEqual({});
  });

  it('markSourceAware normalizes empty-string target_age_months from the sheet', () => {
    const [normalized] = markSourceAware([v1Rule({ target_age_months: '' as unknown as number })]);
    expect(normalized.source_aware).toBe(true);
    expect(normalized.target_age_months).toBeUndefined();
    const [kept] = markSourceAware([v1Rule({ target_age_months: 9 })]);
    expect(kept.target_age_months).toBe(9);
  });
});

describe('Issue #89 — View 2 source gate (ข้อมูลไม่ครบ ≠ ขาดวัคซีน)', () => {
  // กฎ V2 จำลองจาก seed 1 ปี: BCG (ALL), MMR เข็ม 1 (ALL), Rota ครบชุด (BRANCH สองทางเลือก)
  const v2Rule = (overrides: Partial<VaccineRule>): VaccineRule => ({
    rule_id: 'v2', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'MMR',
    display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL',
    is_required_for_v2: true, is_active: true, target_age_months: 9, ...overrides,
  });
  const bcgRule = v2Rule({ rule_id: 'v2-bcg', vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', required_fields: ['bcg_date'], target_age_months: 0 });
  const mmrRule = v2Rule({});
  const rotaRule = v2Rule({
    rule_id: 'v2-rota', vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)',
    required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'],
    logic_type: 'BRANCH', target_age_months: 6,
  });
  const rules = markSourceAware([bcgRule, mmrRule, rotaRule]);

  /** เด็กอายุ ~12 เดือน ณ วันประเมิน — ผ่านอายุเกณฑ์ทุกกฎแล้ว จึงไม่มีสถานะ pending */
  const child = (extra: Partial<EpiRecord>): EpiRecord => ({
    hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-89', cid: '0000000000000',
    name: 'เด็กทดสอบ', lname: 'สังเคราะห์', birth: '2022-01-01', ...extra,
  });
  // วันประเมินคงที่ — เด็กเกิด 2022-01-01 อายุ 12 เดือนพอดี มากกว่า target 9 เดือนของทุกกฎ
  const evalDate = new Date('2023-01-01');

  it('marks a child NOT_EVALUABLE (not FAIL) when the file never carried a required rule column', () => {
    // ไฟล์ 1 ปีไม่มีคอลัมน์ mmr1_date — เด็กครบทุกเข็มที่มองเห็นก็ตัดสิน Fully Immunized ไม่ได้
    const record = child({
      bcg_date: '2022-01-01',
      rv21_date: '2022-03-01', rv22_date: '2022-05-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
    });
    const result = evaluateDynamicV2(record, rules, evalDate);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.isFullyImmunized).toBe(false);
    expect(result.notEvaluableVaccines).toEqual(['MMR เข็ม 1']);
    // ไม่ถูกนับเป็นขาดวัคซีน — เด็กกลุ่มนี้เป็นงานตามหาไฟล์ใหม่ ไม่ใช่รายชื่อตามฉีด (ข้อ 4)
    expect(result.missingVaccines).toEqual([]);
    expect(result.pendingVaccines).toEqual([]);
  });

  it('keeps the child out of chase lists even when another evaluable rule is genuinely missing', () => {
    // dtp... ใช้ mmr เป็นตัวอย่าง: ไฟล์ยืนยัน bcg_date (เซลล์ว่าง = ขาดจริง) แต่ไม่มีคอลัมน์ mmr1_date
    // ตัดสินรายคนไม่ได้ (ข้อ 1: "can neither be certified nor declared failed")
    const record = child({
      source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
    });
    const allConfirmed = evaluateDynamicV2(record, rules, evalDate);
    expect(allConfirmed.status).toBe('FAIL'); // คอลัมน์ครบ → ขาดจริง นับ FAIL ตามเดิม
    const noMmrColumn = child({
      source_columns: JSON.stringify(['birth', 'bcg_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
    });
    const blocked = evaluateDynamicV2(noMmrColumn, rules, evalDate);
    expect(blocked.status).toBe('NOT_EVALUABLE');
    expect(blocked.missingVaccines).toEqual([]); // ขาด BCG จริงก็ไม่เข้าลิสต์ตามฉีดจนกว่าจะประเมินได้
    expect(blocked.notEvaluableVaccines).toEqual(['MMR เข็ม 1']);
  });

  it('requires BOTH branches of a BRANCH rule (mirror of Issue #78 for View 2)', () => {
    // ไฟล์มี rv21/rv22 แต่ไม่มี rv31-33 — กฎ Rota ประเมินไม่ได้ทั้งกฎ แม้เด็กครบชุด 2 เข็มที่มองเห็น
    const record = child({
      bcg_date: '2022-01-01', mmr1_date: '2022-10-01',
      rv21_date: '2022-03-01', rv22_date: '2022-05-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date', 'rv21_date', 'rv22_date']),
    });
    const result = evaluateDynamicV2(record, rules, evalDate);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.notEvaluableVaccines).toEqual(['Rota (ครบถ้วนตามเกณฑ์)']);
  });

  it('evaluates locally as before when the file confirms every required column', () => {
    const columns = { source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']) };
    const complete = evaluateDynamicV2(child({ bcg_date: '2022-01-01', mmr1_date: '2022-10-01', rv21_date: '2022-03-01', rv22_date: '2022-05-01', ...columns }), rules, evalDate);
    expect(complete.status).toBe('PASS');
    expect(complete.isFullyImmunized).toBe(true);
    expect(complete.notEvaluableVaccines).toEqual([]);
    const incomplete = evaluateDynamicV2(child({ bcg_date: '2022-01-01', ...columns }), rules, evalDate);
    expect(incomplete.status).toBe('FAIL');
    expect(incomplete.missingVaccines).toEqual(expect.arrayContaining(['MMR เข็ม 1', 'Rota (ครบถ้วนตามเกณฑ์)']));
  });

  it('HDC "ผ่าน" still wins over the source gate — PASS with the blocked rule backfilled (ข้อ 2)', () => {
    const record = child({
      bcg_date: '2022-01-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
      result: 'ผ่าน',
    });
    const result = evaluateDynamicV2(record, rules, evalDate);
    expect(result.status).toBe('PASS');
    expect(result.isFullyImmunized).toBe(true);
    expect(result.notEvaluableVaccines).toEqual([]);
    // กฎที่ประเมินไม่ได้ถูกย้ายเข้า passedVaccines ให้ breakdown สอดคล้องกับ headline (เหมือน backfill เดิม)
    expect(result.passedVaccines).toContain('MMR เข็ม 1');
  });

  it('HDC "ไม่ผ่าน" stays FAIL even when some rules are not evaluable (ข้อ 2)', () => {
    const record = child({
      bcg_date: '2022-01-01', mmr1_date: '2022-10-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date']), // ไม่มี rv* เลย
      result: 'ไม่ผ่าน',
    });
    const result = evaluateDynamicV2(record, rules, evalDate);
    expect(result.status).toBe('FAIL');
    expect(result.isFullyImmunized).toBe(false);
    expect(result.missingVaccines).toContain('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
  });

  it('treats an unrecognized non-empty result (e.g. "-") as no HDC verdict — NOT_EVALUABLE still applies', () => {
    const record = child({
      bcg_date: '2022-01-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
      result: '-',
    });
    const result = evaluateDynamicV2(record, rules, evalDate);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.notEvaluableVaccines).toEqual(['MMR เข็ม 1']);
  });

  it('keeps a not-yet-due child PENDING per the #23 contract even in a partial-column file', () => {
    // เด็กอายุ 4 เดือน (ยังไม่ถึงเกณฑ์ Rota 6 เดือน / MMR 9 เดือน) ในไฟล์ที่ไม่มีคอลัมน์ mmr1_date
    // ระดับกฎ: MMR ผ่านประตูคอลัมน์ไม่ได้ (เหมือน View 1 — ประตูตรวจก่อนการแบ่ง pending)
    // ระดับรายคน: ยังมีกฎ pending (Rota) → สถานะ PENDING ตามสัญญา #23 ไม่หายไปอยู่ในกลุ่มอื่น
    // พออายุเกินเกณฑ์ทุกกฎและคอลัมน์ยังไม่ครบ สถานะจึงเปลี่ยนเป็น NOT_EVALUABLE
    const record = child({
      birth: '2022-09-01', bcg_date: '2022-09-01',
      source_columns: JSON.stringify(['birth', 'bcg_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']),
    });
    const result = evaluateDynamicV2(record, rules, new Date('2023-01-01')); // อายุ 4 เดือน
    expect(result.status).toBe('PENDING');
    expect(result.isFullyImmunized).toBe(false);
    expect(result.pendingVaccines).toEqual(['Rota (ครบถ้วนตามเกณฑ์)']);
    expect(result.notEvaluableVaccines).toEqual(['MMR เข็ม 1']);
    expect(result.missingVaccines).toEqual([]);
  });

  it('legacy rows without a manifest use non-empty values as the only column evidence (#78 precedent)', () => {
    // แถวเก่ามีค่า rv2 ครบแต่ไม่มีค่า rv3 ใดๆ ยืนยันทางเลือกที่สองไม่ได้ → ประเมินไม่ได้ ไม่ใช่ผ่าน
    const legacy = child({
      bcg_date: '2022-01-01', mmr1_date: '2022-10-01',
      rv21_date: '2022-03-01', rv22_date: '2022-05-01',
      source_columns: '',
    });
    const result = evaluateDynamicV2(legacy, rules, evalDate);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.notEvaluableVaccines).toEqual(['Rota (ครบถ้วนตามเกณฑ์)']);
  });

  it('leaves the gate off for rule sets that were never markSourceAware-marked (backwards compatibility)', () => {
    // เอนจินถูกเรียกด้วย rules ดิบ (ไม่ผ่าน markSourceAware) → source_aware ไม่ถูกเปิด
    // พฤติกรรมเดิมคงอยู่: ไม่มีคอลัมน์ = ขาด สำหรับผู้เรียกที่ไม่ขอการตรวจคอลัมน์
    const record = child({
      bcg_date: '2022-01-01',
      source_columns: JSON.stringify(['birth', 'bcg_date']),
    });
    const result = evaluateDynamicV2(record, [bcgRule, mmrRule, rotaRule], evalDate);
    expect(result.status).toBe('FAIL');
    expect(result.missingVaccines).toEqual(expect.arrayContaining(['MMR เข็ม 1']));
    expect(result.notEvaluableVaccines).toEqual([]);
  });

  it('treats a rule with unavailable_reason as not evaluable for View 2 (same as View 1)', () => {
    const rulesWithReason = markSourceAware([
      bcgRule,
      v2Rule({ rule_id: 'v2-unavailable', unavailable_reason: 'ยังไม่รองรับในไฟล์ HDC ปัจจุบัน' }),
    ]);
    const record = child({
      bcg_date: '2022-01-01',
      source_columns: JSON.stringify(['birth', 'bcg_date']),
    });
    const result = evaluateDynamicV2(record, rulesWithReason, evalDate);
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.notEvaluableVaccines).toEqual(['MMR เข็ม 1']);
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
