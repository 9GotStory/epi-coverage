/**
 * HDC Fully Immunized reports: one aggregate table, four independent report
 * identities. This data is read-only and NEVER changes EPI Rules Engine scores.
 */
import { HDC_SONG_DISTRICT_PREFIX } from './hdcAnnualReference';

export const HDC_COMPLETE_REPORTS = {
  '1yr': '28dd2c7955ce926456240b2ff0100bde',
  '2yr': '35f4a8d465e6e1edc05f3d8ab658c551',
  '3yr': 'd1fe173d08e959397adf34b1d77e88d7',
  '5yr': 'f033ab37c30201f73f142449d037028d',
} as const;

export type HdcCompleteAge = keyof typeof HDC_COMPLETE_REPORTS;

export interface HdcCompleteAnnualReference {
  fiscalYear: number;
  ageGroup: HdcCompleteAge;
  reportId: string;
  table: 's_epi_complete';
  target: number;
  result: number;
  processingDate: string;
  rowCount: number;
}

const MONTHS = ['10','11','12','01','02','03','04','05','06','07','08','09'] as const;

export function getHdcCompleteReport(ageGroup: string): string | null {
  return Object.prototype.hasOwnProperty.call(HDC_COMPLETE_REPORTS, ageGroup)
    ? HDC_COMPLETE_REPORTS[ageGroup as HdcCompleteAge] : null;
}

function readCount(row: Record<string,unknown>, field: string): number {
  const raw = row[field];
  if (typeof raw !== 'number' &&
      !(typeof raw === 'string' && /^\d+$/.test(raw))) {
    throw new Error('จำนวนเป้าหมาย/ผลงาน HDC ไม่ครบหรือไม่ถูกต้อง');
  }
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('จำนวนเป้าหมาย/ผลงาน HDC ไม่ใช่จำนวนเต็มที่รองรับ');
  }
  return number;
}

function addCount(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error('จำนวนรวม HDC เกินขอบเขตที่รองรับ');
  return sum;
}

export function summarizeHdcCompleteAnnual(
  rows: unknown[], fiscalYear: number, ageGroup: string,
): HdcCompleteAnnualReference | null {
  const reportId = getHdcCompleteReport(ageGroup);
  if (!reportId || !Array.isArray(rows) || !Number.isInteger(fiscalYear) ||
      fiscalYear < 2500) return null;

  let target = 0;
  let result = 0;
  let processingDate = '';
  let rowCount = 0;
  const seen = new Set<string>();
  for (const input of rows) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) continue;
    const row = input as Record<string,unknown>;
    if (row.id !== reportId || String(row.b_year) !== String(fiscalYear) ||
        !String(row.areacode ?? '').startsWith(HDC_SONG_DISTRICT_PREFIX)) continue;

    if (typeof row.hospcode !== 'string' || !/^\d{5}$/.test(row.hospcode) ||
        typeof row.areacode !== 'string' || !/^\d{8}$/.test(row.areacode) ||
        typeof row.date_com !== 'string' || !/^\d{12}$/.test(row.date_com)) {
      throw new Error('ข้อมูลระบุพื้นที่/หน่วยบริการ/รอบประมวลผล HDC ไม่ถูกต้อง');
    }
    const location = row.hospcode + '|' + row.areacode;
    if (seen.has(location)) throw new Error('ระเบียนหน่วยบริการและพื้นที่ HDC ซ้ำ');
    seen.add(location);
    if (processingDate && processingDate !== row.date_com) {
      throw new Error('รายงาน HDC ประกอบด้วยข้อมูลคนละรอบประมวลผล');
    }
    processingDate = row.date_com;

    const annualTarget = readCount(row,'target');
    const annualResult = readCount(row,'result');
    if (annualResult > annualTarget) {
      throw new Error('จำนวนผลงาน HDC มากกว่าประชากรเป้าหมาย');
    }
    let monthlyTarget = 0;
    let monthlyResult = 0;
    for (const month of MONTHS) {
      const countTarget = readCount(row, 'target' + month);
      const countResult = readCount(row, 'result' + month);
      if (countResult > countTarget) throw new Error('ผลงาน HDC มากกว่าตัวหารรายเดือน');
      monthlyTarget = addCount(monthlyTarget,countTarget);
      monthlyResult = addCount(monthlyResult,countResult);
    }
    if (annualTarget !== monthlyTarget || annualResult !== monthlyResult) {
      throw new Error('ข้อมูลรวมทั้งปี HDC ไม่ตรงกับยอดรายเดือน');
    }
    target = addCount(target,annualTarget);
    result = addCount(result,annualResult);
    rowCount++;
  }
  if (rowCount === 0) return null;
  if (target === 0) throw new Error('รายงาน HDC ไม่มีประชากรเป้าหมายสำหรับคำนวณร้อยละ');
  return { fiscalYear,ageGroup:ageGroup as HdcCompleteAge,reportId,
    table:'s_epi_complete',target,result,processingDate,rowCount };
}
