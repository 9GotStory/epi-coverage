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
  
  /**
   * HDC นับว่า "ได้รับวัคซีน" = มีวันที่บันทึกหลังวันเกิด (ไม่จำกัด deadline)
   */
  const has = (dateStr?: string | null): boolean => {
    if (!dateStr || !record.birth) return false;
    const vDate = new Date(dateStr);
    const bDate = new Date(record.birth as string);
    if (isNaN(vDate.getTime()) || isNaN(bDate.getTime())) return false;
    return vDate >= bDate;
  };

  const evaluateItem = (name: string, isPassed: boolean) => {
    results[name] = isPassed;
    if (!isPassed) missing.push(name);
  };

  evaluateItem('ขาด LAJE เข็ม 1 (J11) / JE เข็ม 2 (052)', has(record.j11_date) || (has(record.je1_date) && has(record.je2_date)));
  evaluateItem('ขาด DTP เข็ม 4 (034)', has(record.dtp4_date));
  evaluateItem('ขาด OPV เข็ม 4 (084)', has(record.opv4_date));
  evaluateItem('ขาด MMR เข็ม 1 (061)', has(record.mmr1_date));
  evaluateItem('ขาด MMR เข็ม 2 (073)', has(record.mmr2_date));

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
  if (!has(record.bcg_date)) missing.push('ขาด BCG (010)'); else passed.push('BCG 1 เข็ม');

  // 2. HBV 3 times (hbv1, hbv2, hbv4)
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('ขาด HBV เข็ม 1 (041)'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('ขาด HBV เข็ม 2 (042)'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('ขาด HBV เข็ม 4 (043)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV ครบ 3 เข็ม');

  // 3. DTP 4 times (dtp1, dtp2, dtp3, dtp4)
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('ขาด DTP เข็ม 1 (031)'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('ขาด DTP เข็ม 2 (032)'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('ขาด DTP เข็ม 3 (033)'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('ขาด DTP เข็ม 4 (034)'); dtpPass = false; }
  if (dtpPass) passed.push('DTP ครบ 4 เข็ม');

  // 4. Hib 3 times (hib1, hib2, hib3)
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('ขาด Hib เข็ม 1 (H11)'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('ขาด Hib เข็ม 2 (H12)'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('ขาด Hib เข็ม 3 (H13)'); hibPass = false; }
  if (hibPass) passed.push('Hib ครบ 3 เข็ม');

  // 5. IPV ครบ 2 เข็ม
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('ขาด IPV เข็ม 1 (I11)'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('ขาด IPV เข็ม 2 (I12)'); ipvPass = false; }
  if (ipvPass) passed.push('IPV ครบ 2 เข็ม');

  // 6. OPV 2 times (Usually opv1 and opv4)
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('ขาด OPV เข็ม 3 (083)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('ขาด OPV เข็ม 4 (084)'); opvPass = false; }
  if (opvPass) passed.push('OPV ครบ 4 เข็ม');

  // 7. MMR 2 times (mmr1, mmr2)
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('ขาด MMR เข็ม 1 (061)'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('ขาด MMR เข็ม 2 (073)'); mmrPass = false; }
  if (mmrPass) passed.push('MMR ครบ 2 เข็ม');

  // 8. Rota Complete
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
  if (rotaPass) passed.push('Rota ครบถ้วน');

  // 9. LAJE 1 time OR JE 2 times
  const hasLAJE = has(record.j11_date);
  const hasJEComplete = has(record.je1_date) && has(record.je2_date);
  
  if (!hasLAJE && !hasJEComplete) {
    missing.push('ขาด LAJE เข็ม 1 หรือ JE เข็ม 2');
  } else {
    passed.push(hasLAJE ? 'LAJE 1 เข็ม' : 'JE ครบ 2 เข็ม');
  }

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
