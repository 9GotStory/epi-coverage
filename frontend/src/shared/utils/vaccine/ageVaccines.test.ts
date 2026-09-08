import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import type { EpiAge } from '../../types/hdc';
import type { VaccineRule } from './ruleEngine';
import { AGE_VACCINES, getAgeView1Rules } from './ageVaccines';
import { evaluateAgeView1 } from './ruleEngine';
import { getHdcExportRows, getHdcVaccineRows } from './hdcData';
import { hasSourceColumn } from './sourceColumns';
import { calcGroupSummary } from '../dashboardLogic';

const record: EpiRecord = { hoscode: '00001', hosname: 'ทดสอบ', cid: '0000000000001', pid: '1', name: 'ข้อมูล', lname: 'จำลอง', birth: '2020-01-01', bcg_date: '2020-01-01', dtp5_date: '2024-02-01', opv5_date: '2024-02-02', dtp5_hospcode: '00002', dtp5_input_hosp: '00003', addr: '001/2', check_typearea: '3' };
const rule = (age: EpiAge, fields: string[], alternatives?: string[]): VaccineRule => ({ rule_id: fields.join('-'), fiscal_year: 2569, age_group: `${age}yr`, view_type: 1, vaccine_group: '', display_name: 'ชื่อเก่า', hdc_code: '', required_fields: fields, branch_alt_fields: alternatives, logic_type: alternatives ? 'BRANCH' : 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0, date_checks: { before_birth: true, allow_on_birth: true, same_day_pairs: [], ordered_pairs: [] } });

describe('age-scoped HDC presentation and evaluation', () => {
  it('has exactly the requested criteria for each age', () => {
    expect(Object.fromEntries(Object.entries(AGE_VACCINES).map(([age, items]) => [age, items.length]))).toEqual({ 1: 20, 2: 6, 3: 1, 5: 2 });
    expect(AGE_VACCINES[5].map(item => item.label)).toEqual(['DTP 4 ปี', 'OPV 4 ปี']);
    expect(AGE_VACCINES[3][0].label).toBe('LAJE2/JE3');
  });
  it('scopes both history and export, retaining metadata and zeros', () => {
    expect(getHdcVaccineRows(record, 5).map(row => row.field)).toEqual(['dtp5_date', 'opv5_date']);
    expect(getHdcVaccineRows(record, 5)[0]).toMatchObject({ facility: '00002', inputFacility: '00003' });
    const exported = getHdcExportRows([record], 5)[0];
    expect(exported).not.toHaveProperty('bcg_date');
    expect(exported).toMatchObject({ dtp5_input_hosp: '00003', 'ที่อยู่': '001/2', 'ประเภทพื้นที่': '3' });
    expect(getHdcExportRows([record])[0]).toHaveProperty('bcg_date');
  });
  it('retains configured rules and date checks without mutating them', () => {
    const rules = [rule(5, ['dtp5_date']), rule(5, ['opv5_date']), rule(5, ['bcg_date'])];
    const before = JSON.stringify(rules);
    const projected = getAgeView1Rules(rules, 5);
    expect(projected).toHaveLength(2);
    expect(projected[0].date_checks).toEqual(rules[0].date_checks);
    expect(evaluateAgeView1(record, rules, 5).passedCount).toBe(2);
    expect(JSON.stringify(rules)).toBe(before);
  });
  it('distinguishes missing source columns from explicit empty cells', () => {
    const rules = [rule(5, ['dtp5_date']), rule(5, ['opv5_date'])];
    const missing = { ...record, opv5_date: '', source_columns: JSON.stringify(['dtp5_date']) };
    expect(evaluateAgeView1(missing, rules, 5).unknownRuleNames).toEqual(['OPV 4 ปี']);
    expect(evaluateAgeView1(missing, rules, 5).missingVaccines).toEqual([]);
    const blank = { ...missing, source_columns: JSON.stringify(['dtp5_date', 'opv5_date']) };
    expect(evaluateAgeView1(blank, rules, 5).unknownRuleNames).toEqual([]);
    expect(evaluateAgeView1(blank, rules, 5).missingVaccines).toHaveLength(1);
    expect(hasSourceColumn({ ...record, opv5_date: '', source_columns: '' }, 'opv5_date')).toBe(false);
  });
  it('accepts an evidenced LAJE branch without JE3; an unevidenced alternative is unknown', () => {
    const rules = [rule(3, ['j12_date'], ['je3_date'])];
    const known = { ...record, j12_date: '2023-01-01', source_columns: '["j12_date"]' };
    expect(evaluateAgeView1(known, rules, 3).passedCount).toBe(1);
    const unknown = evaluateAgeView1({ ...known, j12_date: '' }, rules, 3);
    expect(unknown.unknownRuleNames).toEqual(['LAJE2/JE3']);
    expect(unknown.missingVaccines).toEqual([]);
  });
  it('does not claim a missing mapping or missing active rules are vaccine failures', () => {
    const result = evaluateAgeView1(record, [], 2);
    expect(result.missingVaccines).toEqual([]);
    expect(result.unknownRuleNames).toHaveLength(6);
    expect(getHdcVaccineRows(record, 2)[0].mappingNote).toContain('PCV');
  });
  it('excludes unknown criteria from the denominator and PCV outside-plan from completeness', () => {
    const rules = [rule(5, ['dtp5_date']), rule(5, ['opv5_date'])];
    const input = { ...record, source_columns: '["dtp5_date"]' };
    const summary = calcGroupSummary([input], row => evaluateAgeView1(row, rules, 5), () => ({ isFullyImmunized: false, missingVaccines: [], passedVaccines: [] }));
    expect(summary.view1PassedDoses).toBe(1); expect(summary.view1TotalDoses).toBe(1);
    expect(Object.keys(evaluateAgeView1(record, [], 1).results).some(name => name.startsWith('PCV'))).toBe(false);
  });
});
