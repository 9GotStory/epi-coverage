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
// เกณฑ์: DTP เข็ม 5 (4 ปี) และ OPV เข็ม 5 (4 ปี)
// ==========================================
export const evaluateView1_5Yr = (r: EpiRecord): View1Status => {
  const missingVaccines: string[] = [];
  let isPassedAll = true;

  /**
   * HDC นับว่า "ได้รับวัคซีน" = มีวันที่บันทึกหลังวันเกิด (ไม่จำกัด deadline)
   */
  const has = (dateStr?: string | null): boolean => {
    if (!dateStr || !r.birth) return false;
    const vDate = new Date(dateStr);
    const bDate = new Date(r.birth as string);
    if (isNaN(vDate.getTime()) || isNaN(bDate.getTime())) return false;
    return vDate >= bDate;
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
  const passedVaccines: string[] = [];

  const has = (dateStr?: string | null) => {
    return isValidVaccineDate(r.birth as string, dateStr as string, 5);
  };

  // 1. BCG 1 ครั้ง
  if (!has(r.bcg_date)) missingVaccines.push('ขาด BCG (010)'); else passedVaccines.push('BCG 1 เข็ม');
  
  // 2. HBV 3 ครั้ง (แรกเกิด, 2 เดือน, 6 เดือน)
  let hbvPass = true;
  if (!has(r.hbv1_date)) { missingVaccines.push('HBV เข็ม 1'); hbvPass = false; }
  if (!has(r.hbv2_date)) { missingVaccines.push('HBV เข็ม 2'); hbvPass = false; }
  if (!has(r.hbv4_date)) { missingVaccines.push('HBV เข็ม 3 (6 ด.)'); hbvPass = false; }
  if (hbvPass) passedVaccines.push('HBV เข็ม 1, 2, 3');
  
  // 3. DTP 5 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  let dtpPass = true;
  if (!has(r.dtp1_date)) { missingVaccines.push('DTP เข็ม 1'); dtpPass = false; }
  if (!has(r.dtp2_date)) { missingVaccines.push('DTP เข็ม 2'); dtpPass = false; }
  if (!has(r.dtp3_date)) { missingVaccines.push('DTP เข็ม 3'); dtpPass = false; }
  if (!has(r.dtp4_date)) { missingVaccines.push('DTP เข็ม 4'); dtpPass = false; }
  if (!has(r.dtp5_date)) { missingVaccines.push('DTP เข็ม 5 (4 ปี)'); dtpPass = false; }
  if (dtpPass) passedVaccines.push('DTP เข็ม 1, 2, 3, 4, 5');
  
  // 4. Hib 3 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน)
  let hibPass = true;
  if (!has(r.hib1_date)) { missingVaccines.push('Hib เข็ม 1'); hibPass = false; }
  if (!has(r.hib2_date)) { missingVaccines.push('Hib เข็ม 2'); hibPass = false; }
  if (!has(r.hib3_date)) { missingVaccines.push('Hib เข็ม 3'); hibPass = false; }
  if (hibPass) passedVaccines.push('Hib เข็ม 1, 2, 3');
  
  // 5. IPV 1 ครั้ง (4 เดือน) 
  // *จากการวิเคราะห์ไฟล์ HDC เด็ก 5 ปี วัคซีน IPV 4 เดือนจะถูกบันทึกใน ipv2_date (I12)
  if (!has(r.ipv2_date)) missingVaccines.push('IPV เข็ม 4 เดือน'); else passedVaccines.push('IPV เข็ม 4 เดือน');
  
  // 6. OPV 3 ครั้ง (6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  let opvPass = true;
  if (!has(r.opv1_date)) { missingVaccines.push('OPV เข็ม 1 (6 ด.)'); opvPass = false; }
  if (!has(r.opv4_date)) { missingVaccines.push('OPV เข็ม 2 (1.5 ปี)'); opvPass = false; }
  if (!has(r.opv5_date)) { missingVaccines.push('OPV เข็ม 3 (4 ปี)'); opvPass = false; }
  if (opvPass) passedVaccines.push('OPV เข็ม 1, 2, 3');
  
  // 7. MMR 2 ครั้ง (9 เดือน, 1 ปี 6 เดือน)
  let mmrPass = true;
  if (!has(r.mmr1_date)) { missingVaccines.push('MMR เข็ม 1'); mmrPass = false; }
  if (!has(r.mmr2_date)) { missingVaccines.push('MMR เข็ม 2'); mmrPass = false; }
  if (mmrPass) passedVaccines.push('MMR เข็ม 1, 2');
  
  // 8. Rota (ยกเว้นในเด็ก 5 ปี เนื่องจากเกิดก่อนนโยบายวัคซีนใหม่)
  // ไม่นำมาคำนวณ Fully Immunized
  
  // 9. LAJE 2 ครั้ง หรือ JE 3 ครั้ง
  const hasJE1 = has(r.j11_date) || has(r.je1_date);
  if (!hasJE1) {
    missingVaccines.push('LAJE เข็ม 1 หรือ JE เข็ม 1');
  }

  const hasLAJEComplete = has(r.j11_date) && has(r.j12_date);
  const hasJEComplete = has(r.je1_date) && has(r.je2_date) && has(r.je3_date);
  
  if (hasLAJEComplete || hasJEComplete) {
    passedVaccines.push(hasLAJEComplete ? 'LAJE ครบ 2 เข็ม' : 'JE ครบ 3 เข็ม');
  } else {
    missingVaccines.push('LAJE เข็ม 2 หรือ JE เข็ม 2-3 (ครบ)');
  }

  let isFullyImmunized = missingVaccines.length === 0;

  // 10. ยึดผลลัพธ์จาก HDC (Column: result) เป็นหลัก เพื่อให้ข้อมูลตรงกัน 100%
  if (r.result && typeof r.result === 'string') {
    if (r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = true;
      missingVaccines.length = 0; // ล้างข้อมูลตกหล่นเพราะ HDC ให้ผ่าน
    } else if (r.result.includes('ไม่ผ่าน')) {
      isFullyImmunized = false;
      // หาก HDC ให้ไม่ผ่าน แต่ manual logic ให้ผ่าน เราควรยึด HDC และใส่อย่างน้อย 1 สาเหตุ
      if (missingVaccines.length === 0) {
        missingVaccines.push('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
      }
    }
  }

  return {
    isFullyImmunized,
    missingVaccines,
    passedVaccines
  };
};
