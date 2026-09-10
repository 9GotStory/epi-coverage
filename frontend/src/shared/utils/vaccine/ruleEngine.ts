import { hasSourceColumn } from './sourceColumns';
import { isOutPlanRule } from './rulePresentation';
import type { VaccineDateChecks } from '../../types/vaccineDateChecks';
import { dateKey, getRuleDateWarnings } from './dateWarnings';
import { differenceInMonths, isValid } from 'date-fns';
import type { EpiRecord, VaccineStatus } from '../../types';
export interface View1Evaluation {
  unknownVaccines?: string[];
  unknownRuleNames?: string[];
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
  source_aware?: boolean;
  display_only?: boolean;
  unavailable_reason?: string;
  date_checks?: VaccineDateChecks;
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

  return false;
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


export const ruleHasDataError = (record: EpiRecord, rule: VaccineRule, allRules?: VaccineRule[]): string | null => {
  return getRuleDateWarnings(record, rule, allRules || [rule])[0] || null;
};

export const getDataErrors = (record: EpiRecord, rules: VaccineRule[]): string[] => {
  const errors: string[] = [];
  if (!rules) return errors;

  for (const rule of rules) {
    const err = ruleHasDataError(record, rule, rules);
    if (err) {
      errors.push(`${rule.display_name} (${err})`);
    }
  }

  return Array.from(new Set(errors));
};

/**
 * ชื่อที่ใช้แจ้งเมื่อ rule ไม่ผ่าน — มาจาก display_name ของ rule เท่านั้น (rules-driven ไม่มี hardcode)
 * ถ้าอยากได้รายละเอียดรายเข็ม ให้แยกเป็น rule ย่อยๆ ใน vaccine_rules (ดู seed แบบ Single Responsibility)
 * @param isPending true เมื่อเด็กยังเล็กกว่าอายุเป้าหมาย (target_age_months) ของ rule
 */
const resolveMissingRuleNames = (rule: VaccineRule, currentAgeMonths: number): { names: string[], isPending: boolean } => {
  // ถ้า rule ไม่ได้ตั้งอายุเป้าหมายมา ให้ถือว่าไม่ใช่ Pending แน่นอน (ถ้าไม่ได้ฉีดคือ Missing ทันที)
  const targetAge = rule.target_age_months;
  const isPending = targetAge !== undefined && targetAge !== null && currentAgeMonths < targetAge;
  return { names: [rule.display_name], isPending };
};

/**
 * เตรียม rules ที่ดึงจากฐานข้อมูล (แหล่งเดียวคือ vaccine_rules) ก่อนใช้งาน:
 * - ติดป้าย source_aware (ค่าเริ่มต้น true) เพื่อเปิดการตรวจ
 *   "ไฟล์ไม่มีคอลัมน์ที่จำเป็น → ข้อมูลไม่พอประเมิน" ใน evaluateDynamicV1
 * - normalize target_age_months: Google Sheet เก็บค่าว่างเป็น '' → เปลี่ยนเป็น undefined
 */
export function markSourceAware(rules: VaccineRule[]): VaccineRule[] {
  return rules.map(rule => ({
    ...rule,
    source_aware: rule.source_aware ?? true,
    target_age_months: typeof rule.target_age_months === 'number' ? rule.target_age_months : undefined,
  }));
}

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

  const v1Rules = rules.filter(rule => rule.view_type === 1 && rule.is_active && !(rule.display_only || isOutPlanRule(rule)));
  const unknownVaccines: string[] = [];
  const unknownRuleNames: string[] = [];
  let passedCount = 0;

  for (const rule of v1Rules) {
    const primaryKnown = rule.required_fields.length > 0 && rule.required_fields.every(field => hasSourceColumn(record, field));
    const alternativeKnown = (rule.branch_alt_fields?.length || 0) > 0 && rule.branch_alt_fields!.every(field => hasSourceColumn(record, field));
    const primaryPassed = primaryKnown && rule.required_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    const alternativePassed = alternativeKnown && rule.branch_alt_fields!.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    const incompleteSource = rule.logic_type === 'BRANCH'
      ? !primaryPassed && !alternativePassed && (!primaryKnown || !alternativeKnown)
      : !primaryKnown;
    if (rule.unavailable_reason || (rule.source_aware && incompleteSource)) {
      results[rule.display_name] = false;
      unknownRuleNames.push(rule.display_name);
      unknownVaccines.push(`${rule.display_name}: ${rule.unavailable_reason || 'ไฟล์ไม่มีคอลัมน์ที่จำเป็น'}`);
      continue;
    }
    const dataError = ruleHasDataError(record, rule, rules);
    if (dataError) {
      results[rule.display_name] = false;
      missingVaccines.push(`${rule.display_name} (${dataError})`);
      continue;
    }

    let passed = false;

    if (rule.logic_type === 'ALL') {
      // ต้องมีทุกเข็ม
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    } else if (rule.logic_type === 'ANY') {
      // มีเข็มใดเข็มหนึ่งก็ผ่าน
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.some(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    } else if (rule.logic_type === 'BRANCH') {
      // เส้นทางที่ 1 (เช่น Rota 2 เข็ม)
      const path1Passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
      // เส้นทางที่ 2 (เช่น Rota 3 เข็ม)
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])))
        : false;

      passed = path1Passed || path2Passed;
    }

    results[rule.display_name] = passed;
    if (!passed) {
      const { names, isPending } = resolveMissingRuleNames(rule, currentAgeMonths);
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

  return { missingVaccines, pendingVaccines, pendingRuleNames, unknownVaccines, unknownRuleNames, passedCount, results };
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

    let passed = false;
    if (rule.logic_type === 'ALL') {
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    } else if (rule.logic_type === 'ANY') {
      passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.some(field => Boolean(dateKey(record[field as keyof EpiRecord])));
    } else if (rule.logic_type === 'BRANCH') {
      const path1Passed = rule.required_fields && rule.required_fields.length > 0 && rule.required_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])));
      const path2Passed = rule.branch_alt_fields && rule.branch_alt_fields.length > 0
        ? rule.branch_alt_fields.every(field => Boolean(dateKey(record[field as keyof EpiRecord])))
        : false;
      passed = path1Passed || path2Passed;
    }

    if (!passed) {

      const { names, isPending } = resolveMissingRuleNames(rule, currentAgeMonths);
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
