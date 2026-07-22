import type { EpiRecord, VaccineStatus } from '../../types';
import type { View1Evaluation } from './vaccine-1yr';

export const TARGET_AGE_MONTHS_MAP: Record<string, number> = {
  // แรกเกิด (0 เดือน)
  '010': 0, '011': 0, // BCG
  '041': 0, // HBV1
  
  // 2 เดือน
  '031': 2, '081': 2, 'D21': 2, 'I11': 2, '042': 2, // DTP1, OPV1, Penta1 (D21), IPV1, HBV2
  'R11': 2, 'R21': 2, 'R31': 2, 'P11': 2, // Rota1, PCV1
  
  // 4 เดือน
  '032': 4, '082': 4, 'D22': 4, 'I12': 4, // DTP2, OPV2, Penta2, IPV2
  'R12': 4, 'R22': 4, 'R32': 4, 'P12': 4,
  
  // 6 เดือน
  '033': 6, '083': 6, 'D23': 6, '043': 6, '044': 6, // DTP3, OPV3, Penta3, HBV3
  'R13': 6, 'R33': 6, 'P13': 6,
  
  // 9-12 เดือน
  '061': 9, // MMR1
  'J11': 12, '051': 12, // LAJE1, JE1 (เชื้อตาย 1)
  
  // 1 ปีครึ่ง (18 เดือน)
  '034': 18, '084': 18, // DTP4, OPV4
  '073': 18, // MMR2
  '052': 18, // JE เชื้อตาย 2
  
  // 2 ปีครึ่ง (30 เดือน)
  '074': 30, 'J12': 30, // LAJE2, MRC
  '053': 30, // JE เชื้อตาย 3
  
  // 4 ปี (48 เดือน)
  '035': 48, '085': 48, 'D35': 48, 'D45': 48, 'D55': 48, 'T11': 48, 'I15': 48, // DTP5, OPV5 และรหัสทางเลือก
};

export const getAgeInMonths = (birthDateStr: string | Date | undefined, evaluationDate: Date = new Date()): number => {
  if (!birthDateStr) return 999; // If no birth date, assume reached age
  const birthDate = typeof birthDateStr === 'string' ? new Date(birthDateStr) : birthDateStr;
  if (isNaN(birthDate.getTime())) return 999;

  let months = (evaluationDate.getFullYear() - birthDate.getFullYear()) * 12;
  months -= birthDate.getMonth();
  months += evaluationDate.getMonth();
  
  if (evaluationDate.getDate() < birthDate.getDate()) {
    months--;
  }
  
  return months >= 0 ? months : 0;
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
export const hasDose = (record: EpiRecord, field: keyof EpiRecord, birthDate?: string | Date): boolean => {
  const val = record[field];
  if (!val || typeof val !== 'string') return false;
  
  // ตัด Time ออกถ้ามี
  const cleanVal = val.split('T')[0].trim();
  if (cleanVal === '' || cleanVal === '-') return false;
  
  // บางครั้งข้อมูลลงผิดเป็นวันเกิด แต่สำหรับ BCG และ HBV เข็ม 1 ฉีดแรกเกิดได้
  if (birthDate) {
    const birthStr = typeof birthDate === 'string' ? birthDate : birthDate.toISOString();
    const cleanBirth = birthStr.split('T')[0].trim();
    
    // ข้อมูลผิดพลาด: วันที่ฉีดก่อนวันเกิด
    if (cleanVal < cleanBirth) {
      return false;
    }

    // ข้อมูลผิดพลาด: ลงผิดเป็นวันเกิด (ยกเว้น BCG และ HBV1)
    if (cleanVal === cleanBirth) {
      if (field !== 'bcg_date' && field !== 'hbv1_date') {
        return false;
      }
    }
  }
  
  return true;
};

const VACCINE_FAMILIES = [
  ['hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date'],
  ['dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp5_date'],
  ['opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv5_date'],
  ['hib1_date', 'hib2_date', 'hib3_date'],
  ['ipv1_date', 'ipv2_date'],
  ['mmr1_date', 'mmr2_date'],
  ['rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date'],
  ['pcv1_date', 'pcv2_date', 'pcv3_date', 'pcv4_date'],
  ['je1_date', 'je2_date', 'je3_date'],
  ['j11_date', 'j12_date']
];

// O(1) Lookup Map for performance best practice
const FIELD_TO_FAMILY_MAP: Record<string, string[]> = {};
for (const family of VACCINE_FAMILIES) {
  for (const f of family) {
    FIELD_TO_FAMILY_MAP[f] = family;
  }
}

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

  // 2. Check Same-day Duplicates in same vaccine family (Optimized Lookup)
  const family = FIELD_TO_FAMILY_MAP[field as string];
  if (family) {
    let matchCount = 0;
    for (const f of family) {
      const fVal = record[f as keyof EpiRecord];
      if (fVal && typeof fVal === 'string') {
        const cleanFVal = fVal.split('T')[0].trim();
        if (cleanFVal !== '' && cleanFVal !== '-' && cleanFVal === cleanVal) {
          matchCount++;
        }
      }
    }
    // If more than 1 field in the same family has this exact same date, it's a duplicate error
    if (matchCount > 1) {
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
  if (targetAge === undefined || targetAge === null) {
    const hdcCodeStr = rule.hdc_code ? String(rule.hdc_code) : '';
    const codes = hdcCodeStr.split(/[-,\/\s]+/).map(c => c.trim().padStart(3, '0')).filter(Boolean);
    let maxAge = -1;
    for (const code of codes) {
      if (TARGET_AGE_MONTHS_MAP[code] !== undefined) {
        maxAge = Math.max(maxAge, TARGET_AGE_MONTHS_MAP[code]);
      }
    }
    targetAge = maxAge !== -1 ? maxAge : undefined;
  }
  
  let isPending = targetAge !== undefined && currentAgeMonths < targetAge;
  
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
