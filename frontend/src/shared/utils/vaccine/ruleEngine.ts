import type { EpiRecord, VaccineStatus } from '../../types';
import type { View1Evaluation } from './vaccine-1yr';

export interface VaccineRule {
  rule_id: string;
  fiscal_year: number;
  age_group: string;
  view_type: number; // 1 = View 1 (รายเข็ม), 2 = View 2 (Fully Immunized)
  vaccine_group: string;
  display_name: string;
  hdc_code: string;
  required_fields: string[]; // ["bcg_date"]
  logic_type: 'ALL' | 'ANY' | 'BRANCH';
  branch_alt_fields?: string[]; // สำหรับ Rota 3 เข็ม หรือ JE
  is_required_for_v2: boolean;
  is_active: boolean;
  note?: string;
}

/**
 * เช็กว่าได้รับวัคซีนนั้นๆ หรือยัง โดยอิงจาก Field วันที่
 * (ถ้ามีวันเดือนปี และไม่ใช่วันเกิด)
 */
export const hasDose = (record: EpiRecord, field: keyof EpiRecord, birthDate?: string | Date): boolean => {
  const val = record[field];
  if (!val || typeof val !== 'string') return false;
  
  // ตัด Time ออกถ้ามี
  const cleanVal = val.split('T')[0].trim();
  if (cleanVal === '' || cleanVal === '-') return false;
  
  // บางครั้งข้อมูลลงผิดเป็นวันเกิด
  if (birthDate) {
    const birthStr = typeof birthDate === 'string' ? birthDate : birthDate.toISOString();
    const cleanBirth = birthStr.split('T')[0].trim();
    if (cleanVal === cleanBirth) return false;
  }
  
  return true;
};

/**
 * Evaluate Dynamic View 1 (รายเข็ม)
 * Return structure ให้เข้ากันกับ View1Evaluation
 */
export const evaluateDynamicV1 = (record: EpiRecord, rules: VaccineRule[]): View1Evaluation => {
  const missingVaccines: string[] = [];
  const results: Record<string, boolean> = {};
  
  const v1Rules = rules.filter(r => r.view_type === 1 && r.is_active);
  let passedCount = 0;

  for (const rule of v1Rules) {
    let passed = false;

    if (rule.logic_type === 'ALL') {
      // ต้องมีทุกเข็ม
      passed = rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth));
    } else if (rule.logic_type === 'ANY') {
      // มีเข็มใดเข็มหนึ่งก็ผ่าน
      passed = rule.required_fields.some(field => hasDose(record, field as keyof EpiRecord, record.birth));
    } else if (rule.logic_type === 'BRANCH') {
      // เส้นทางที่ 1 (เช่น Rota 2 เข็ม)
      const path1Passed = rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth));
      // เส้นทางที่ 2 (เช่น Rota 3 เข็ม)
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth))
        : false;
        
      passed = path1Passed || path2Passed;
    }

    results[rule.display_name] = passed;
    if (!passed) {
      missingVaccines.push(rule.display_name);
    } else {
      passedCount++;
    }
  }

  return { missingVaccines, passedCount, results };
};

/**
 * Evaluate Dynamic View 2 (Fully Immunized)
 * Return structure ให้เข้ากันกับ VaccineStatus
 */
export const evaluateDynamicV2 = (record: EpiRecord, rules: VaccineRule[]): VaccineStatus => {
  // Safety Net จาก HDC (Master Source of Truth)
  if (record.result === 'ผ่าน') {
    return { isFullyImmunized: true, missingVaccines: [], passedVaccines: ['HDC: ผ่าน'] };
  }
  if (record.result === 'ไม่ผ่าน') {
    return { isFullyImmunized: false, missingVaccines: ['HDC: ไม่ผ่าน'], passedVaccines: [] };
  }

  const missingVaccines: string[] = [];
  const passedVaccines: string[] = [];
  
  const v2Rules = rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2);

  for (const rule of v2Rules) {
    let passed = false;

    if (rule.logic_type === 'ALL') {
      passed = rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth));
    } else if (rule.logic_type === 'ANY') {
      passed = rule.required_fields.some(field => hasDose(record, field as keyof EpiRecord, record.birth));
    } else if (rule.logic_type === 'BRANCH') {
      const path1Passed = rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth));
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => hasDose(record, field as keyof EpiRecord, record.birth))
        : false;
      passed = path1Passed || path2Passed;
    }

    if (passed) {
      passedVaccines.push(rule.display_name);
    } else {
      missingVaccines.push(rule.display_name);
    }
  }

  const isFullyImmunized = missingVaccines.length === 0;

  return { isFullyImmunized, missingVaccines, passedVaccines };
};
