import { differenceInMonths, isValid } from 'date-fns';

export function getCurrentFiscalYear(): number {
  const date = new Date();
  // Thai fiscal year starts in October (month 9 in 0-indexed Date)
  return date.getFullYear() + 543 + (date.getMonth() >= 9 ? 1 : 0);
}

export function getAgeInMonths(birthDate: Date | string | null | undefined): number {
  if (!birthDate) return 0;
  const date = new Date(birthDate);
  if (!isValid(date)) return 0;
  return Math.max(0, differenceInMonths(new Date(), date));
}

export function formatDateStr(dateStr: Date | string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (!isValid(date)) return '-';
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatDateTimeStr(dateStr: Date | string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (!isValid(date)) return '-';
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' น.';
}

/**
 * คำนวณช่วงวันเกิด (Cohort) ของเด็ก จากปีงบประมาณและไตรมาสที่เลือก
 * @param fiscalYear ปีงบประมาณ (พ.ศ.) เช่น 2567
 * @param quarter ไตรมาสที่รายงาน (1, 2, 3, 4)
 * @param targetAge อายุเด็ก (ค่าเริ่มต้นคือ 1 ปี)
 * @returns { start: Date, end: Date }
 */
export function getBirthDateRangeForQuarter(fiscalYear: number, quarter: number | 'all', targetAge: number = 1): { start: Date; end: Date } {
  // ปีงบประมาณ 2567 = ตุลาคม 2566 ถึง กันยายน 2567
  // เด็ก 1 ปี คือเด็กที่เกิดเมื่อ 1 ปีที่แล้ว, เด็ก 2 ปี เกิดเมื่อ 2 ปีที่แล้ว
  
  const calYearForQuarter1 = fiscalYear - 1 - 543; // ปีปฏิทินของไตรมาส 1 (ต.ค. - ธ.ค. ปีก่อนหน้า)
  const calYearForOtherQuarters = fiscalYear - 543; // ปีปฏิทินของไตรมาส 2,3,4 (ม.ค. - ก.ย. ปีปัจจุบัน)

  let startStr = '';
  let endStr = '';

  if (quarter === 'all') {
    // ตลอดทั้งปีงบประมาณ
    startStr = `${calYearForQuarter1 - targetAge}-10-01`;
    endStr = `${calYearForOtherQuarters - targetAge}-09-30`;
  } else if (quarter === 1) {
    // ตุลาคม - ธันวาคม
    startStr = `${calYearForQuarter1 - targetAge}-10-01`;
    endStr = `${calYearForQuarter1 - targetAge}-12-31`;
  } else if (quarter === 2) {
    // มกราคม - มีนาคม
    startStr = `${calYearForOtherQuarters - targetAge}-01-01`;
    endStr = `${calYearForOtherQuarters - targetAge}-03-31`;
  } else if (quarter === 3) {
    // เมษายน - มิถุนายน
    startStr = `${calYearForOtherQuarters - targetAge}-04-01`;
    endStr = `${calYearForOtherQuarters - targetAge}-06-30`;
  } else if (quarter === 4) {
    // กรกฎาคม - กันยายน
    startStr = `${calYearForOtherQuarters - targetAge}-07-01`;
    endStr = `${calYearForOtherQuarters - targetAge}-09-30`;
  }

  return {
    start: new Date(startStr),
    end: new Date(`${endStr}T23:59:59.999Z`)
  };
}

/**
 * คำนวณวันสิ้นสุดไตรมาสที่ประเมินผล (อ้างอิงตาม HDC)
 * เด็กเกิดไตรมาสไหน จะประเมินผลเมื่อสิ้นสุดไตรมาสนั้นในปีถัดไป
 */
export function getEvaluationDeadline(birthDate: string | Date, targetAge: number = 1): Date {
  let year: number;
  let month: number;

  if (typeof birthDate === 'string' && birthDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const parts = birthDate.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    const bDate = new Date(birthDate);
    year = bDate.getFullYear();
    month = bDate.getMonth() + 1; // 1-12
  }
  
  // เด็ก 1 ขวบ จะถูกประเมินใน 1 ปีถัดไป, เด็ก 2 ขวบ ประเมินใน 2 ปีถัดไป
  const endYear = year + targetAge;
  let endMonth = 12;
  let endDay = 31;
  
  if (month >= 10 && month <= 12) { // ไตรมาส 1 (ต.ค. - ธ.ค.)
    endMonth = 12; endDay = 31;
  } else if (month >= 1 && month <= 3) { // ไตรมาส 2 (ม.ค. - มี.ค.)
    endMonth = 3; endDay = 31;
  } else if (month >= 4 && month <= 6) { // ไตรมาส 3 (เม.ย. - มิ.ย.)
    endMonth = 6; endDay = 30;
  } else if (month >= 7 && month <= 9) { // ไตรมาส 4 (ก.ค. - ก.ย.)
    endMonth = 9; endDay = 30;
  }
  
  // กำหนดเวลาเป็น 23:59:59 ของวันสุดท้ายของไตรมาส
  return new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
}

/**
 * ตรวจสอบว่าวันที่ฉีดวัคซีน อยู่ภายในกำหนดเวลาประเมินผลของ HDC หรือไม่
 * @param birthDate วันเกิดเด็ก
 * @param vaccineDate วันที่ได้รับวัคซีน
 * @param targetAge อายุของเด็ก (ค่าเริ่มต้นคือ 1 ปี)
 * @returns boolean
 */
export function isValidVaccineDate(birthDate: string | Date | undefined, vaccineDate: string | undefined, targetAge: number = 1): boolean {
  if (!birthDate || !vaccineDate) return false;
  
  const bDate = new Date(birthDate);
  const vDate = new Date(vaccineDate);
  
  if (isNaN(bDate.getTime()) || isNaN(vDate.getTime())) return false;
  
  // HDC กำหนดเส้นตายคือ "วันสิ้นสุดของไตรมาสประเมินผล"
  const deadline = getEvaluationDeadline(bDate, targetAge);
  
  // วันที่ฉีดต้องน้อยกว่าหรือเท่ากับวันเดดไลน์ และต้องไม่ก่อนวันเกิด
  return vDate <= deadline && vDate >= bDate;
}
