import type { EpiRecord, VaccineStatus } from '../../../shared/types';
import { isValidVaccineDate } from '../../../shared/utils/dateUtils';

export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  results: Record<string, boolean>;
}

/**
 * มุมมองที่ 1 (3 ปี): ตรวจสอบความครอบคลุมรายชนิด
 * เน้นที่ LAJE 2 หรือ JE 3
 */
export function evaluateView1_3Yr(record: EpiRecord): View1Evaluation {
  const missing: string[] = [];
  const results: Record<string, boolean> = {};
  
  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string, 3);
  };


  // View 1 (รายเข็ม): เช็คความครบถ้วนของ LAJE 2 ครั้ง หรือ JE 3 ครั้ง
  let lajePass = true;
  if (has(record.je1_date) || has(record.je2_date) || has(record.je3_date)) {
    if (!has(record.je1_date)) { missing.push('ขาด je1 (JE เข็ม 1)'); lajePass = false; }
    if (!has(record.je2_date)) { missing.push('ขาด je2 (JE เข็ม 2)'); lajePass = false; }
    if (!has(record.je3_date)) { missing.push('ขาด je3 (JE เข็ม 3)'); lajePass = false; }
  } else {
    if (!has(record.j11_date)) { missing.push('ขาด j11 (LAJE เข็ม 1)'); lajePass = false; }
    if (!has(record.j12_date)) { missing.push('ขาด j12 (LAJE เข็ม 2)'); lajePass = false; }
  }
  results['LAJE/JE'] = lajePass;

  return {
    passedCount: 1 - missing.length,
    missingVaccines: missing,
    results
  };
}

/**
 * มุมมองที่ 2 (3 ปี): ประเมิน Fully Immunized เด็กอายุ 3 ปี
 */
export function evaluateView2_3Yr(record: EpiRecord): VaccineStatus {
  const missing: string[] = [];
  const passed: string[] = [];

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string, 3);
  };

  // 1. BCG (1)
  if (!has(record.bcg_date)) missing.push('ขาด bcg (แรกเกิด)'); else passed.push('BCG');

  // 2. HBV (3) - hbv1, hbv2, hbv4
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด hbv1 (แรกเกิด)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด hbv2 (2 เดือน)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด hbv4 (6 เดือน)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV');

  // 3. DTP (4) - dtp1, dtp2, dtp3, dtp4
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด dtp1 (2 เดือน)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด dtp2 (4 เดือน)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด dtp3 (6 เดือน)'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('ขาด dtp4 (1 ปีครึ่ง)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP');

  // 4. Hib (3) - hib1, hib2, hib3
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด hib1 (2 เดือน)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด hib2 (4 เดือน)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด hib3 (6 เดือน)'); hibPass = false; }
  if (hibPass) passed.push('Hib');

  // 5. IPV (2)
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด ipv1 (2 เดือน)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด ipv2 (4 เดือน)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV');

  // 6. OPV (2)
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('ขาด opv1 (6 เดือน)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('ขาด opv4 (1 ปีครึ่ง)'); opvPass = false; }
  if (opvPass) passed.push('OPV');

  // 7. MMR (2)
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('ขาด mmr1 (9 เดือน)'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('ขาด mmr2 (1 ปีครึ่ง)'); mmrPass = false; }
  if (mmrPass) passed.push('MMR');

  // 8. Rota Complete (2 or 3 doses)
  let rotaPass = true;
  if (has(record.rv31_date) || has(record.rv32_date) || has(record.rv33_date)) {
    if (!has(record.rv31_date)) { missing.push('ขาด rv31 (2 เดือน)'); rotaPass = false; }
    if (!has(record.rv32_date)) { missing.push('ขาด rv32 (4 เดือน)'); rotaPass = false; }
    if (!has(record.rv33_date)) { missing.push('ขาด rv33 (6 เดือน)'); rotaPass = false; }
  } else if (has(record.rv21_date) || has(record.rv22_date)) {
    if (!has(record.rv21_date)) { missing.push('ขาด rv21 (2 เดือน)'); rotaPass = false; }
    if (!has(record.rv22_date)) { missing.push('ขาด rv22 (4 เดือน)'); rotaPass = false; }
  } else {
    missing.push('ขาด Rota (เข็มแรก)');
    rotaPass = false;
  }
  if (rotaPass) passed.push('Rota');

  // 9. LAJE 2 ครั้ง หรือ JE 3 ครั้ง
  let jeCompletePass = true;
  if (has(record.je1_date) || has(record.je2_date) || has(record.je3_date)) {
    if (!has(record.je1_date)) { missing.push('ขาด je1 (JE เข็ม 1)'); jeCompletePass = false; }
    if (!has(record.je2_date)) { missing.push('ขาด je2 (JE เข็ม 2)'); jeCompletePass = false; }
    if (!has(record.je3_date)) { missing.push('ขาด je3 (JE เข็ม 3)'); jeCompletePass = false; }
  } else {
    if (!has(record.j11_date)) { missing.push('ขาด j11 (LAJE เข็ม 1)'); jeCompletePass = false; }
    if (!has(record.j12_date)) { missing.push('ขาด j12 (LAJE เข็ม 2)'); jeCompletePass = false; }
  }
  if (jeCompletePass) passed.push('LAJE/JE');

  return {
    isFullyImmunized: missing.length === 0,
    missingVaccines: missing,
    passedVaccines: passed
  };
}
