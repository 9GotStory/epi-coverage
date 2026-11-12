import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import { getRecordDateWarnings as checkWarnings, getRecordDateWarningDetails } from './dateWarnings';
import type { VaccineRule } from './ruleEngine';
const fields = ['bcg_date', 'dtp1_date', 'dtp2_date', 'hib1_date', 'rv21_date', 'rv31_date', 'j11_date', 'j12_date', 'je1_date'];
const names: Record<string, string> = { bcg_date: 'BCG', dtp1_date: 'DTP เข็ม 1', dtp2_date: 'DTP เข็ม 2', hib1_date: 'Hib เข็ม 1', rv21_date: 'Rota เข็ม 1 (ชนิด 2 เข็ม)', rv31_date: 'Rota เข็ม 1 (ชนิด 3 เข็ม)', j11_date: 'LAJE เข็ม 1', j12_date: 'LAJE เข็ม 2', je1_date: 'JE เข็ม 1' };
// Issue #100: the inferred dose order comes from each rule's configured target age.
const ages: Record<string, number> = { bcg_date: 0, dtp1_date: 2, dtp2_date: 4, hib1_date: 2, rv21_date: 2, rv31_date: 2, j11_date: 12, j12_date: 30, je1_date: 12 };
const rules: VaccineRule[] = fields.map(field => ({ rule_id: field, fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: field, display_name: names[field], hdc_code: '', required_fields: [field], logic_type: 'ALL', is_active: true, is_required_for_v2: true, target_age_months: ages[field] }));
const getRecordDateWarnings = (input: EpiRecord) => checkWarnings(input, rules);
const record = (values: Partial<EpiRecord>) => ({ birth: '2024-01-01', ...values }) as EpiRecord;
describe('record date warnings', () => {
  it('warns for duplicate doses and reversed order', () => {
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-05-01', dtp2_date: '2024-03-01' })).join()).toContain('DTP เข็ม 2 (01-03-2024) ฉีดก่อน DTP เข็ม 1 (01-05-2024)');
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-03-01', dtp2_date: '2024-03-01T12:00:00Z' })).join()).toContain('ฉีดวันเดียวกัน');
  });
  it('accepts normal order and coadministration of different vaccines', () => {
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-03-01', dtp2_date: '2024-05-01', hib1_date: '2024-03-01' }))).toEqual([]);
  });
  it('checks dates before birth and invalid calendar dates', () => {
    const warnings = getRecordDateWarnings(record({ bcg_date: '2023-12-31', dtp1_date: '2024-02-30', dtp2_date: 'invalid' }));
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('ก่อนวันเกิด');
    expect(warnings[1]).toContain('รูปแบบวันที่ไม่ถูกต้อง');
  });
  it('keeps alternate series separate and detects order within LAJE', () => {
    expect(getRecordDateWarnings(record({ rv21_date: '2024-03-01', rv31_date: '2024-03-01', j11_date: '2024-04-01', je1_date: '2024-04-01' }))).toEqual([]);
    expect(getRecordDateWarnings(record({ j11_date: '2024-05-01', j12_date: '2024-04-01' })).join()).toContain('LAJE เข็ม 2 (01-04-2024) ฉีดก่อน LAJE เข็ม 1 (01-05-2024)');
  });
  it('checks duplicates without birth and preserves the source result', () => {
    const input = record({ birth: '', result: 'ผ่าน', dtp1_date: '2024-03-01', dtp2_date: '2024-03-01' });
    const original = { ...input };
    expect(getRecordDateWarnings(input)).toHaveLength(1);
    expect(input).toEqual(original);
  });
  it('ignores empty dates and permits birth doses', () => {
    expect(getRecordDateWarnings(record({ bcg_date: '2024-01-01', dtp1_date: '', dtp2_date: '-' }))).toEqual([]);
  });
  it('labels warnings with the display_name from vaccine_rules (ไม่ hardcode)', () => {
    const renamed = rules.map(rule => rule.rule_id === 'dtp2_date' ? { ...rule, display_name: 'DTP โดสที่สอง' } : rule);
    expect(checkWarnings(record({ dtp1_date: '2024-05-01', dtp2_date: '2024-03-01' }), renamed).join()).toContain('DTP โดสที่สอง (01-03-2024) ฉีดก่อน DTP เข็ม 1 (01-05-2024)');
  });
});

