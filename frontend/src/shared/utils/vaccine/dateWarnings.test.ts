import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import { getRecordDateWarnings as checkWarnings } from './dateWarnings';
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
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-05-01', dtp2_date: '2024-03-01' })).join()).toContain('DTP เข็ม 2: วันที่ฉีดก่อน DTP เข็ม 1');
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-03-01', dtp2_date: '2024-03-01T12:00:00Z' })).join()).toContain('วันที่ซ้ำซ้อน');
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
    expect(getRecordDateWarnings(record({ j11_date: '2024-05-01', j12_date: '2024-04-01' })).join()).toContain('LAJE เข็ม 2: วันที่ฉีดก่อน LAJE เข็ม 1');
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
    expect(checkWarnings(record({ dtp1_date: '2024-05-01', dtp2_date: '2024-03-01' }), renamed).join()).toContain('DTP โดสที่สอง: วันที่ฉีดก่อน DTP เข็ม 1');
  });
});

describe('inferred order for rules without saved date_checks (Issue #100)', () => {
  // HOSxP swaps the HBV columns: hbv4_date holds the 4-month dose, hbv3_date the 6-month dose.
  const hbv = (field: string, display_name: string, target_age_months?: number): VaccineRule => ({ rule_id: field, fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name, hdc_code: '', required_fields: [field], logic_type: 'ALL', is_active: true, is_required_for_v2: true, target_age_months });
  const swapped = [hbv('hbv4_date', 'HBV เข็ม 3 (4 เดือน)', 4), hbv('hbv3_date', 'HBV เข็ม 4 (6 เดือน)', 6)];
  it('orders doses by configured target age, not by column number', () => {
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-07-01' }), swapped)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-07-01', hbv3_date: '2024-05-01' }), swapped).join()).toContain('HBV เข็ม 4 (6 เดือน): วันที่ฉีดก่อน HBV เข็ม 3 (4 เดือน)');
  });
  it('does not infer an order when target ages are unknown or equal, but still flags same-day doses', () => {
    const unknown = [hbv('hbv4_date', 'HBV เข็ม 3 (4 เดือน)'), hbv('hbv3_date', 'HBV เข็ม 4 (6 เดือน)')];
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-07-01' }), unknown)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-07-01', hbv3_date: '2024-05-01' }), unknown)).toEqual([]);
    expect(checkWarnings(record({ hbv4_date: '2024-05-01', hbv3_date: '2024-05-01' }), unknown)).toHaveLength(1);
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
