import { differenceInMonths, isValid } from 'date-fns';
import type { EpiRecord, VaccineStatus } from '../../types';
export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  pendingVaccines?: string[];
  results: Record<string, boolean>;
}

export const getAgeInMonths = (birthDateStr: string | Date | undefined, evaluationDate: Date = new Date()): number => {
  if (!birthDateStr) return 999; // If no birth date, assume reached age
  const birthDate = typeof birthDateStr === 'string' ? new Date(birthDateStr) : birthDateStr;
  
  if (!isValid(birthDate)) return 999;

  const months = differenceInMonths(evaluationDate, birthDate);
  return Math.max(0, months);
};

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
  target_age_months?: number; // อายุที่รับวัคซีน (เดือน) เพื่อใช้เช็กสถานะ Pending
  note?: string;
}

/**
 * เช็กว่าได้รับวัคซีนนั้นๆ หรือยัง โดยอิงจาก Field วันที่
 * (ถ้ามีวันเดือนปี และไม่ใช่วันเกิด)
 */
export const hasDose = (record: EpiRecord, field: keyof EpiRecord, _birthDate?: string | Date): boolean => {
  const val = record[field];
  if (!val || typeof val !== 'string') return false;
  
  // ตัด Time ออกถ้ามี
  const cleanVal = val.split('T')[0].trim();
  if (cleanVal === '' || cleanVal === '-') return false;
  
  return true;
};

export const hasFieldDataError = (record: EpiRecord, field: keyof EpiRecord): boolean => {
  const val = record[field];
  if (!val || typeof val !== 'string' || !record.birth) return false;
  
  const birthStr = typeof record.birth === 'string' ? record.birth : record.birth.toISOString();
  const cleanBirth = birthStr.split('T')[0].trim();
  const cleanVal = val.split('T')[0].trim();
  
  if (cleanVal === '' || cleanVal === '-') return false;

  // 1. Check Date before Birth
  if (cleanVal < cleanBirth) {
    return true;
  }
  
  // 2. ลงผิดเป็นวันเกิด (ยกเว้น BCG และ HBV1 ที่ฉีดแรกเกิดได้)
  if (cleanVal === cleanBirth) {
    if (field !== 'bcg_date' && field !== 'hbv1_date') {
      return true;
    }
  }

  return false;
};

export const getDataErrors = (record: EpiRecord, rules: VaccineRule[]): string[] => {
  const errors: string[] = [];
  if (!record.birth || !rules) return errors;
  
  const currentAgeMonths = getAgeInMonths(record.birth);
  
  for (const rule of rules) {
    let hasError = false;
    if (rule.required_fields) {
      hasError = rule.required_fields.some(field => hasFieldDataError(record, field as keyof EpiRecord));
    }
    if (!hasError && rule.branch_alt_fields) {
      hasError = rule.branch_alt_fields.some(field => hasFieldDataError(record, field as keyof EpiRecord));
    }
    if (hasError) {
      const isV1 = rule.view_type === 1;
      const { names } = resolveSmartVaccineNames(record, rule, isV1, currentAgeMonths);
      errors.push(...names);
    }
  }
  
  return Array.from(new Set(errors));
};

