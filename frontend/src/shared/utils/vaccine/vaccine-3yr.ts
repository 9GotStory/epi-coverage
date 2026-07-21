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

  // 1. BCG
  if (!has(record.bcg_date)) missing.push('ขาด BCG (010)'); else passed.push('BCG 1 เข็ม');

  // 2. HBV 3 times
  let hbvPass = true;
  if (!has(record.hbv1_date)) { missing.push('HBV เข็ม 1'); hbvPass = false; }
  if (!has(record.hbv2_date)) { missing.push('HBV เข็ม 2'); hbvPass = false; }
  if (!has(record.hbv4_date)) { missing.push('HBV เข็ม 3 (6 ด.)'); hbvPass = false; }
  if (hbvPass) passed.push('HBV เข็ม 1, 2, 3');

  // 3. DTP 4 times
  let dtpPass = true;
  if (!has(record.dtp1_date)) { missing.push('DTP เข็ม 1'); dtpPass = false; }
  if (!has(record.dtp2_date)) { missing.push('DTP เข็ม 2'); dtpPass = false; }
  if (!has(record.dtp3_date)) { missing.push('DTP เข็ม 3'); dtpPass = false; }
  if (!has(record.dtp4_date)) { missing.push('DTP เข็ม 4'); dtpPass = false; }
  if (dtpPass) passed.push('DTP เข็ม 1, 2, 3, 4');

  // 4. Hib 3 times
  let hibPass = true;
  if (!has(record.hib1_date)) { missing.push('Hib เข็ม 1'); hibPass = false; }
  if (!has(record.hib2_date)) { missing.push('Hib เข็ม 2'); hibPass = false; }
  if (!has(record.hib3_date)) { missing.push('Hib เข็ม 3'); hibPass = false; }
  if (hibPass) passed.push('Hib เข็ม 1, 2, 3');

  // 5. IPV ครบ 2 เข็ม
  let ipvPass = true;
  if (!has(record.ipv1_date)) { missing.push('IPV เข็ม 1'); ipvPass = false; }
  if (!has(record.ipv2_date)) { missing.push('IPV เข็ม 2'); ipvPass = false; }
  if (ipvPass) passed.push('IPV เข็ม 1, 2');

  // 6. OPV 2 times
  let opvPass = true;
  if (!has(record.opv1_date)) { missing.push('OPV เข็ม 1 (6 ด.)'); opvPass = false; }
  if (!has(record.opv4_date)) { missing.push('OPV เข็ม 2 (1.5 ปี)'); opvPass = false; }
  if (opvPass) passed.push('OPV เข็ม 1, 2');

  // 7. MMR 2 times
  let mmrPass = true;
  if (!has(record.mmr1_date)) { missing.push('MMR เข็ม 1'); mmrPass = false; }
  if (!has(record.mmr2_date)) { missing.push('MMR เข็ม 2'); mmrPass = false; }
  if (mmrPass) passed.push('MMR เข็ม 1, 2');

  // 8. Rota Complete (2 or 3 doses)
  const hasRota1 = has(record.rv21_date) || has(record.rv31_date);
  if (!hasRota1) {
    missing.push('Rota เข็ม 1');
  }

  const hasRota2Series = has(record.rv21_date) && has(record.rv22_date);
  const hasRota3Series = has(record.rv31_date) && has(record.rv32_date) && has(record.rv33_date);

  if (hasRota2Series || hasRota3Series) {
    passed.push('Rota ครบถ้วน');
  } else {
    missing.push('Rota เข็มสุดท้าย (ครบ)');
  }

  // 9. LAJE 2 times OR JE 3 times
  const hasJE1 = has(record.j11_date) || has(record.je1_date);
  if (!hasJE1) {
    missing.push('LAJE เข็ม 1 หรือ JE เข็ม 1');
  }

  const hasLAJEComplete = has(record.j11_date) && has(record.j12_date);
  const hasJEComplete = has(record.je1_date) && has(record.je2_date) && has(record.je3_date);
  
  if (hasLAJEComplete || hasJEComplete) {
    passed.push(hasLAJEComplete ? 'LAJE ครบ 2 เข็ม' : 'JE ครบ 3 เข็ม');
  } else {
    missing.push('LAJE เข็ม 2 หรือ JE เข็ม 2-3 (ครบ)');
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
