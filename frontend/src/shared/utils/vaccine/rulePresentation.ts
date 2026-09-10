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
  return [...rules].sort((a, b) => {
    const ageA = a.target_age_months ?? Number.POSITIVE_INFINITY;
    const ageB = b.target_age_months ?? Number.POSITIVE_INFINITY;
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
 */
export function buildFieldLabelMap(rules: VaccineRule[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of rules) {
    for (const field of [...rule.required_fields, ...(rule.branch_alt_fields || [])]) {
      if (field && !map.has(field)) map.set(field, rule.display_name || field);
    }
  }
  return map;
}
