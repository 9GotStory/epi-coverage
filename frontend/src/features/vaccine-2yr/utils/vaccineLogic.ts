import type { EpiRecord, VaccineStatus } from '../../../shared/types';
import { isValidVaccineDate } from '../../../shared/utils/dateUtils';
export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  results: Record<string, boolean>;
}



/**
 * มุมมองที่ 1 (2 ปี): ตรวจสอบความครอบคลุมรายชนิด
 */
export function evaluateView1_2Yr(record: EpiRecord): View1Evaluation {
  const missing: string[] = [];
  const results: Record<string, boolean> = {};
  
  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string, 2);
  };

  const evaluateItem = (name: string, isPassed: boolean) => {
    results[name] = isPassed;
    if (!isPassed) missing.push(name);
  };

  evaluateItem('ขาด J11 (LAJE เข็ม 1 หรือ JE1+JE2)', has(record.j11_date) || (has(record.je1_date) && has(record.je2_date)));
  evaluateItem('ขาด 034 (DTP 1 ปีครึ่ง)', has(record.dtp4_date));
  evaluateItem('ขาด 084 (OPV 1 ปีครึ่ง)', has(record.opv4_date));
  evaluateItem('ขาด 061 (MMR เก็บตกเข็ม 1)', has(record.mmr1_date));
  evaluateItem('ขาด 073 (MMR 1 ปีครึ่ง)', has(record.mmr2_date));

  return {
    passedCount: 5 - missing.length,
    missingVaccines: missing,
    results
  };
}

/**
 * มุมมองที่ 2 (2 ปี): ประเมิน Fully Immunized เด็กอายุ 2 ปี
 */
export function evaluateView2_2Yr(record: EpiRecord): VaccineStatus {
  const missing: string[] = [];
  const passed: string[] = [];

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string, 2);
  };

  // 1. BCG
  if (!has(record.bcg_date)) missing.push('ขาด 010 (BCG)'); else passed.push('BCG');

  // 2. HBV 3 times (hbv1, hbv2, hbv4)
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด 041 (HBV แรกเกิด)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด 042 (HBV 2 เดือน)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด 043 (HBV 6 เดือน)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV');

  // 3. DTP 4 times (dtp1, dtp2, dtp3, dtp4)
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด 031 (DTP 2 เดือน)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด 032 (DTP 4 เดือน)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด 033 (DTP 6 เดือน)'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('ขาด 034 (DTP 1 ปีครึ่ง)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP');

  // 4. Hib 3 times (hib1, hib2, hib3)
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด H11 (Hib 2 เดือน)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด H12 (Hib 4 เดือน)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด H13 (Hib 6 เดือน)'); hibPass = false; }
  if (hibPass) passed.push('Hib');

  // 5. IPV 2 times
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด 091 (IPV 2 เดือน)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด 092 (IPV 4 เดือน)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV');

  // 6. OPV 2 times (Usually opv1 and opv4)
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('ขาด 083 (OPV 6 เดือน)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('ขาด 084 (OPV 1 ปีครึ่ง)'); opvPass = false; }
  if (opvPass) passed.push('OPV');

  // 7. MMR 2 times (mmr1, mmr2)
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('ขาด 061 (MMR 9 เดือน)'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('ขาด 073 (MMR 1 ปีครึ่ง)'); mmrPass = false; }
  if (mmrPass) passed.push('MMR');

  // 8. Rota Complete
  let rotaPass = true;
  if (has(record.rv31_date) || has(record.rv32_date) || has(record.rv33_date)) {
    if (!has(record.rv31_date)) { missing.push('ขาด R21 (Rota 2 เดือน)'); rotaPass = false; }
    if (!has(record.rv32_date)) { missing.push('ขาด R22 (Rota 4 เดือน)'); rotaPass = false; }
    if (!has(record.rv33_date)) { missing.push('ขาด R23 (Rota 6 เดือน)'); rotaPass = false; }
  } else if (has(record.rv21_date) || has(record.rv22_date)) {
    if (!has(record.rv21_date)) { missing.push('ขาด R11 (Rota 2 เดือน)'); rotaPass = false; }
    if (!has(record.rv22_date)) { missing.push('ขาด R12 (Rota 4 เดือน)'); rotaPass = false; }
  } else {
    missing.push('ขาด R11/R21 (Rota เข็มแรก)');
    rotaPass = false;
  }
  if (rotaPass) passed.push('Rota');

  // 9. LAJE 1 time OR JE 2 times
  const hasLAJE = has(record.j11_date);
  const hasJEComplete = has(record.je1_date) && has(record.je2_date);
  
  if (hasLAJE || hasJEComplete) {
    passed.push(hasLAJE ? 'LAJE' : 'JE');
  } else {
    if (has(record.je1_date) && !has(record.je2_date)) {
      missing.push('ขาด 052 (JE เข็ม 2)');
    } else {
      missing.push('ขาด J11 (LAJE เข็ม 1)');
    }
  }

  return {
    isFullyImmunized: missing.length === 0,
    missingVaccines: missing,
    passedVaccines: passed
  };
}
