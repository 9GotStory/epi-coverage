import type { EpiRecord, VaccineStatus } from '../../../shared/types';
import { isValidVaccineDate } from '../../../shared/utils/dateUtils';

// การตรวจสอบ 20 เข็มของมุมมองที่ 1
export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  results: Record<string, boolean>; // key เป็นชื่อวัคซีน, value เป็น boolean ว่าผ่านหรือไม่
}

/**
 * มุมมองที่ 1: ตรวจสอบความครอบคลุมรายชนิดวัคซีน 20 รายการ
 * อ้างอิงตาม HDC: ความครอบคลุมของการได้รับวัคซีนตามเกณฑ์ในเด็กอายุครบ 1 ปี ที่ได้รับวัคซีนแต่ละชนิด รายไตรมาส
 */
export function evaluateView1(record: EpiRecord): View1Evaluation {
  const missing: string[] = [];
  const results: Record<string, boolean> = {};
  
  // Helper สำหรับเช็คว่ามีวันที่ฉีด และวันที่ฉีดนั้นอยู่ภายในอายุ 1 ขวบพอดีหรือไม่
  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string);
  };

  const evaluateItem = (name: string, isPassed: boolean) => {
    results[name] = isPassed;
    if (!isPassed) missing.push(name);
  };

  // 1-20 criteria
  evaluateItem('ขาด bcg (แรกเกิด)', has(record.bcg_date));
  evaluateItem('ขาด hbv1 (แรกเกิด)', has(record.hbv1_date));
  evaluateItem('ขาด dtp1 (2 เดือน)', has(record.dtp1_date));
  evaluateItem('ขาด dtp2 (4 เดือน)', has(record.dtp2_date));
  evaluateItem('ขาด dtp3 (6 เดือน)', has(record.dtp3_date));
  evaluateItem('ขาด hbv2 (2 เดือน)', has(record.hbv2_date));
  evaluateItem('ขาด hbv3 (4 เดือน)', has(record.hbv3_date)); // hbv3_date คือวัคซีนรวม 4 เดือน (ไม่นับใน Fully Immunized)
  evaluateItem('ขาด hbv4 (6 เดือน)', has(record.hbv4_date)); // hbv4_date คือวัคซีน 6 เดือน
  evaluateItem('ขาด hib1 (2 เดือน)', has(record.hib1_date));
  evaluateItem('ขาด hib2 (4 เดือน)', has(record.hib2_date));
  evaluateItem('ขาด hib3 (6 เดือน)', has(record.hib3_date));
  evaluateItem('ขาด ipv1 (2 เดือน)', has(record.ipv1_date));
  evaluateItem('ขาด ipv2 (4 เดือน)', has(record.ipv2_date));
  evaluateItem('ขาด opv1 (6 เดือน)', has(record.opv1_date)); // opv1_date ใน Sheet = OPV 6 เดือน
  evaluateItem('ขาด mmr1 (9 เดือน)', has(record.mmr1_date));
  
  const rota21 = has(record.rv21_date) || has(record.rv31_date);
  evaluateItem('ขาด Rota (2 เดือน)', rota21);

  const rotaComplete = (has(record.rv21_date) && has(record.rv22_date)) || 
                       (has(record.rv31_date) && has(record.rv32_date) && has(record.rv33_date));
  evaluateItem('ขาด Rota (ครบถ้วน)', rotaComplete);
  
  evaluateItem('ขาด pcv1 (2 เดือน)', has(record.pcv1_date));
  evaluateItem('ขาด pcv2 (4 เดือน)', has(record.pcv2_date));
  evaluateItem('ขาด pcv3 (6 เดือน)', has(record.pcv3_date));

  return {
    passedCount: 20 - missing.length, // อาจจะไม่ใช่ 20 แล้ว แต่ passedCount ไม่ได้ใช้ใน UI
    missingVaccines: missing,
    results
  };
}

/**
 * มุมมองที่ 2: ประเมิน Fully Immunized เด็กอายุ 1 ปี
 * อ้างอิงตาม HDC: ความครอบคลุมการได้รับวัคซีนแต่ละชนิดครบตามเกณฑ์ในเด็กอายุครบ 1 ปี (fully immunized)
 */
export function evaluateView2(record: EpiRecord): VaccineStatus {
  const missing: string[] = [];
  const passed: string[] = [];

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(record.birth as string, dateStr as string);
  };

  // 1. BCG
  if (!has(record.bcg_date)) missing.push('ขาด bcg (แรกเกิด)'); else passed.push('BCG');

  // 2. HBV 3 times (hbv1_date, hbv2_date, hbv4_date)
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด hbv1 (แรกเกิด)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด hbv2 (2 เดือน)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด hbv4 (6 เดือน)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV');

  // 3. DTP 3 times
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด dtp1 (2 เดือน)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด dtp2 (4 เดือน)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด dtp3 (6 เดือน)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP');

  // 4. Hib 3 times
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

  // 6. OPV 1 time (ที่อายุ 6 เดือน ซึ่งใน sheet คือ opv1_date)
  if (!has(record.opv1_date)) missing.push('ขาด opv1 (6 เดือน)'); else passed.push('OPV');

  // 7. MMR 1 time
  if (!has(record.mmr1_date)) missing.push('ขาด mmr1 (9 เดือน)'); else passed.push('MMR');

  // 8. Rota 2 or 3 times
  let rotaPass = true;
  if (has(record.rv31_date) || has(record.rv32_date) || has(record.rv33_date)) {
    // ใช้แบบ 3 เข็ม
    if (!has(record.rv31_date)) { missing.push('ขาด rv31 (2 เดือน)'); rotaPass = false; }
    if (!has(record.rv32_date)) { missing.push('ขาด rv32 (4 เดือน)'); rotaPass = false; }
    if (!has(record.rv33_date)) { missing.push('ขาด rv33 (6 เดือน)'); rotaPass = false; }
  } else if (has(record.rv21_date) || has(record.rv22_date)) {
    // ใช้แบบ 2 เข็ม
    if (!has(record.rv21_date)) { missing.push('ขาด rv21 (2 เดือน)'); rotaPass = false; }
    if (!has(record.rv22_date)) { missing.push('ขาด rv22 (4 เดือน)'); rotaPass = false; }
  } else {
    // ไม่มีข้อมูลเลย
    missing.push('ขาด Rota (เข็มแรก)');
    rotaPass = false;
  }
  if (rotaPass) passed.push('Rota');

  return {
    isFullyImmunized: missing.length === 0,
    missingVaccines: missing,
    passedVaccines: passed
  };
}


