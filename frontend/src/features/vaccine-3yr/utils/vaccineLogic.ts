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
  let lajePass = has(record.j12_date) || has(record.je3_date);
  
  if (!lajePass) {
    if (has(record.je1_date) || has(record.je2_date)) {
      missing.push('ขาด JE เข็ม 3 (053)');
    } else {
      missing.push('ขาด LAJE เข็ม 2 (J12)');
    }
  }
  results['LAJE2/JE3'] = lajePass;

  return {
    passedCount: lajePass ? 1 : 0,
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
  if (!has(record.bcg_date)) missing.push('ขาด BCG (010)'); else passed.push('BCG');

  // 2. HBV (3) - hbv1, hbv2, hbv4
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด HBV เข็ม 1 (041)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด HBV เข็ม 2 (042)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด HBV เข็ม 4 (043)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV');

  // 3. DTP (4) - dtp1, dtp2, dtp3, dtp4
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด DTP เข็ม 1 (031)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด DTP เข็ม 2 (032)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด DTP เข็ม 3 (033)'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('ขาด DTP เข็ม 4 (034)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP');

  // 4. Hib (3) - hib1, hib2, hib3
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด Hib เข็ม 1 (H11)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด Hib เข็ม 2 (H12)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด Hib เข็ม 3 (H13)'); hibPass = false; }
  if (hibPass) passed.push('Hib');

  // 5. IPV (2)
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด IPV เข็ม 1 (091)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด IPV เข็ม 2 (092)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV');

  // 6. OPV (2)
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('ขาด OPV เข็ม 3 (083)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('ขาด OPV เข็ม 4 (084)'); opvPass = false; }
  if (opvPass) passed.push('OPV');

  // 7. MMR (2)
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('ขาด MMR เข็ม 1 (061)'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('ขาด MMR เข็ม 2 (073)'); mmrPass = false; }
  if (mmrPass) passed.push('MMR');

  // 8. Rota Complete (2 or 3 doses)
  let rotaPass = true;
  if (has(record.rv31_date) || has(record.rv32_date) || has(record.rv33_date)) {
    if (!has(record.rv31_date)) { missing.push('ขาด Rota เข็ม 1 (R21)'); rotaPass = false; }
    if (!has(record.rv32_date)) { missing.push('ขาด Rota เข็ม 2 (R22)'); rotaPass = false; }
    if (!has(record.rv33_date)) { missing.push('ขาด Rota เข็ม 3 (R23)'); rotaPass = false; }
  } else if (has(record.rv21_date) || has(record.rv22_date)) {
    if (!has(record.rv21_date)) { missing.push('ขาด Rota เข็ม 1 (R11)'); rotaPass = false; }
    if (!has(record.rv22_date)) { missing.push('ขาด Rota เข็ม 2 (R12)'); rotaPass = false; }
  } else {
    missing.push('ขาด Rota (เข็มแรก)');
    rotaPass = false;
  }
  if (rotaPass) passed.push('Rota');

  // 9. LAJE 2 ครั้ง หรือ JE 3 ครั้ง
  let jeCompletePass = true;
  if (has(record.je1_date) || has(record.je2_date) || has(record.je3_date)) {
    if (!has(record.je1_date)) { missing.push('ขาด JE เข็ม 1 (051)'); jeCompletePass = false; }
    if (!has(record.je2_date)) { missing.push('ขาด JE เข็ม 2 (052)'); jeCompletePass = false; }
    if (!has(record.je3_date)) { missing.push('ขาด JE เข็ม 3 (053)'); jeCompletePass = false; }
  } else {
    if (!has(record.j11_date)) { missing.push('ขาด LAJE เข็ม 1 (J11)'); jeCompletePass = false; }
    if (!has(record.j12_date)) { missing.push('ขาด LAJE เข็ม 2 (J12)'); jeCompletePass = false; }
  }
  if (jeCompletePass) passed.push('LAJE/JE');

  return {
    isFullyImmunized: missing.length === 0,
    missingVaccines: missing,
    passedVaccines: passed
  };
}
