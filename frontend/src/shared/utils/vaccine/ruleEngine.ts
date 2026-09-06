import { differenceInMonths, isValid } from 'date-fns';
import type { EpiRecord, VaccineStatus } from '../../types';
export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  pendingVaccines?: string[];
  /** display_name ของ rule ที่อยู่ในสถานะ pending (ใช้ตัดออกจากตัวหาร coverage รายวัคซีน) */
  pendingRuleNames?: string[];
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
 * ตรวจวันที่ผิดปกติ: ก่อนวันเกิด หรือตรงวันเกิดทั้งที่ rule ไม่อนุญาต
 * (allowOnBirth มาจาก config — rule.target_age_months === 0 — เท่านั้น ไม่มี fallback)
 */
export const hasFieldDataError = (record: EpiRecord, field: keyof EpiRecord, allowOnBirth: boolean = false): boolean => {
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

  // 2. ลงผิดเป็นวันเกิด (ยกเว้นวัคซีนที่ฉีดแรกเกิดได้ allowOnBirth)
  if (cleanVal === cleanBirth && !allowOnBirth) {
    return true;
  }

  return null;
};

/**
 * เช็กว่าได้รับวัคซีนนั้นๆ หรือยัง โดยอิงจาก Field วันที่
 * วันที่ผิดปกติ (ก่อนวันเกิด/ตรงวันเกิดที่ rule ไม่อนุญาต) → ถือว่ายังไม่ได้รับตามเกณฑ์ HDC
 * @param allowOnBirth อนุญาตให้วันที่ตรงวันเกิดได้ — ผู้เรียกต้องส่งจาก rule.target_age_months === 0
 */
export const hasDose = (record: EpiRecord, field: keyof EpiRecord, allowOnBirth: boolean = false): boolean => {
  const val = record[field];
  if (!val || typeof val !== 'string') return false;

  // ตัด Time ออกถ้ามี
  const cleanVal = val.split('T')[0].trim();
  if (cleanVal === '' || cleanVal === '-') return false;

  if (hasFieldDataError(record, field, allowOnBirth)) return false;

  return true;
};

/** rule นี้อนุญาตให้ฉีดตรงวันเกิดได้ไหม — อ่านตรงจาก config ไม่มีการเดา */
const ruleAllowsOnBirth = (rule: VaccineRule): boolean => rule.target_age_months === 0;

export const ruleHasDataError = (record: EpiRecord, rule: VaccineRule, allRules?: VaccineRule[]): string | null => {
  const checkField = (f: string) => hasFieldDataError(record, f as keyof EpiRecord, ruleAllowsOnBirth(rule));
  
  const invalidField = [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])].find(checkField);
  if (invalidField) {
    return 'ข้อมูลวันที่ก่อนวันเกิด';
  }

  // Check duplicate dates within the same vaccine group
  if (allRules && rule.vaccine_group) {
    const groupFields = new Set<string>();
    for (const r of allRules) {
      if (r.vaccine_group === rule.vaccine_group) {
        (r.required_fields || []).forEach(f => groupFields.add(f));
        (r.branch_alt_fields || []).forEach(f => groupFields.add(f));
      }
    }
    
    const ruleFields = [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])];
    for (const f of ruleFields) {
      const val = record[f as keyof EpiRecord];
      if (!val || typeof val !== 'string') continue;
      const cleanVal = val.split('T')[0].trim();
      if (cleanVal === '' || cleanVal === '-') continue;

      for (const otherF of groupFields) {
        if (f !== otherF) {
          const otherVal = record[otherF as keyof EpiRecord];
          if (otherVal && typeof otherVal === 'string') {
            const cleanOtherVal = otherVal.split('T')[0].trim();
            if (cleanVal === cleanOtherVal) return 'วันที่ซ้ำซ้อนกับเข็มอื่น';
          }
        }
      }
    }
  }

  return false;
};

export const getDataErrors = (record: EpiRecord, rules: VaccineRule[]): string[] => {
  const errors: string[] = [];
  if (!record.birth || !rules) return errors;

  for (const rule of rules) {
    const err = ruleHasDataError(record, rule, rules);
    if (err) {
      errors.push(`${rule.display_name} (${err})`);
    }
  }

  return Array.from(new Set(errors));
};

