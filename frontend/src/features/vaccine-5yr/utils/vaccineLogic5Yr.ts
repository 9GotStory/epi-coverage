import type { EpiRecord, VaccineStatus } from '@/shared/types';
import { isValidVaccineDate } from '@/shared/utils/dateUtils';

export interface View1Status {
  isPassedAll: boolean;
  missingVaccines: string[];
  passedCount: number;
  results: Record<string, boolean>;
}

export interface View2Status {
  isFullyImmunized: boolean;
  missingVaccines: string[];
}

// ==========================================
// View 1 (Individual) - เด็ก 5 ปี
// เกณฑ์: DTP 4 ปี และ OPV 4 ปี (เข็มที่ 5)
// ==========================================
export const evaluateView1_5Yr = (r: EpiRecord): View1Status => {
  const missingVaccines: string[] = [];
  let isPassedAll = true;

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(r.birth as string, dateStr as string, 5);
  };

  if (!has(r.dtp5_date)) {
    missingVaccines.push('ขาด DTP เข็ม 5 (035)');
    isPassedAll = false;
  }
  if (!has(r.opv5_date)) {
    missingVaccines.push('ขาด OPV เข็ม 5 (085)');
    isPassedAll = false;
  }

  const results: Record<string, boolean> = {
    'DTP เข็ม 5 (035)': has(r.dtp5_date),
    'OPV เข็ม 5 (085)': has(r.opv5_date)
  };

  return {
    isPassedAll,
    missingVaccines,
    passedCount: 2 - missingVaccines.length,
    results
  };
};

// ==========================================
// View 2 (Fully Immunized) - เด็ก 5 ปี
// เกณฑ์: สะสม BCG(1), HBV(3), DTP(5), Hib(3), IPV(2), OPV(3), MMR(2), Rota(ครบ), LAJE(2) หรือ JE(3)
// ==========================================
export const evaluateView2_5Yr = (r: EpiRecord): VaccineStatus => {
  const missingVaccines: string[] = [];

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(r.birth as string, dateStr as string, 5);
  };

  // 1. BCG
  if (!has(r.bcg_date)) missingVaccines.push('ขาด BCG (010)');
  
  // 2. HBV 3 ครั้ง (แรกเกิด, 2 เดือน, 6 เดือน)
  if (!has(r.hbv1_date)) missingVaccines.push('ขาด HBV เข็ม 1 (041)');
  if (!has(r.hbv2_date)) missingVaccines.push('ขาด HBV เข็ม 2 (042)');
  if (!has(r.hbv4_date)) missingVaccines.push('ขาด HBV เข็ม 4 (043)');
  
  // 3. DTP 5 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  if (!has(r.dtp1_date)) missingVaccines.push('ขาด DTP เข็ม 1 (031)');
  if (!has(r.dtp2_date)) missingVaccines.push('ขาด DTP เข็ม 2 (032)');
  if (!has(r.dtp3_date)) missingVaccines.push('ขาด DTP เข็ม 3 (033)');
  if (!has(r.dtp4_date)) missingVaccines.push('ขาด DTP เข็ม 4 (034)');
  if (!has(r.dtp5_date)) missingVaccines.push('ขาด DTP เข็ม 5 (035)');
  
  // 4. Hib 3 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน)
  if (!has(r.hib1_date)) missingVaccines.push('ขาด Hib เข็ม 1 (H11)');
  if (!has(r.hib2_date)) missingVaccines.push('ขาด Hib เข็ม 2 (H12)');
  if (!has(r.hib3_date)) missingVaccines.push('ขาด Hib เข็ม 3 (H13)');
  
  // 5. IPV 2 ครั้ง (2 เดือน, 4 เดือน)
  if (!has(r.ipv1_date)) missingVaccines.push('ขาด IPV เข็ม 1 (091)');
  if (!has(r.ipv2_date)) missingVaccines.push('ขาด IPV เข็ม 2 (092)');
  
  // 6. OPV 3 ครั้ง ตาม EPI ใหม่ (6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  if (!has(r.opv1_date)) missingVaccines.push('ขาด OPV เข็ม 3 (083)');
  if (!has(r.opv4_date)) missingVaccines.push('ขาด OPV เข็ม 4 (084)');
  if (!has(r.opv5_date)) missingVaccines.push('ขาด OPV เข็ม 5 (085)');
  
  // 7. MMR 2 ครั้ง (9 เดือน, 1 ปี 6 เดือน)
  if (!has(r.mmr1_date)) missingVaccines.push('ขาด MMR เข็ม 1 (061)');
  if (!has(r.mmr2_date)) missingVaccines.push('ขาด MMR เข็ม 2 (073)');
  
  // 8. Rota (2 or 3 doses complete)
  if (has(r.rv31_date) || has(r.rv32_date) || has(r.rv33_date)) {
    // ใช้แบบ 3 เข็ม
    if (!has(r.rv31_date)) missingVaccines.push('ขาด Rota เข็ม 1 (R21)');
    if (!has(r.rv32_date)) missingVaccines.push('ขาด Rota เข็ม 2 (R22)');
    if (!has(r.rv33_date)) missingVaccines.push('ขาด Rota เข็ม 3 (R23)');
  } else if (has(r.rv21_date) || has(r.rv22_date)) {
    // ใช้แบบ 2 เข็ม
    if (!has(r.rv21_date)) missingVaccines.push('ขาด Rota เข็ม 1 (R11)');
    if (!has(r.rv22_date)) missingVaccines.push('ขาด Rota เข็ม 2 (R12)');
  } else {
    // ไม่มีข้อมูลเลย
    missingVaccines.push('ขาด Rota (เข็มแรก)');
  }
  
  // 9. LAJE / JE
  if (has(r.je1_date) || has(r.je2_date) || has(r.je3_date)) {
    // เชื้อตาย 3 เข็ม
    if (!has(r.je1_date)) missingVaccines.push('ขาด JE เข็ม 1 (051)');
    if (!has(r.je2_date)) missingVaccines.push('ขาด JE เข็ม 2 (052)');
    if (!has(r.je3_date)) missingVaccines.push('ขาด JE เข็ม 3 (053)');
  } else if (has(r.j11_date) || has(r.j12_date)) {
    // เชื้อเป็น 2 เข็ม
    if (!has(r.j11_date)) missingVaccines.push('ขาด LAJE เข็ม 1 (J11)');
    if (!has(r.j12_date)) missingVaccines.push('ขาด LAJE เข็ม 2 (J12)');
  } else {
    // ไม่มีข้อมูลเลย
    missingVaccines.push('ขาด LAJE/JE (เข็มแรก)');
  }

  const isFullyImmunized = missingVaccines.length === 0;

  return {
    isFullyImmunized,
    missingVaccines,
    passedVaccines: []
  };
};
