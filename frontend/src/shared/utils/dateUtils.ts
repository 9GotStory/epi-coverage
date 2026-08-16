import { isValid, intervalToDuration } from 'date-fns';

export function getCurrentFiscalYear(): number {
  const date = new Date();
  // Thai fiscal year starts in October (month 9 in 0-indexed Date)
  return date.getFullYear() + 543 + (date.getMonth() >= 9 ? 1 : 0);
}

export function formatAgeStr(birthDate: Date | string | null | undefined, referenceDate?: Date | string | null): string {
  if (!birthDate) return '-';
  const start = new Date(birthDate);
  const end = referenceDate ? new Date(referenceDate) : new Date();
  
  if (!isValid(start) || !isValid(end)) return '-';
  if (start > end) return '0 เดือน';
  
  const duration = intervalToDuration({ start, end });
  const years = duration.years || 0;
  const months = duration.months || 0;
  
  if (years === 0) {
    return `${months} เดือน`;
  }
  
  return `${years} ปี ${months > 0 ? `${months} ด.` : ''}`.trim();
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