describe('inferred order for rules without saved date_checks (Issue #100)', () => {
  // HOSxP swaps the HBV columns: hbv4_date holds the 4-month dose, hbv3_date the 6-month dose.
  const hbv = (field: string, display_name: string, target_age_months?: number): VaccineRule => ({ rule_id: field, fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name, hdc_code: '', required_fields: [field], logic_type: 'ALL', is_active: true, is_required_for_v2: true, target_age_months });
  const swapped = [hbv('hbv4_date', 'HBV เข็ม 3 (4 เดือน)', 4), hbv('hbv3_date', 'HBV เข็ม 4 (6 เดือน)', 6)];
  it('orders doses by configured target age, not by column number', () => {
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-07-01' }), swapped)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-07-01', hbv3_date: '2024-05-01' }), swapped).join()).toContain('HBV เข็ม 4 (6 เดือน) (01-05-2024) ฉีดก่อน HBV เข็ม 3 (4 เดือน) (01-07-2024)');
  });
  it('does not infer an order when target ages are unknown or equal, but still flags same-day doses', () => {
    const unknown = [hbv('hbv4_date', 'HBV เข็ม 3 (4 เดือน)'), hbv('hbv3_date', 'HBV เข็ม 4 (6 เดือน)')];
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-07-01' }), unknown)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-07-01', hbv3_date: '2024-05-01' }), unknown)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-05-01' }), unknown)).toHaveLength(1);
  });
});

