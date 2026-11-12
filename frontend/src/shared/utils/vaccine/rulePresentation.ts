import { vaccineFieldLabel } from './hdcData';
import type { VaccineRule } from './ruleEngine';

/**
 * rule ของ View 1 ที่ is_required_for_v2 === false → "นอกแผน"
 * แสดงในรายการประกอบ แต่ไม่นับในความครบถ้วน (แทน displayOnly เดิมของ AGE_VACCINES)
 */
export function isOutPlanRule(rule: VaccineRule): boolean {
  return rule.view_type === 1 && rule.is_required_for_v2 === false;
}

/**
 * เรียง rules สำหรับแสดงผล: อายุเป้าหมายน้อย → มาก (ไม่ระบุไว้ล่างสุด)
 * แล้วเรียงตามกลุ่มวัคซีน และชื่อแสดงผล
 */
export function sortRulesForDisplay(rules: VaccineRule[]): VaccineRule[] {
  const ageOf = (rule: VaccineRule) => (typeof rule.target_age_months === 'number' ? rule.target_age_months : Number.POSITIVE_INFINITY);
  return [...rules].sort((a, b) => {
    const ageA = ageOf(a);
    const ageB = ageOf(b);
    if (ageA !== ageB) return ageA - ageB;
    const group = (a.vaccine_group || '').localeCompare(b.vaccine_group || '', 'th');
    if (group !== 0) return group;
    return (a.display_name || '').localeCompare(b.display_name || '', 'th');
  });
}

/**
 * ป้ายชื่อเข็มของคอลัมน์วันที่ (Issue #130) — ใช้ร่วมกันในข้อสังเกตวันที่และหน้า Rules Engine
 * ถ้ามี rule ที่ใช้คอลัมน์นั้นคอลัมน์เดียว (required + branch_alt คือคอลัมน์นั้นเท่านั้น) ใช้ display_name
 * ของ rule แรกตามลำดับที่ส่งเข้ามา ไม่งั้นใช้ป้ายตามชื่อคอลัมน์ (vaccineFieldLabel) เพราะ rule หลายคอลัมน์
 * เช่น Rota (ครบถ้วนตามเกณฑ์) หรือ LAJE/JE 1 ปี ไม่ได้บอกว่าเป็นเข็มไหน
 *
 * แคชตาม reference ของ array (WeakMap) เพราะถูกเรียกบ่อยมาก
 * (ต่อ rule ต่อ record ในรอบการประเมิน) และผู้เรียกมักส่ง array เดิมซ้ำ ๆ
 */
const labelMapCache = new WeakMap<VaccineRule[], Map<string, string>>();
export function buildDoseLabeler(rules: VaccineRule[]): (field: string) => string {
  let map = labelMapCache.get(rules);
  if (!map) {
    map = new Map<string, string>();
    for (const rule of rules) {
      const fields = [...new Set([...rule.required_fields, ...(rule.branch_alt_fields || [])].filter(Boolean))];
      if (fields.length === 1 && rule.display_name && !map.has(fields[0])) map.set(fields[0], rule.display_name);
    }
    labelMapCache.set(rules, map);
  }
  const labels = map;
  return field => labels.get(field) ?? vaccineFieldLabel(field);
}
