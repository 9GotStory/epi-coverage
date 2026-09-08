import type { AgeVaccineItem, EpiAge } from '../../types/hdc';
import type { VaccineRule } from './ruleEngine';

const dose = (id: string, label: string, extra: Partial<AgeVaccineItem> = {}): AgeVaccineItem => ({ id, label, fields: [`${id}_date`], ...extra });
const hbvMapping = 'รอยืนยันการจับคู่คอลัมน์ HBV กับช่วงอายุจาก HDC';
export const AGE_VACCINES: Record<EpiAge, AgeVaccineItem[]> = {
  1: [
    dose('bcg', 'BCG แรกเกิด'), dose('hbv1', 'HBV แรกเกิด'),
    dose('dtp1', 'DTP 2 เดือน'), dose('dtp2', 'DTP 4 เดือน'), dose('dtp3', 'DTP 6 เดือน'),
    dose('hbv2', 'HBV 2 เดือน'), dose('hbv3', 'HBV 4 เดือน', { mappingNote: hbvMapping }), dose('hbv4', 'HBV 6 เดือน', { mappingNote: hbvMapping }),
    dose('hib1', 'Hib 2 เดือน'), dose('hib2', 'Hib 4 เดือน'), dose('hib3', 'Hib 6 เดือน'),
    dose('ipv1', 'IPV 2 เดือน'), dose('ipv2', 'IPV 4 เดือน'),
    { id: 'opv6m', label: 'OPV 6 เดือน', fields: ['opv1_date', 'opv3_date'], mappingNote: 'รอยืนยันคอลัมน์ OPV 6 เดือนจาก HDC' },
    dose('mmr1', 'MMR 9 เดือน'),
    { id: 'rota-first', label: 'Rota 2 เดือน', fields: ['rv21_date'], alternatives: ['rv31_date'] },
    { id: 'rota-complete', label: 'Rota (ครบถ้วนตามเกณฑ์)', fields: ['rv21_date', 'rv22_date'], alternatives: ['rv31_date', 'rv32_date', 'rv33_date'] },
    dose('pcv1', 'PCV 2 เดือน (นอกแผน)', { displayOnly: true }),
    dose('pcv2', 'PCV 4 เดือน (นอกแผน)', { displayOnly: true }),
    dose('pcv3', 'PCV 6 เดือน (นอกแผน)', { displayOnly: true }),
  ],
  2: [
    { id: 'pcv12m', label: 'PCV 1 ปี', fields: [], mappingNote: 'ไฟล์ตัวอย่างไม่มี PCV 1 ปีที่ยืนยัน mapping ได้' },
    { id: 'je-first', label: 'LAJE/JE 1 ปี', fields: ['j11_date'], alternatives: ['je1_date', 'je2_date'] },
    dose('dtp4', 'DTP 1 ปี 6 เดือน'), dose('opv4', 'OPV 1 ปี 6 เดือน'),
    dose('mmr1', 'MMR1 เก็บตก'), dose('mmr2', 'MMR2 1 ปี 6 เดือน'),
  ],
  3: [{ id: 'je-last', label: 'LAJE2/JE3', fields: ['j12_date'], alternatives: ['je3_date'] }],
  5: [dose('dtp5', 'DTP 4 ปี'), dose('opv5', 'OPV 4 ปี')],
};

const sameFields = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every(field => b.includes(field));
/** Presentation projection keeps stored per-year rules and date checks intact. */
export function getAgeView1Rules(rules: VaccineRule[], age: EpiAge): VaccineRule[] {
  const current = rules.filter(rule => rule.age_group === `${age}yr` && rule.view_type === 1 && rule.is_active);
  return AGE_VACCINES[age].map(item => {
    const match = current.find(rule => sameFields(rule.required_fields, item.fields) && sameFields(rule.branch_alt_fields, item.alternatives));
    return {
      ...(match || { rule_id: `display-${age}-${item.id}`, fiscal_year: rules[0]?.fiscal_year || 0,
        age_group: `${age}yr`, view_type: 1, vaccine_group: '', hdc_code: '',
        required_fields: item.fields, branch_alt_fields: item.alternatives,
        logic_type: item.alternatives ? 'BRANCH' : 'ALL', is_required_for_v2: false, is_active: true }),
      source_aware: true,
      display_name: item.label,
      display_only: item.displayOnly,
      unavailable_reason: item.mappingNote || (!match && !item.displayOnly ? 'ยังไม่มีเกณฑ์ที่ตรงกับรายการนี้' : undefined),
    };
  });
}