describe('Issue #130 — structured warnings name both doses and their dates', () => {
  const none = { before_birth: false, allow_on_birth: true, same_day_pairs: [], ordered_pairs: [] };
  const dose = (field: string, display_name: string, date_checks: VaccineRule['date_checks'] = none, overrides: Partial<VaccineRule> = {}): VaccineRule => ({
    rule_id: field, fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'X', display_name, hdc_code: '',
    required_fields: [field], logic_type: 'ALL', is_active: true, is_required_for_v2: true, ...overrides, date_checks,
  });
  const birth = (values: Partial<EpiRecord>) => ({ birth: '2025-01-15', ...values }) as EpiRecord;

  it('Same-Day Pair: both doses and the shared date, without "กับเข็มอื่น"', () => {
    const rules = [dose('dtp2_date', 'DTP เข็ม 2', { ...none, same_day_pairs: [{ field: 'dtp2_date', other_field: 'dtp3_date' }] }), dose('dtp3_date', 'DTP เข็ม 3')];
    expect(getRecordDateWarningDetails(birth({ dtp2_date: '2024-05-03', dtp3_date: '2024-05-03' }), rules)).toEqual([{
      type: 'same_day', fields: ['dtp2_date', 'dtp3_date'], labels: ['DTP เข็ม 2', 'DTP เข็ม 3'], dates: ['03-05-2024', '03-05-2024'],
      message: 'DTP เข็ม 2 และ DTP เข็ม 3 ฉีดวันเดียวกัน (03-05-2024)',
    }]);
  });

  it('reversed Ordered Pair: the later-expected dose first, both with their dates', () => {
    const rules = [dose('dtp2_date', 'DTP เข็ม 2', { ...none, ordered_pairs: [{ field: 'dtp2_date', other_field: 'dtp3_date' }] }), dose('dtp3_date', 'DTP เข็ม 3')];
    expect(getRecordDateWarningDetails(birth({ dtp2_date: '2024-06-10', dtp3_date: '2024-05-03' }), rules)).toEqual([{
      type: 'ordered', fields: ['dtp2_date', 'dtp3_date'], labels: ['DTP เข็ม 2', 'DTP เข็ม 3'], dates: ['10-06-2024', '03-05-2024'],
      message: 'DTP เข็ม 3 (03-05-2024) ฉีดก่อน DTP เข็ม 2 (10-06-2024)',
    }]);
  });

  it('before birth: the dose date and the birth date', () => {
    expect(getRecordDateWarningDetails(birth({ bcg_date: '2025-01-14' }), [dose('bcg_date', 'BCG', { ...none, before_birth: true })])).toEqual([{
      type: 'before_birth', fields: ['bcg_date'], labels: ['BCG'], dates: ['14-01-2025'], birth: '15-01-2025',
      message: 'BCG ฉีดก่อนวันเกิด (14-01-2025, เกิด 15-01-2025)',
    }]);
  });

  it('on the birth date when the rule does not allow it', () => {
    expect(getRecordDateWarningDetails(birth({ dtp1_date: '2025-01-15' }), [dose('dtp1_date', 'DTP เข็ม 1', { ...none, allow_on_birth: false })])).toEqual([{
      type: 'on_birth', fields: ['dtp1_date'], labels: ['DTP เข็ม 1'], dates: ['15-01-2025'],
      message: 'DTP เข็ม 1 ฉีดตรงวันเกิด (15-01-2025) ซึ่งเกณฑ์ไม่อนุญาต',
    }]);
  });

  it('invalid format: the raw stored value in quotes', () => {
    expect(getRecordDateWarningDetails(birth({ opv3_date: '01/05/2567' }), [dose('opv3_date', 'OPV เข็ม 3')])).toEqual([{
      type: 'invalid', fields: ['opv3_date'], labels: ['OPV เข็ม 3'], dates: ['01/05/2567'],
      message: 'OPV เข็ม 3 รูปแบบวันที่ไม่ถูกต้อง ("01/05/2567")',
    }]);
  });

  describe('dose labels: a single-column rule names its column, otherwise the column label', () => {
    // FY2569 shape: the Rota and LAJE/JE rules span several columns each.
    const sameDay = (...pairs: [string, string][]) => ({ ...none, same_day_pairs: pairs.map(([field, other_field]) => ({ field, other_field })) });
    const fy2569 = [
      dose('rv21_date', 'Rota เข็ม 1', sameDay(['rv21_date', 'rv22_date']), { branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH' }),
      dose('rv21_date', 'Rota (ครบถ้วนตามเกณฑ์)', sameDay(['rv21_date', 'rv22_date'], ['rv32_date', 'rv33_date']), { rule_id: 'rota-full', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH' }),
      dose('j11_date', 'LAJE/JE 1 ปี', sameDay(['je1_date', 'je2_date']), { branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH' }),
      dose('dtp1_date', 'DTP เข็ม 1 (2 เดือน)', sameDay(['dtp1_date', 'hib1_date'])),
      dose('dtp1_date', 'DTP ครบ 1 เข็ม', none, { rule_id: 'dtp1-again' }),
    ];
    const messages = (values: Partial<EpiRecord>) => checkWarnings(birth(values), fy2569);

    it('labels the Rota columns by series and dose', () => {
      expect(messages({ rv32_date: '2025-05-03', rv33_date: '2025-05-03' })).toEqual(['Rota ชนิด 3 เข็ม — เข็ม 2 และ Rota ชนิด 3 เข็ม — เข็ม 3 ฉีดวันเดียวกัน (03-05-2025)']);
      expect(messages({ rv21_date: '2025-03-03', rv22_date: '2025-03-03' })).toEqual(['Rota ชนิด 2 เข็ม — เข็ม 1 และ Rota ชนิด 2 เข็ม — เข็ม 2 ฉีดวันเดียวกัน (03-03-2025)']);
    });

    it('labels JE and LAJE per dose', () => {
      expect(messages({ je1_date: '2026-01-20', je2_date: '2026-01-20' })).toEqual(['JE เข็ม 1 และ JE เข็ม 2 ฉีดวันเดียวกัน (20-01-2026)']);
      expect(messages({ j11_date: '20/01/2569' })).toEqual(['LAJE เข็ม 1 รูปแบบวันที่ไม่ถูกต้อง ("20/01/2569")']);
    });

    it('keeps the configured name of the first single-column rule and labels other columns by convention', () => {
      expect(messages({ dtp1_date: '2025-03-15', hib1_date: '2025-03-15' })).toEqual(['DTP เข็ม 1 (2 เดือน) และ Hib เข็ม 1 ฉีดวันเดียวกัน (15-03-2025)']);
    });

    it('reports a pair configured on two rules once', () => {
      // rv21/rv22 is configured on both Rota rules
      expect(messages({ rv21_date: '2025-03-03', rv22_date: '2025-03-03' })).toHaveLength(1);
      const reversed = [dose('dtp2_date', 'DTP เข็ม 2', sameDay(['dtp2_date', 'dtp3_date'])), dose('dtp3_date', 'DTP เข็ม 3', sameDay(['dtp3_date', 'dtp2_date']))];
      expect(checkWarnings(birth({ dtp2_date: '2025-05-03', dtp3_date: '2025-05-03' }), reversed)).toEqual(['DTP เข็ม 2 และ DTP เข็ม 3 ฉีดวันเดียวกัน (03-05-2025)']);
    });

    it('reports a dose that breaks the same check under several rules once', () => {
      // rv21 belongs to both Rota rules, and both check before-birth
      const both = fy2569.slice(0, 2).map(rule => ({ ...rule, date_checks: { ...none, before_birth: true } }));
      expect(checkWarnings(birth({ rv21_date: '2025-01-10' }), both)).toEqual(['Rota ชนิด 2 เข็ม — เข็ม 1 ฉีดก่อนวันเกิด (10-01-2025, เกิด 15-01-2025)']);
    });
  });
});

describe('configured relationships', () => {
  const config = { before_birth: false, allow_on_birth: true, same_day_pairs: [], ordered_pairs: [] };
  it('explicit empty lists disable inferred duplicate and sequence checks', () => {
    const configured = rules.map(rule => ({ ...rule, date_checks: config }));
    expect(checkWarnings(record({ dtp1_date: '2023-12-31', dtp2_date: '2023-12-31' }), configured)).toEqual([]);
  });
  it('checks an explicit pair across different vaccine groups', () => {
    const configured = [{ ...rules[1], date_checks: { ...config, same_day_pairs: [{ field: 'dtp1_date', other_field: 'hib1_date' }] } }];
    expect(checkWarnings(record({ dtp1_date: '2024-03-01', hib1_date: '2024-03-01' }), configured)).toHaveLength(1);
    expect(checkWarnings(record({ dtp1_date: '2024-03-01', hib1_date: '2024-04-01' }), configured)).toEqual([]);
  });
  it('does not run inactive rules or rules from an empty response', () => {
    const input = record({ dtp1_date: '2023-12-31' });
    expect(checkWarnings(input, [])).toEqual([]);
    expect(checkWarnings(input, rules.map(rule => ({ ...rule, is_active: false })))).toEqual([]);
  });
});