const resolveSmartVaccineNames = (record: EpiRecord, rule: VaccineRule, isV1: boolean, currentAgeMonths: number): { names: string[], isPending: boolean } => {
  let targetAge: number | undefined = rule.target_age_months;
  
  // ถ้าระบบไม่ได้ตั้งอายุเป้าหมายมา ให้ถือว่าไม่ใช่ Pending แน่นอน (ถ้าไม่ได้ฉีดคือ Missing ทันที)
  let isPending = false;
  if (targetAge !== undefined && targetAge !== null) {
    isPending = currentAgeMonths < targetAge;
  }

  
  // Smart Rota Logic
  if (rule.vaccine_group === 'Rota' && rule.logic_type === 'BRANCH') {
    // If it's the complete series rule (it requires rv22_date)
    if (rule.required_fields.includes('rv22_date')) {
      if (targetAge === undefined) {
        targetAge = 6;
        isPending = currentAgeMonths < 6;
      }
      const hasRv21 = hasDose(record, 'rv21_date', record.birth);
      const hasRv31 = hasDose(record, 'rv31_date', record.birth);
      
      if (hasRv31 && !hasRv21) {
        // 3-dose series
        const hasRv32 = hasDose(record, 'rv32_date', record.birth);
        const hasRv33 = hasDose(record, 'rv33_date', record.birth);
        const missing = [];
        let hasPending = false;
        
        if (!hasRv32) {
          missing.push(isV1 ? 'ขาด Rota เข็ม 2 (rv32)' : 'Rota เข็ม 2 (rv32)');
          if (currentAgeMonths < 4) hasPending = true;
        }
        if (hasRv32 && !hasRv33) {
          missing.push(isV1 ? 'ขาด Rota เข็ม 3 (rv33)' : 'Rota เข็ม 3 (rv33)');
          if (currentAgeMonths < 6) hasPending = true;
        }
        if (missing.length > 0) return { names: missing, isPending: hasPending };
      } else if (hasRv21 && !hasRv31) {
        // 2-dose series
        const hasRv22 = hasDose(record, 'rv22_date', record.birth);
        if (!hasRv22) {
          return { 
            names: [isV1 ? 'ขาด Rota เข็ม 2 (rv22)' : 'Rota เข็ม 2 (rv22)'], 
            isPending: currentAgeMonths < 4 
          };
        }
      }
      // If neither, fallback to default display_name
    }
  }

  return { names: [rule.display_name], isPending };
};

/**
 * Evaluate Dynamic View 1 (รายเข็ม)
 * Return structure ให้เข้ากันกับ View1Evaluation
 */
export const evaluateDynamicV1 = (record: EpiRecord, rules: VaccineRule[]): View1Evaluation => {
  const missingVaccines: string[] = [];
  const pendingVaccines: string[] = [];
  const results: Record<string, boolean> = {};
  
  const currentAgeMonths = getAgeInMonths(record.birth);
  
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
      const { names, isPending } = resolveSmartVaccineNames(record, rule, true, currentAgeMonths);
      if (isPending) {
        pendingVaccines.push(...names);
      } else {
        missingVaccines.push(...names);
      }
    } else {
      passedCount++;
    }
  }

  return { missingVaccines, pendingVaccines, passedCount, results };
};

/**
 * Evaluate Dynamic View 2 (Fully Immunized)
 * Return structure ให้เข้ากันกับ VaccineStatus
 */
export const evaluateDynamicV2 = (record: EpiRecord, rules: VaccineRule[]): VaccineStatus => {
  const missingVaccines: string[] = [];
  const pendingVaccines: string[] = [];
  const passedVaccines: string[] = [];
  
  const currentAgeMonths = getAgeInMonths(record.birth);
  
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

    if (!passed) {
      const { names, isPending } = resolveSmartVaccineNames(record, rule, false, currentAgeMonths);
      if (isPending) {
        pendingVaccines.push(...names);
      } else {
        missingVaccines.push(...names);
      }
    } else {
      passedVaccines.push(rule.display_name);
    }
  }

  let status: 'PASS' | 'FAIL' | 'PENDING' = 'PASS';
  let isFullyImmunized = true;

  if (missingVaccines.length > 0) {
    status = 'FAIL';
    isFullyImmunized = false;
  } else if (pendingVaccines.length > 0) {
    status = 'PENDING';
    isFullyImmunized = false;
  }

  // Safety Net จาก HDC (Master Source of Truth) - ย้ายมาไว้ด้านล่างเพื่อให้ passedVaccines เก็บรายการย่อยไว้ทำ Breakdown
  if (record.result && typeof record.result === 'string') {
    if (record.result.includes('ผ่าน') && !record.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = true;
      status = 'PASS';
      missingVaccines.length = 0;
      pendingVaccines.length = 0;
    } else if (record.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = false;
      
      // If local logic says PENDING, keep it as PENDING (because HDC doesn't have PENDING state in export)
      if (status !== 'PENDING') {
        status = 'FAIL';
        if (missingVaccines.length === 0 && pendingVaccines.length === 0) {
          missingVaccines.push('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
        }
      }
    }
  }

  return { isFullyImmunized, status, missingVaccines, pendingVaccines, passedVaccines };
};
