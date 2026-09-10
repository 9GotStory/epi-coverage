import { describe, expect, it } from 'vitest';
import type { VaccineRule } from './ruleEngine';
import { buildFieldLabelMap, isOutPlanRule, sortRulesForDisplay } from './rulePresentation';

const rule = (overrides: Partial<VaccineRule>): VaccineRule => ({
  rule_id: overrides.rule_id || 'r', fiscal_year: 2569, age_group: '1yr', view_type: 1,
  vaccine_group: '', display_name: '', hdc_code: '', required_fields: [], logic_type: 'ALL',
  is_required_for_v2: true, is_active: true, ...overrides,
});

describe('isOutPlanRule', () => {
  it('marks view-1 rules that are not required (นอกแผน)', () => {
    expect(isOutPlanRule(rule({ view_type: 1, is_required_for_v2: false }))).toBe(true);
    expect(isOutPlanRule(rule({ view_type: 1, is_required_for_v2: true }))).toBe(false);
    expect(isOutPlanRule(rule({ view_type: 2, is_required_for_v2: false }))).toBe(false);
  });
});

describe('sortRulesForDisplay', () => {
  it('sorts by target age ascending with unset ages last, then vaccine group, then display name', () => {
    const sorted = sortRulesForDisplay([
      rule({ rule_id: 'mmr', display_name: 'MMR เข็ม 1', vaccine_group: 'MMR', target_age_months: 9 }),
      rule({ rule_id: 'noage', display_name: 'ไม่ระบุอายุ', vaccine_group: 'ZZ' }),
      rule({ rule_id: 'bcg', display_name: 'BCG', vaccine_group: 'BCG', target_age_months: 0 }),
      rule({ rule_id: 'dtp2', display_name: 'DTP เข็ม 2', vaccine_group: 'DTP', target_age_months: 4 }),
      rule({ rule_id: 'dtp1', display_name: 'DTP เข็ม 1', vaccine_group: 'DTP', target_age_months: 2 }),
    ]);
    expect(sorted.map(r => r.rule_id)).toEqual(['bcg', 'dtp1', 'dtp2', 'mmr', 'noage']);
  });

  it('does not mutate the input array', () => {
    const input = [rule({ rule_id: 'b', target_age_months: 9 }), rule({ rule_id: 'a', target_age_months: 0 })];
    sortRulesForDisplay(input);
    expect(input.map(r => r.rule_id)).toEqual(['b', 'a']);
  });
});

describe('buildFieldLabelMap', () => {
  it('maps fields to the display name of the first owning rule including alternatives', () => {
    const map = buildFieldLabelMap([
      rule({ rule_id: 'r1', display_name: 'Rota (ครบชุด)', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date', 'rv33_date'] }),
      rule({ rule_id: 'r2', display_name: 'DTP เข็ม 1', required_fields: ['dtp1_date'] }),
    ]);
    expect(map.get('rv21_date')).toBe('Rota (ครบชุด)');
    expect(map.get('rv33_date')).toBe('Rota (ครบชุด)');
    expect(map.get('dtp1_date')).toBe('DTP เข็ม 1');
    expect(map.has('bcg_date')).toBe(false);
  });
});
