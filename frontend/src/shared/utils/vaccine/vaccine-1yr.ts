import type { EpiRecord, VaccineStatus } from '../../../shared/types';
import { isValidVaccineDate } from '../../../shared/utils/dateUtils';

// การตรวจสอบ 20 เข็มของมุมมองที่ 1
export interface View1Evaluation {
  passedCount: number;
  missingVaccines: string[];
  pendingVaccines?: string[]; // วัคซีนที่อายุยังไม่ถึงเกณฑ์
  results: Record<string, boolean>; // key เป็นชื่อวัคซีน, value เป็น boolean ว่าผ่านหรือไม่
}

/**
 * มุมมองที่ 1: ตรวจสอบความครอบคลุมรายชนิดวัคซีน 17 รายการ
 * อ้างอิงตาม HDC: ความครอบคลุมของการได้รับวัคซีนตามเกณฑ์ในเด็กอายุครบ 1 ปี ที่ได้รับวัคซีนแต่ละชนิด รายไตรมาส
 */
export function evaluateView1(record: EpiRecord): View1Evaluation {
  const missing: string[] = [];
  const results: Record<string, boolean> = {};
  
  /**
   * Helper สำหรับมุมมองที่ 1 โดยเฉพาะ
   * HDC นับว่า "ได้รับวัคซีน" = มีวันที่ที่ถูกต้อง และวันที่ฉีด >= วันเกิด
   * ไม่ใช้ deadline ของไตรมาส เพราะ HDC นับ "สะสม" ทุกเข็มที่บันทึกไว้ในระบบ
   */
  const has = (dateStr?: string | null): boolean => {
    if (!dateStr || !record.birth) return false;
    const vDate = new Date(dateStr);
    const bDate = new Date(record.birth as string);
    if (isNaN(vDate.getTime()) || isNaN(bDate.getTime())) return false;
    return vDate >= bDate; // ฉีดหลังวันเกิด = นับว่าได้รับ (ไม่จำกัด deadline)
  };

  const evaluateItem = (name: string, isPassed: boolean) => {
    results[name] = isPassed;
    if (!isPassed) missing.push(name);
  };

  // 1-20 criteria
  evaluateItem('ขาด BCG (010)', has(record.bcg_date));
  evaluateItem('ขาด HBV เข็ม 1 (041)', has(record.hbv1_date));
  evaluateItem('ขาด DTP เข็ม 1 (031)', has(record.dtp1_date));
  evaluateItem('ขาด DTP เข็ม 2 (032)', has(record.dtp2_date));
  evaluateItem('ขาด DTP เข็ม 3 (033)', has(record.dtp3_date));
  evaluateItem('ขาด HBV เข็ม 2 (042)', has(record.hbv2_date));
  evaluateItem('ขาด HBV เข็ม 3 (043)', has(record.hbv3_date)); // hbv3_date คือวัคซีนรวม 4 เดือน (ไม่นับใน Fully Immunized)
  evaluateItem('ขาด HBV เข็ม 4 (043)', has(record.hbv4_date)); // hbv4_date คือวัคซีน 6 เดือน
  evaluateItem('ขาด Hib เข็ม 1 (H11)', has(record.hib1_date));
  evaluateItem('ขาด Hib เข็ม 2 (H12)', has(record.hib2_date));
  evaluateItem('ขาด Hib เข็ม 3 (H13)', has(record.hib3_date));
  evaluateItem('ขาด IPV เข็ม 1 (091)', has(record.ipv1_date));
  evaluateItem('ขาด IPV เข็ม 2 (092)', has(record.ipv2_date));
  evaluateItem('ขาด OPV เข็ม 3 (083)', has(record.opv1_date)); // opv1_date ใน Sheet = OPV 6 เดือน
  evaluateItem('ขาด MMR เข็ม 1 (061)', has(record.mmr1_date));
  
  const rota21 = has(record.rv21_date) || has(record.rv31_date);
  evaluateItem('ขาด Rota เข็ม 1 (R11/R21)', rota21);

  const rotaComplete = (has(record.rv21_date) && has(record.rv22_date)) || 
                       (has(record.rv31_date) && has(record.rv32_date) && has(record.rv33_date));
  evaluateItem('ขาด Rota (ครบถ้วน)', rotaComplete);
  
  return {
    passedCount: 17 - missing.length,
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
  if (!has(record.bcg_date)) missing.push('ขาด BCG (010)'); else passed.push('BCG 1 เข็ม');

  // 2. HBV 3 times
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด HBV เข็ม 1 (041)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด HBV เข็ม 2 (042)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด HBV เข็ม 4 (043)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV ครบ 3 เข็ม');

  // 3. DTP 3 times
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด DTP เข็ม 1 (031)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด DTP เข็ม 2 (032)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด DTP เข็ม 3 (033)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP ครบ 3 เข็ม');

  // 4. Hib 3 times
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด Hib เข็ม 1 (H11)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด Hib เข็ม 2 (H12)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด Hib เข็ม 3 (H13)'); hibPass = false; }
  if (hibPass) passed.push('Hib ครบ 3 เข็ม');

  // 5. IPV 2 times
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด IPV เข็ม 1 (091)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด IPV เข็ม 2 (092)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV ครบ 2 เข็ม');

  // 6. OPV 1 time (ที่อายุ 6 เดือน ซึ่งใน sheet คือ opv1_date)
  if (!has(record.opv1_date)) missing.push('ขาด OPV เข็ม 3 (083)'); else passed.push('OPV 3');

  // 7. MMR 1 time
  if (!has(record.mmr1_date)) missing.push('ขาด MMR เข็ม 1 (061)'); else passed.push('MMR 1 เข็ม');

  // 8. Rota 2 or 3 times
  let rotaPass = true;
  if (has(record.rv31_date) || has(record.rv32_date) || has(record.rv33_date)) {
    // ใช้แบบ 3 เข็ม
    if (!has(record.rv31_date)) { missing.push('ขาด Rota เข็ม 1 (R21)'); rotaPass = false; }
    if (!has(record.rv32_date)) { missing.push('ขาด Rota เข็ม 2 (R22)'); rotaPass = false; }
    if (!has(record.rv33_date)) { missing.push('ขาด Rota เข็ม 3 (R23)'); rotaPass = false; }
  } else if (has(record.rv21_date) || has(record.rv22_date)) {
    // ใช้แบบ 2 เข็ม
    if (!has(record.rv21_date)) { missing.push('ขาด Rota เข็ม 1 (R11)'); rotaPass = false; }
    if (!has(record.rv22_date)) { missing.push('ขาด Rota เข็ม 2 (R12)'); rotaPass = false; }
  } else {
    // ไม่มีข้อมูลเลย
    missing.push('ขาด Rota (เข็มแรก)');
    rotaPass = false;
  }
  if (rotaPass) passed.push('Rota (ครบ)');

  let isFullyImmunized = missing.length === 0;

  // ยึดผลลัพธ์จาก HDC (Column: result) เป็นหลัก เพื่อให้ข้อมูลตรงกัน 100%
  if (record.result && typeof record.result === 'string') {
    if (record.result.includes('ผ่าน') && !record.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = true;
      missing.length = 0;
    } else if (record.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = false;
      if (missing.length === 0) {
        missing.push('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
      }
    }
  }

  return {
    isFullyImmunized,
    missingVaccines: missing,
    passedVaccines: passed
  };
}


