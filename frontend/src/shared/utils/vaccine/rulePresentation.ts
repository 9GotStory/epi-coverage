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
 * สร้าง map field → display_name ของ rule แรก (ตามลำดับที่ส่งเข้ามา)
 * ที่ใช้ field นั้นใน required_fields หรือ branch_alt_fields
 * ใช้ทำป้ายชื่อวัคซีนใน dropdown "ตรวจสอบข้อมูลวันที่" แทนการ hardcode
 *
 * แคชตาม reference ของ array (WeakMap) เพราะถูกเรียกบ่อยมาก
 * (ต่อ rule ต่อ record ในรอบการประเมิน) และผู้เรียกมักส่ง array เดิมซ้ำ ๆ
 */
const labelMapCache = new WeakMap<VaccineRule[], Map<string, string>>();
export function buildFieldLabelMap(rules: VaccineRule[]): Map<string, string> {
  const cached = labelMapCache.get(rules);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const rule of rules) {
    for (const field of [...rule.required_fields, ...(rule.branch_alt_fields || [])]) {
      if (field && !map.has(field)) map.set(field, rule.display_name || field);
    }
  }
  labelMapCache.set(rules, map);
  return map;
}
