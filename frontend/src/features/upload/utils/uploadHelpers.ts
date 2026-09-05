import { z } from 'zod';
// Date parser helper

/**
 * บางแหล่งข้อมูลส่งวันที่เป็น พ.ศ. (เช่น "2567-10-08") — ระบบเก็บ ค.ศ. ทั้งหมด
 * ปี >= 2400 ถือว่าเป็น พ.ศ. ให้แปลงเป็น ค.ศ. (ลบ 543)
 * ก่อนแก้จุดนี้: วันเกิด พ.ศ. จะทำให้การเทียบ string กับวัคซีน ค.ศ. พัง (ฟ้อง "ก่อนวันเกิด")
 * และเด็กหายจากการกรองโคฮอร์ตรายไตรมาสโดยเงียบ
 */
const toGregorianYear = (year: number): number => (year >= 2400 ? year - 543 : year);

export const parseDate = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const year = toGregorianYear(parseInt(val.slice(0, 4), 10));
    return `${year}${val.slice(4)}`;
  }

  // If it's a serial number from Excel
  if (typeof val === 'number') {
    // Excel dates are days since Dec 30, 1899
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    // When using UTC offsets, we should just extract UTC date because the math above produces UTC time
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear(); // serial เป็น ค.ศ. อยู่แล้ว
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // Attempt to parse JS Date (from SheetJS cellDates)
  try {
    if (val instanceof Date || typeof val === 'string') {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        const year = toGregorianYear(d.getFullYear());
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }
  } catch {
    // Ignore parse error
  }

  // แปลงไม่ได้ = ไม่มีข้อมูล (null) — ไม่เก็บ string ขยะไว้ให้การเปรียบเทียบวันที่พัง
  return null;
};

export const cleanData = (data: any[]): any[] => {
  return data.map(row => {
    const cleanRow: any = {};
    Object.keys(row).forEach(key => {
      let val = row[key];
      if (val === '<NA>' || val === 'NA' || val === '' || val === undefined) {
        val = null;
      }
      
      // Force string and pad for specific columns
      let normalizedKey = key.toLowerCase();
      // Normalize hosp or hospcode to hoscode so Zod validation and Backend can rely on it
      if (normalizedKey === 'hosp' || normalizedKey === 'hospcode') {
        normalizedKey = 'hoscode';
      }

      if (val !== null && ['hoscode', 'pid', 'cid', 'check_vhid'].includes(normalizedKey)) {
        val = String(val).trim();
        
        // Preserve leading zeros in case Excel parsed them as pure numbers
        if (normalizedKey === 'hoscode') {
          val = val.padStart(5, '0');
        } else if (normalizedKey === 'cid') {
          val = val.padStart(13, '0');
        }
      }
      
      // Parse dates
      if (val !== null && (normalizedKey.includes('date') || normalizedKey === 'birth')) {
        val = parseDate(val);
      }
      
      cleanRow[normalizedKey] = val;
    });
    return cleanRow;
  });
};

export const getAgeGroupFromTable = (table: string): string => {
  switch (table) {
    case 'Epi_1_Year': return '1yr';
    case 'Epi_2_Year': return '2yr';
    case 'Epi_3_Year': return '3yr';
    case 'Epi_5_Year': return '5yr';
    default: return '1yr';
  }
};

export const getAgeFromTable = (table: string): number => {
  switch (table) {
    case 'Epi_1_Year': return 1;
    case 'Epi_2_Year': return 2;
    case 'Epi_3_Year': return 3;
    case 'Epi_5_Year': return 5;
    default: return 1;
  }
};

export const getAgeString = (birthDateString: string): string => {
  if (!birthDateString) return '';
  const birth = new Date(birthDateString);
  if (isNaN(birth.getTime())) return '';
  const now = new Date();
  
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) {
    months--;
  }
  
  if (months < 0) return '0 เดือน';
  
  const y = Math.floor(months / 12);
  const m = months % 12;
  
  if (y > 0 && m > 0) return `${y} ปี ${m} เดือน`;
  if (y > 0) return `${y} ปี`;
  return `${m} เดือน`;
};


export const uploadRowSchema = z.object({
  hoscode: z.string().min(5, "ต้องมีรหัสสถานบริการ 5 หลัก"),
  cid: z.string().min(13, "ต้องมีเลขบัตรประชาชน 13 หลัก"),
  birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องมีวันเกิดในรูปแบบ YYYY-MM-DD"),
  name: z.string().min(1, "ต้องมีชื่อ"),
  lname: z.string().min(1, "ต้องมีนามสกุล")
}).passthrough(); // Allow other columns
