import type { EpiRecord, VaccineStatus } from '../../types';
import type { View1Evaluation } from './vaccine-1yr';

export const TARGET_AGE_MONTHS_MAP: Record<string, number> = {
  // แรกเกิด (0 เดือน)
  '010': 0, '011': 0, // BCG
  '041': 0, // HBV1
  
  // 2 เดือน
  '031': 2, '081': 2, '101': 2, '091': 2, '042': 2, // DTP1, OPV1, Penta1, IPV1, HBV2
  'H11': 2, 'R11': 2, 'R21': 2, 'R31': 2, 'P11': 2, // Hib1, Rota1, PCV1
  
  // 4 เดือน
  '032': 4, '082': 4, '102': 4, '092': 4, 
  'H12': 4, 'R12': 4, 'R22': 4, 'R32': 4, 'P12': 4,
  
  // 6 เดือน
  '033': 6, '083': 6, '103': 6, '043': 6, '044': 6, // 043, 044 = HBV 6 เดือน ในบางระบบ
  'H13': 6, 'R13': 6, 'R33': 6, 'P13': 6,
  
  // 9-12 เดือน
  '061': 9, // MMR1
  '073': 9, '071': 12, 'J11': 12, '051': 12, // LAJE1, JE1, JE เชื้อตาย 1
  
  // 1 ปีครึ่ง (18 เดือน)
  '034': 18, '084': 18, 'D54': 18, 'D14': 18, // DTP4, OPV4, DTP4 (alternate)
  '052': 18, // JE เชื้อตาย 2
  
  // 2 ปีครึ่ง (30 เดือน)
  '074': 30, '062': 30, '072': 30, 'J12': 30, // LAJE2, MMR2, JE2
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
      let targetAge = rule.target_age_months;
      if (targetAge === undefined || targetAge === null || targetAge === '') {
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

      if (targetAge !== undefined && targetAge !== '' && currentAgeMonths < Number(targetAge)) {
        pendingVaccines.push(rule.display_name);
      } else {
        missingVaccines.push(rule.display_name);
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
      let targetAge = rule.target_age_months;
      if (targetAge === undefined || targetAge === null || targetAge === '') {
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

      if (targetAge !== undefined && targetAge !== '' && currentAgeMonths < Number(targetAge)) {
        pendingVaccines.push(rule.display_name);
      } else {
        missingVaccines.push(rule.display_name);
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
      status = 'FAIL';
      if (missingVaccines.length === 0 && pendingVaccines.length === 0) {
        missingVaccines.push('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
      }
    }
  }

  return { isFullyImmunized, status, missingVaccines, pendingVaccines, passedVaccines };
};
