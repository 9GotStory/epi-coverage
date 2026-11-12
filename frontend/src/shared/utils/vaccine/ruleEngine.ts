import { hasSourceColumn } from './sourceColumns';
import { isOutPlanRule } from './rulePresentation';
import type { VaccineDateChecks } from '../../types/vaccineDateChecks';
import { dateKey, getRuleDateWarnings } from './dateWarnings';
import { calendarDay } from './hdcData';
import { ruleApplicability } from './birthWindow';
import type { BirthWindow } from './birthWindow';
import { differenceInMonths, isValid } from 'date-fns';
import type { BirthWindowSide, EpiRecord, InapplicableRule, VaccineStatus } from '../../types';
export interface View1Evaluation {
  unknownVaccines?: string[];
  unknownRuleNames?: string[];
  passedCount: number;
  missingVaccines: string[];
  pendingVaccines?: string[];
  /** display_name ของ rule ที่อยู่ในสถานะ pending (ใช้ตัดออกจากตัวหาร coverage รายวัคซีน) */
  pendingRuleNames?: string[];
  /** Issue #102: display_name ของ rule ที่วันที่ครบแต่มีคำเตือนวันที่ ("ตรวจสอบประวัติ") — ไม่ผ่าน ไม่ขาด และไม่อยู่ในตัวหาร */
  reviewRuleNames?: string[];
  results: Record<string, boolean>;
  /** Issue #121: กฎที่ Birth Window ตัดเด็กออก — ไม่อยู่ใน results/รายการใด ใช้อธิบายในประวัติเท่านั้น */
  inapplicableRules?: InapplicableRule[];
}

export const getAgeInMonths = (birthDateStr: string | Date | undefined, evaluationDate: Date = new Date()): number => {
  if (!birthDateStr) return 999; // If no birth date, assume reached age
  const day = calendarDay(birthDateStr);
  if (!day) return 999;
  const birthDate = new Date(`${day}T00:00:00`);

  if (!isValid(birthDate)) return 999;

  const months = differenceInMonths(evaluationDate, birthDate);
  return Math.max(0, months);
};

/** Issue #121 (ADR-0008): born_on_or_after/born_before จาก BirthWindow — วันปฏิทิน ค.ศ. `yyyy-MM-dd` หรือว่าง (ไม่จำกัด) */
export interface VaccineRule extends BirthWindow {
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
  /** Issue #26 (Decision E): forward cross-FY logical identity. Absent/empty on rules
   * that predate the contract — the effective key is then this rule's own rule_id. */
  metric_key?: string;
}

const inapplicableEntry = (rule: VaccineRule, excludedBy: { side: BirthWindowSide; date: string }): InapplicableRule =>
  ({ rule_id: rule.rule_id, display_name: rule.display_name, side: excludedBy.side, date: excludedBy.date });

/**
 * ตรวจวันที่ผิดปกติ: ก่อนวันเกิด หรือตรงวันเกิดทั้งที่ rule ไม่อนุญาต
 * (allowOnBirth มาจาก config — rule.target_age_months === 0 — เท่านั้น ไม่มี fallback)
 */
