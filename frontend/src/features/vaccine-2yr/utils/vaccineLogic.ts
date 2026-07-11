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

  evaluateItem('ขาด pcv (1 ปี)', has(record.pcv3_date) || has(record.pcv4_date)); // Typically PCV3 or PCV4
  evaluateItem('ขาด j11 (หรือ je1+je2)', has(record.j11_date) || (has(record.je1_date) && has(record.je2_date)));
  evaluateItem('ขาด dtp4 (1 ปีครึ่ง)', has(record.dtp4_date));
  evaluateItem('ขาด opv4 (1 ปีครึ่ง)', has(record.opv4_date));
  evaluateItem('ขาด mmr1 (เก็บตก)', has(record.mmr1_date));
  evaluateItem('ขาด mmr2 (1 ปีครึ่ง)', has(record.mmr2_date));

  return {
    passedCount: 6 - missing.length,
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
  if (!has(record.bcg_date)) missing.push('ขาด bcg (แรกเกิด)'); else passed.push('BCG');

  // 2. HBV 3 times (hbv1, hbv2, hbv4)
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด hbv1 (แรกเกิด)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด hbv2 (2 เดือน)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด hbv4 (6 เดือน)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV');

  // 3. DTP 4 times (dtp1, dtp2, dtp3, dtp4)
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด dtp1 (2 เดือน)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด dtp2 (4 เดือน)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด dtp3 (6 เดือน)'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('ขาด dtp4 (1 ปีครึ่ง)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP');

  // 4. Hib 3 times (hib1, hib2, hib3)
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด hib1 (2 เดือน)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด hib2 (4 เดือน)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด hib3 (6 เดือน)'); hibPass = false; }
  if (hibPass) passed.push('Hib');

  // 5. IPV 2 times
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด ipv1 (2 เดือน)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด ipv2 (4 เดือน)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV');

  // 6. OPV 2 times (Usually opv1 and opv4)
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('ขาด opv1 (6 เดือน)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('ขาด opv4 (1 ปีครึ่ง)'); opvPass = false; }
  if (opvPass) passed.push('OPV');

  // 7. MMR 2 times (mmr1, mmr2)
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('ขาด mmr1 (9 เดือน)'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('ขาด mmr2 (1 ปีครึ่ง)'); mmrPass = false; }
  if (mmrPass) passed.push('MMR');

  // 8. Rota Complete
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

  // 9. LAJE 1 time OR JE 2 times
  if (has(record.je1_date) || has(record.je2_date)) {
    let jePass = true;
    if (!has(record.je1_date)) { missing.push('ขาด je1 (JE เข็ม 1)'); jePass = false; }
    if (!has(record.je2_date)) { missing.push('ขาด je2 (JE เข็ม 2)'); jePass = false; }
    if (jePass) passed.push('JE');
  } else {
    if (!has(record.j11_date)) { missing.push('ขาด j11 (LAJE เข็ม 1)'); }
    else { passed.push('LAJE'); }
  }

  return {
    isFullyImmunized: missing.length === 0,
    missingVaccines: missing,
    passedVaccines: passed
  };
}