const resolveSmartVaccineNames = (record: EpiRecord, rule: VaccineRule, currentAgeMonths: number): { names: string[], isPending: boolean } => {
  let targetAge: number | undefined = rule.target_age_months;

  // ถ้าระบบไม่ได้ตั้งอายุเป้าหมายมา ให้ถือว่าไม่ใช่ Pending แน่นอน (ถ้าไม่ได้ฉีดคือ Missing ทันที)
  let isPending = false;
  if (targetAge !== undefined && targetAge !== null) {
    isPending = currentAgeMonths < targetAge;
  }

  // Smart Rota Logic
  if (rule.vaccine_group === 'Rota' && rule.logic_type === 'BRANCH') {
    // If it's the complete series rule (it requires BOTH Dose 1 AND the final dose in either path, AND targetAge >= 6)
    const reqStr = (rule.required_fields || []).join(',');
    const altStr = (rule.branch_alt_fields || []).join(',');
    const isCompleteSeries =
      (
        (reqStr.includes('rv21_date') && reqStr.includes('rv22_date')) ||
        (altStr.includes('rv21_date') && altStr.includes('rv22_date')) ||
        (reqStr.includes('rv31_date') && reqStr.includes('rv33_date')) ||
        (altStr.includes('rv31_date') && altStr.includes('rv33_date'))
      ) &&
      (targetAge !== undefined && targetAge !== null && targetAge >= 6);

    if (isCompleteSeries) {
      const allowOnBirth = ruleAllowsOnBirth(rule);
      const hasRv21 = hasDose(record, 'rv21_date', allowOnBirth);
      const hasRv31 = hasDose(record, 'rv31_date', allowOnBirth);

      if (!hasRv21 && !hasRv31) {
        let pending = false;
        if (targetAge !== undefined && targetAge !== null) {
          pending = currentAgeMonths < Math.max(0, targetAge - 4);
        }
        return { names: ['Rota เข็ม 1'], isPending: pending };
      }

      const hasRv22 = hasDose(record, 'rv22_date', allowOnBirth);
      const hasRv32 = hasDose(record, 'rv32_date', allowOnBirth);

      if (!hasRv22 && !hasRv32) {
        let pending = false;
        if (targetAge !== undefined && targetAge !== null) {
          pending = currentAgeMonths < Math.max(0, targetAge - 2);
        }
        return { names: ['Rota เข็ม 2'], isPending: pending };
      }

      // If we reach here, they have at least one Dose 1 and one Dose 2.
      // Since evaluateDynamicV1/V2 already checked if they completed their specific path (and they failed),
      // they MUST be missing Dose 3.
      let pending = false;
      if (targetAge !== undefined && targetAge !== null) {
        pending = currentAgeMonths < targetAge;
      }
      return { names: ['Rota เข็ม 3 (rv33)'], isPending: pending };
      // If neither, fallback to default display_name
    }
  }

  return { names: [rule.display_name], isPending };
};

/**
 * Evaluate Dynamic View 1 (รายเข็ม)
 * Return structure ให้เข้ากันกับ View1Evaluation
 */
export const evaluateDynamicV1 = (record: EpiRecord, rules: VaccineRule[], evaluationDate: Date = new Date()): View1Evaluation => {
  const missingVaccines: string[] = [];
  const pendingVaccines: string[] = [];
  const pendingRuleNames: string[] = [];
  const results: Record<string, boolean> = {};

  const currentAgeMonths = getAgeInMonths(record.birth, evaluationDate);

  const v1Rules = rules.filter(r => r.view_type === 1 && r.is_active);
  let passedCount = 0;

  for (const rule of v1Rules) {
    const dataError = ruleHasDataError(record, rule, rules);
    if (dataError) {
      results[rule.display_name] = false;
      missingVaccines.push(`${rule.display_name} (${dataError})`);
      continue;
    }

    const allowOnBirth = ruleAllowsOnBirth(rule);
    let passed = false;

    if (rule.logic_type === 'ALL') {
      // ต้องมีทุกเข็ม
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
    } else if (rule.logic_type === 'ANY') {
      // มีเข็มใดเข็มหนึ่งก็ผ่าน
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.some(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
    } else if (rule.logic_type === 'BRANCH') {
      // เส้นทางที่ 1 (เช่น Rota 2 เข็ม)
      const path1Passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
      // เส้นทางที่ 2 (เช่น Rota 3 เข็ม)
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth))
        : false;

      passed = path1Passed || path2Passed;
    }

    results[rule.display_name] = passed;
    if (!passed) {
      const { names, isPending } = resolveSmartVaccineNames(record, rule, currentAgeMonths);
      if (isPending) {
        pendingVaccines.push(...names);
        pendingRuleNames.push(rule.display_name);
      } else {
        missingVaccines.push(...names);
      }
    } else {
      passedCount++;
    }
  }

  return { missingVaccines, pendingVaccines, pendingRuleNames, passedCount, results };
};

/**
 * Evaluate Dynamic View 2 (Fully Immunized)
 * Return structure ให้เข้ากันกับ VaccineStatus
 */
export const evaluateDynamicV2 = (record: EpiRecord, rules: VaccineRule[], evaluationDate: Date = new Date()): VaccineStatus => {
  const missingVaccines: string[] = [];
  const pendingVaccines: string[] = [];
  const passedVaccines: string[] = [];

  const currentAgeMonths = getAgeInMonths(record.birth, evaluationDate);

  const v2Rules = rules.filter(r => r.view_type === 2 && r.is_active);

  for (const rule of v2Rules) {
    const dataError = ruleHasDataError(record, rule, rules);
    if (dataError) {
      missingVaccines.push(`${rule.display_name} (${dataError})`);
      continue;
    }

    const allowOnBirth = ruleAllowsOnBirth(rule);
    let passed = false;
    if (rule.logic_type === 'ALL') {
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
    } else if (rule.logic_type === 'ANY') {
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.some(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
    } else if (rule.logic_type === 'BRANCH') {
      const path1Passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth));
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => hasDose(record, field as keyof EpiRecord, allowOnBirth))
        : false;
      passed = path1Passed || path2Passed;
    }

    if (!passed) {

      const { names, isPending } = resolveSmartVaccineNames(record, rule, currentAgeMonths);
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
      // HDC ถือว่าครบทุกเกณฑ์ → กลุ่มที่ local ยังไม่ผ่าน/ยังไม่ถึงกำหนด ให้ย้ายเข้า passedVaccines
      // เพื่อให้ผลรวม Breakdown สอดคล้องกับ headline coverage (ดู calcGroupSummary)
      for (const v of [...missingVaccines, ...pendingVaccines]) {
        if (!passedVaccines.includes(v)) passedVaccines.push(v);
      }
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
