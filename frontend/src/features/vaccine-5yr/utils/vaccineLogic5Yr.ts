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
  if (!has(r.hbv1_date)) { missingVaccines.push('ขาด HBV เข็ม 1 (041)'); hbvPass = false; }
  if (!has(r.hbv2_date)) { missingVaccines.push('ขาด HBV เข็ม 2 (042)'); hbvPass = false; }
  if (!has(r.hbv4_date)) { missingVaccines.push('ขาด HBV เข็ม 4 (043)'); hbvPass = false; }
  if (hbvPass) passedVaccines.push('HBV ครบ 3 เข็ม');
  
  // 3. DTP 5 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  let dtpPass = true;
  if (!has(r.dtp1_date)) { missingVaccines.push('ขาด DTP เข็ม 1 (031)'); dtpPass = false; }
  if (!has(r.dtp2_date)) { missingVaccines.push('ขาด DTP เข็ม 2 (032)'); dtpPass = false; }
  if (!has(r.dtp3_date)) { missingVaccines.push('ขาด DTP เข็ม 3 (033)'); dtpPass = false; }
  if (!has(r.dtp4_date)) { missingVaccines.push('ขาด DTP เข็ม 4 (034)'); dtpPass = false; }
  if (!has(r.dtp5_date)) { missingVaccines.push('ขาด DTP เข็ม 5 (035)'); dtpPass = false; }
  if (dtpPass) passedVaccines.push('DTP ครบ 5 เข็ม');
  
  // 4. Hib 3 ครั้ง (2 เดือน, 4 เดือน, 6 เดือน)
  let hibPass = true;
  if (!has(r.hib1_date)) { missingVaccines.push('ขาด Hib เข็ม 1 (H11)'); hibPass = false; }
  if (!has(r.hib2_date)) { missingVaccines.push('ขาด Hib เข็ม 2 (H12)'); hibPass = false; }
  if (!has(r.hib3_date)) { missingVaccines.push('ขาด Hib เข็ม 3 (H13)'); hibPass = false; }
  if (hibPass) passedVaccines.push('Hib ครบ 3 เข็ม');
  
  // 5. IPV 1 ครั้ง (4 เดือน) 
  // *จากการวิเคราะห์ไฟล์ HDC เด็ก 5 ปี วัคซีน IPV 4 เดือนจะถูกบันทึกใน ipv2_date (092)
  if (!has(r.ipv2_date)) missingVaccines.push('ขาด IPV เข็ม 4 เดือน (092)'); else passedVaccines.push('IPV 1 เข็ม');
  
  // 6. OPV 3 ครั้ง (6 เดือน, 1 ปี 6 เดือน, 4 ปี)
  let opvPass = true;
  if (!has(r.opv1_date)) { missingVaccines.push('ขาด OPV เข็ม 3 (083)'); opvPass = false; }
  if (!has(r.opv4_date)) { missingVaccines.push('ขาด OPV เข็ม 4 (084)'); opvPass = false; }
  if (!has(r.opv5_date)) { missingVaccines.push('ขาด OPV เข็ม 5 (085)'); opvPass = false; }
  if (opvPass) passedVaccines.push('OPV ครบ 3 เข็ม');
  
  // 7. MMR 2 ครั้ง (9 เดือน, 1 ปี 6 เดือน)
  let mmrPass = true;
  if (!has(r.mmr1_date)) { missingVaccines.push('ขาด MMR เข็ม 1 (061)'); mmrPass = false; }
  if (!has(r.mmr2_date)) { missingVaccines.push('ขาด MMR เข็ม 2 (073)'); mmrPass = false; }
  if (mmrPass) passedVaccines.push('MMR ครบ 2 เข็ม');
  
  // 8. Rota (ยกเว้นในเด็ก 5 ปี เนื่องจากเกิดก่อนนโยบายวัคซีนใหม่)
  // ไม่นำมาคำนวณ Fully Immunized
  
  // 9. LAJE 2 ครั้ง หรือ JE 3 ครั้ง
  let jePass = true;
  if (has(r.je1_date) || has(r.je2_date) || has(r.je3_date)) {
    // เชื้อตาย 3 เข็ม
    if (!has(r.je1_date)) { missingVaccines.push('ขาด JE เข็ม 1 (051)'); jePass = false; }
    if (!has(r.je2_date)) { missingVaccines.push('ขาด JE เข็ม 2 (052)'); jePass = false; }
    if (!has(r.je3_date)) { missingVaccines.push('ขาด JE เข็ม 3 (053)'); jePass = false; }
  } else if (has(r.j11_date) || has(r.j12_date)) {
    // เชื้อเป็น 2 เข็ม
    if (!has(r.j11_date)) { missingVaccines.push('ขาด LAJE เข็ม 1 (J11)'); jePass = false; }
    if (!has(r.j12_date)) { missingVaccines.push('ขาด LAJE เข็ม 2 (J12)'); jePass = false; }
  } else {
    // ไม่มีข้อมูลเลย
    missingVaccines.push('ขาด LAJE/JE (เข็มแรก)');
    jePass = false;
  }
  if (jePass) passedVaccines.push('LAJE ครบ 2 เข็ม หรือ JE ครบ 3 เข็ม');

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
