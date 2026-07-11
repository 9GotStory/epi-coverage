import type { EpiRecord, VaccineStatus } from '@/shared/types';
import { isValidVaccineDate } from '@/shared/utils/dateUtils';

export interface View1Status {
  isPassedAll: boolean;
  missingVaccines: string[];
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
    missingVaccines.push('DTP (คอตีบ บาดทะยัก ไอกรน) - เข็มกระตุ้นอายุ 4 ปี');
    isPassedAll = false;
  }
  if (!has(r.opv5_date)) {
    missingVaccines.push('OPV (โปลิโอชนิดหยอด) - เข็มกระตุ้นอายุ 4 ปี');
    isPassedAll = false;
  }

  return {
    isPassedAll,
    missingVaccines
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
  const bcg = has(r.bcg_date);
  if (!bcg) missingVaccines.push('BCG');
  
  // 2. HBV 3 ครั้ง (แรกเกิด, 2 เดือน, 6 เดือน)
  const hbv = has(r.hbv1_date) && has(r.hbv2_date) && has(r.hbv4_date);
  if (!hbv) missingVaccines.push('HBV 3 เข็ม (แรกเกิด, 2m, 6m)');
  
  // 3. DTP 5 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  const dtp = has(r.dtp1_date) && has(r.dtp2_date) && has(r.dtp3_date) && has(r.dtp4_date) && has(r.dtp5_date);
  if (!dtp) missingVaccines.push('DTP ครบ 5 เข็ม');
  
  // 4. Hib 3 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน)
  const hib = has(r.hib1_date) && has(r.hib2_date) && has(r.hib3_date);
  if (!hib) missingVaccines.push('Hib ครบ 3 เข็ม');
  
  // 5. IPV 2 ครั้ง (2 เดือน, 4 เดือน)
  const ipv = has(r.ipv1_date) && has(r.ipv2_date);
  if (!ipv) missingVaccines.push('IPV ครบ 2 เข็ม');
  
  // 6. OPV 3 ครั้ง ตาม EPI ใหม่ (6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  const opv = has(r.opv1_date) && has(r.opv4_date) && has(r.opv5_date);
  if (!opv) missingVaccines.push('OPV ครบ 3 ครั้ง (6m, 1.5y, 4y)');
  
  // 7. MMR 2 ครั้ง (9 เดือน, 1 ปี 6 เดือน)
  const mmr = has(r.mmr1_date) && has(r.mmr2_date);
  if (!mmr) missingVaccines.push('MMR ครบ 2 เข็ม (9m, 1.5y)');
  
  // 8. Rota (2 or 3 doses complete)
  const rota2 = has(r.rv21_date) && has(r.rv22_date);
  const rota3 = has(r.rv31_date) && has(r.rv32_date) && has(r.rv33_date);
  const rota = rota2 || rota3;
  if (!rota) missingVaccines.push('Rota (ครบตามเกณฑ์)');
  
  // 9. LAJE / JE
  const laje = has(r.j11_date) && has(r.j12_date);
  const je = has(r.je1_date) && has(r.je2_date) && has(r.je3_date);
  const lajeJe = laje || je;
  if (!lajeJe) missingVaccines.push('LAJE ครบ 2 หรือ JE ครบ 3 เข็ม');

  const isFullyImmunized = bcg && hbv && dtp && hib && ipv && opv && mmr && rota && lajeJe;

  return {
    isFullyImmunized,
    missingVaccines,
    passedVaccines: []
  };
};