export const hasFieldDataError = (record: EpiRecord, field: keyof EpiRecord, allowOnBirth: boolean = false): boolean => {
  const val = record[field];
  if (val === null || val === undefined || val === '' || !record.birth) return false;

  const cleanBirth = calendarDay(record.birth);
  const cleanVal = calendarDay(val);
  if (!cleanBirth || !cleanVal) return false;

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
 * เช็กว่า Field วันที่มีวันที่ที่ไม่มีข้อผิดปกติ (ก่อนวันเกิด/ตรงวันเกิดที่ rule ไม่อนุญาต)
 * ไม่ใช่ตัวตัดสินว่าขาดวัคซีน — engine ถือวันที่ผิดปกติเป็น "ตรวจสอบประวัติ" (Issue #102, CONTEXT.md §23)
 * @param allowOnBirth อนุญาตให้วันที่ตรงวันเกิดได้ — ผู้เรียกต้องส่งจาก rule.target_age_months === 0
 */
export const hasDose = (record: EpiRecord, field: keyof EpiRecord, allowOnBirth: boolean = false): boolean => {
  const val = record[field];
  if (val === null || val === undefined || val === '') return false;

  if (!calendarDay(val)) return false;
  if (hasFieldDataError(record, field, allowOnBirth)) return false;

  return true;
};

/** rule นี้อนุญาตให้ฉีดตรงวันเกิดได้ไหม — อ่านตรงจาก config ไม่มีการเดา */


export const ruleHasDataError = (record: EpiRecord, rule: VaccineRule, allRules?: VaccineRule[]): string | null => {
  return getRuleDateWarnings(record, rule, allRules || [rule])[0] || null;
};

/**
 * ข้อความ error ของ rule — ถ้า error ขึ้นต้นด้วยชื่อ rule แล้ว (ป้ายจาก display_name ใน vaccine_rules)
 * ไม่ต้องนำหน้าชื่อ rule ซ้ำ เช่น "DTP เข็ม 1 ฉีดก่อนวันเกิด (14-01-2025, เกิด 15-01-2025)"
 */
const formatRuleError = (rule: VaccineRule, error: string): string =>
  error.startsWith(`${rule.display_name} `) ? error : `${rule.display_name} (${error})`;

export const getDataErrors = (record: EpiRecord, rules: VaccineRule[]): string[] => {
  const errors: string[] = [];
  if (!rules) return errors;

  for (const rule of rules) {
    const err = ruleHasDataError(record, rule, rules);
    if (err) {
      errors.push(formatRuleError(rule, err));
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
 * Issue #89 (ข้อ 5 จากเจ้าของข้อมูล): ประตูตรวจคอลัมน์ต้นทางรายกฎ — ใช้ร่วมทั้ง View 1 และ View 2
 * เพื่อให้สองมุมมองตัดสิน "ข้อมูลไม่พอประเมิน" ด้วยเกณฑ์เดียวกัน ไม่เบี่ยงแยกกันอีก
 *
 * - ALL/ANY ตัดสินได้ต่อเมื่อไฟล์/`source_columns` ยืนยันคอลัมน์ required_fields ครบทุกฟิลด์
 * - BRANCH ตัดสินได้ต่อเมื่อยืนยันครบ **ทั้งสองทางเลือก** (Issue #78) — กฎไม่มีทางเลือก
 *   (branch_alt_fields ว่าง) ไม่มีคอลัมน์ที่ต้องยืนยันเพิ่ม จึงไม่กลายเป็นประเมินไม่ได้
 */
export function ruleSourceDecidable(rule: VaccineRule, record: EpiRecord): boolean {
  const primaryKnown = rule.required_fields.length > 0 && rule.required_fields.every(field => hasSourceColumn(record, field));
  const alternativeKnown = !rule.branch_alt_fields || rule.branch_alt_fields.length === 0 || rule.branch_alt_fields.every(field => hasSourceColumn(record, field));
  return rule.logic_type === 'BRANCH' ? primaryKnown && alternativeKnown : primaryKnown;
}

/**
 * Issue #102: กฎมีวันที่ครบตาม ALL/ANY/BRANCH หรือไม่ โดยยังไม่ดูคำเตือนวันที่ — ค่าที่ไม่ว่างแต่รูปแบบผิด
 * นับว่ามีวันที่ (เป็นคำเตือน "ตรวจสอบประวัติ" ไม่ใช่เข็มขาด) เซลล์ว่างหรือขีดเท่านั้นที่เป็นการขาดวันที่
 */
const ruleDatesPresent = (record: EpiRecord, rule: VaccineRule): boolean => {
  const present = (field: string) => dateKey(record[field as keyof EpiRecord]) !== null;
  const allPresent = (fields: string[] | undefined) => !!fields && fields.length > 0 && fields.every(present);
  if (rule.logic_type === 'ANY') return !!rule.required_fields && rule.required_fields.some(present);
  // BRANCH ผ่านเมื่อเส้นทางใดเส้นทางหนึ่งครบ (เช่น Rota 2 เข็ม หรือ 3 เข็ม)
  if (rule.logic_type === 'BRANCH') return allPresent(rule.required_fields) || allPresent(rule.branch_alt_fields);
  return rule.logic_type === 'ALL' && allPresent(rule.required_fields);
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

  const v1Rules = rules.filter(rule => rule.view_type === 1 && rule.is_active && !(rule.display_only || isOutPlanRule(rule)));
  const unknownVaccines: string[] = [];
  const unknownRuleNames: string[] = [];
  const reviewRuleNames: string[] = [];
  const inapplicableRules: InapplicableRule[] = [];
  let passedCount = 0;

  for (const rule of v1Rules) {
    // Issue #121: Birth Window ตัดสินก่อนคอลัมน์ วันที่ และ Target Age — Inapplicable Rule ไม่นับเลย
    const applicability = ruleApplicability(rule, record);
    if (applicability.kind === 'inapplicable') {
      inapplicableRules.push(inapplicableEntry(rule, applicability));
      continue;
    }
    if (applicability.kind === 'not_evaluable') {
      results[rule.display_name] = false;
      unknownRuleNames.push(rule.display_name);
      unknownVaccines.push(`${rule.display_name}: ${applicability.reason}`);
      continue;
    }
    if (rule.unavailable_reason || (rule.source_aware && !ruleSourceDecidable(rule, record))) {
      results[rule.display_name] = false;
      unknownRuleNames.push(rule.display_name);
      unknownVaccines.push(`${rule.display_name}: ${rule.unavailable_reason || 'ไฟล์ไม่มีคอลัมน์ที่จำเป็น'}`);
      continue;
    }
    // Issue #102: วันที่ครบแต่มีคำเตือน = ตรวจสอบประวัติ ไม่ผ่านและไม่ขาด (ตัดออกจากตัวหารแบบ pending/unknown)
    // เซลล์ว่างยังเป็นขาด/Pending ตามเดิมแม้กฎมีคำเตือนร่วมด้วย
    const passed = ruleDatesPresent(record, rule);
    if (passed && ruleHasDataError(record, rule, rules)) {
      results[rule.display_name] = false;
      reviewRuleNames.push(rule.display_name);
      continue;
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

  return { missingVaccines, pendingVaccines, pendingRuleNames, unknownVaccines, unknownRuleNames, reviewRuleNames, passedCount, results, inapplicableRules };
};

/** คำตัดสินจาก `result` ของ HDC — ค่าว่างหรือค่าที่ระบบไม่รู้จัก (เช่น '-') คือไม่มีคำตัดสิน */
const readHdcVerdict = (result: unknown): 'PASS' | 'FAIL' | null => {
  const text = typeof result === 'string' ? result : '';
  if (text.includes('ไม่ผ่าน')) return 'FAIL';
  return text.includes('ผ่าน') ? 'PASS' : null;
};

/**
 * Evaluate Dynamic View 2 (Fully Immunized)
 * Return structure ให้เข้ากันกับ VaccineStatus
 *
 * Issue #89: กฎ V2 ที่ไฟล์/`source_columns` ยืนยันคอลัมน์ไม่ได้ (BRANCH ต้องครบทั้งสองทาง)
 * เป็น "ประเมินไม่ได้" (notEvaluableVaccines) ไม่นับเป็นขาด — เด็กที่มีกฎลักษณะนี้แม้ข้อเดียว
 * ตัดสินรายคนไม่ได้ (status NOT_EVALUABLE) และออกจากตัวหาร coverage (แบบเดียวกับ pending)
 *
 * Issue #101 (ADR-0006): กฎในระบบตัดสิน status เท่านั้น — `result` ของ HDC คืนเป็น hdcVerdict
 * ประกอบ พร้อม hdcMismatch เมื่อคำตัดสินสองฝ่ายขัดกัน (CONTEXT.md §43)
 */
export const evaluateDynamicV2 = (record: EpiRecord, rules: VaccineRule[], evaluationDate: Date = new Date()): VaccineStatus => {
  const missingVaccines: string[] = [];
  const pendingVaccines: string[] = [];
  const passedVaccines: string[] = [];
  const reviewVaccines: string[] = [];
  const notEvaluableVaccines: string[] = [];
  const inapplicableRules: InapplicableRule[] = [];

  const currentAgeMonths = getAgeInMonths(record.birth, evaluationDate);

  const v2Rules = rules.filter(r => r.view_type === 2 && r.is_active);

  for (const rule of v2Rules) {
    // Issue #121: Inapplicable Rule ไม่เข้ารายการใดเลย จึงไม่อยู่ในตัวหารรายกฎ
    // ไม่มีวันเกิดที่ถูกต้อง → ประเมินไม่ได้ (ถัง #89) ลำดับ #103 คงเดิม: ขาดจริงจากกฎอื่นยังเป็น FAIL
    const applicability = ruleApplicability(rule, record);
    if (applicability.kind === 'inapplicable') {
      inapplicableRules.push(inapplicableEntry(rule, applicability));
      continue;
    }
    if (applicability.kind === 'not_evaluable') {
      notEvaluableVaccines.push(rule.display_name);
      continue;
    }
    // Issue #89: ประตูตรวจคอลัมน์รายกฎเดียวกับ View 1 — กฎที่ตัดสินไม่ได้ไม่ถูกนับเป็นขาด
    if (rule.unavailable_reason || (rule.source_aware && !ruleSourceDecidable(rule, record))) {
      notEvaluableVaccines.push(rule.display_name);
      continue;
    }

    // Issue #102: ดูวันที่ครบก่อน — เซลล์ว่างคือขาดจริง (หรือ Pending) แม้กฎมีคำเตือนวันที่ร่วมด้วย
    if (!ruleDatesPresent(record, rule)) {
      const { names, isPending } = resolveMissingRuleNames(rule, currentAgeMonths);
      if (isPending) {
        pendingVaccines.push(...names);
      } else {
        missingVaccines.push(...names);
      }
    } else if (ruleHasDataError(record, rule, rules)) {
      // วันที่ครบแต่มีคำเตือน = ตรวจสอบประวัติ ไม่ใช่ขาด — เก็บ "ชื่อกฎสะอาด" รายละเอียดอยู่ที่คำเตือนในประวัติ
      reviewVaccines.push(rule.display_name);
    } else {
      passedVaccines.push(rule.display_name);
    }
  }

  // ลำดับ Confirmed Missing Dose > ตรวจสอบประวัติ (#102) > Pending Rule > ประเมินไม่ได้ (#103, #119) — เด็กยังเล็กกว่าอายุเกณฑ์
  // คงสถานะ PENDING ตามสัญญา #23 อายุถึงแล้วคอลัมน์ยังไม่ครบจึงเป็น NOT_EVALUABLE (งานตามหาไฟล์ใหม่ #89)
  // ไม่มีกฎ View 2 ที่เปิดใช้เลยก็ตัดสินไม่ได้ ไม่ใช่ผ่าน (fail closed — summary ต้องไม่เป็น 100% ปลอม)
  const status: NonNullable<VaccineStatus['status']> =
    missingVaccines.length > 0 ? 'FAIL'
      : reviewVaccines.length > 0 ? 'REVIEW'
        : pendingVaccines.length > 0 ? 'PENDING'
          : notEvaluableVaccines.length > 0 || v2Rules.length === 0 ? 'NOT_EVALUABLE'
            : 'PASS';

  // Issue #101 (ADR-0006): ผลจากกฎเป็นหลัก `result` ของ HDC แสดงประกอบเท่านั้น ไม่เปลี่ยน status
  // ขัดกัน = ทั้งสองฝ่ายตัดสินผ่าน/ไม่ผ่านแล้วไม่ตรงกัน — ตรวจสอบประวัติ/View 2 Pending/ประเมินไม่ได้ไม่ใช่คำตัดสิน จึงไม่ติดป้าย
  const hdcVerdict = readHdcVerdict(record.result);
  const hdcMismatch = (hdcVerdict === 'PASS' && status === 'FAIL') || (hdcVerdict === 'FAIL' && status === 'PASS');

  return { isFullyImmunized: status === 'PASS', status, missingVaccines, pendingVaccines, passedVaccines, reviewVaccines, notEvaluableVaccines, inapplicableRules, hdcVerdict, hdcMismatch };
};
