import type { EpiAge } from '../../../shared/types/hdc';
import { hdcSourceFields } from '../../../shared/utils/vaccine/hdcSchema';
import { dateKey } from '../../../shared/utils/vaccine/dateWarnings';
import { read, utils } from 'xlsx';
import { cleanData, uploadRowSchema } from './uploadHelpers';

export async function parseHdcFile(file: File, age?: EpiAge) {
  let rows: Record<string, unknown>[];
  if (/\.json$/i.test(file.name)) {
    const value: unknown = JSON.parse(await file.text());
    if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('JSON ต้องเป็นรายการข้อมูลบุคคล');
    }
    rows = value;
  } else {
    const workbook = read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
    const headers = (matrix[0] || []).map(value => String(value ?? '').trim().toLowerCase());
    const canonical = headers.map(field => ['hosp', 'hospcode'].includes(field) ? 'hoscode' : field === 'heck_typearea' ? 'check_typearea' : field);
    if (canonical.some(field => !field) || new Set(canonical).size !== canonical.length) throw new Error('หัวคอลัมน์ว่างหรือซ้ำกัน');
    rows = matrix.slice(1).map(values => Object.fromEntries(headers.map((field, index) => [field, values[index] ?? null])));
  }
  if (!rows.length) throw new Error('ไฟล์ว่างเปล่า');
  for (const row of rows) {
    const keys = Object.keys(row).map(field => field.trim().toLowerCase()).map(field => ['hosp', 'hospcode'].includes(field) ? 'hoscode' : field === 'heck_typearea' ? 'check_typearea' : field);
    if (new Set(keys).size !== keys.length) throw new Error('ชื่อคอลัมน์ซ้ำหลังปรับชื่อมาตรฐาน');
  }
  const cleaned = cleanData(rows) as Record<string, unknown>[];
  const seen = new Set<string>();
  for (const [index, row] of cleaned.entries()) {
    const validated = uploadRowSchema.safeParse(row);
    if (!validated.success) throw new Error(`แถว ${index + 2}: ${validated.error.issues[0].message}`);
    if (String(row.cid).includes('*') && !row.pid) throw new Error(`แถว ${index + 2}: CID ถูกปิดบัง ต้องมี PID เพื่อแยกบุคคล`);
    if (row.pid != null && row.pid !== '' && !/^\d+$/.test(String(row.pid))) throw new Error(`แถว ${index + 2}: PID ไม่ถูกต้อง`);
    const key = `${row.hoscode}:${row.pid ? 'pid:' + row.pid : 'cid:' + row.cid}`;
    if (seen.has(key)) throw new Error(`แถว ${index + 2}: รหัสบุคคลซ้ำในหน่วยบริการเดียวกัน`);
    seen.add(key);
    for (const [field, value] of Object.entries(row)) {
      if ((field === 'birth' || field.endsWith('_date')) && value !== null && !dateKey(value)) throw new Error(`แถว ${index + 2}: วันที่ไม่ถูกต้องใน ${field}`);
      if ((field.endsWith('_hospcode') || field.endsWith('_input_hosp')) && value !== null && !/^[A-Za-z0-9]{5}$/.test(String(value))) {
        throw new Error(`แถว ${index + 2}: ${field} ต้องเป็นรหัสตัวอักษร/ตัวเลข 5 ตำแหน่ง`);
      }
    }
  }
  const columns = [...new Set(cleaned.flatMap(Object.keys))];
  if (age) {
    const allowed = hdcSourceFields(age);
    const unknown = columns.filter(field => !allowed.includes(field));
    if (unknown.length) throw new Error(`คอลัมน์ไม่รองรับสำหรับกลุ่มอายุ ${age} ปี: ${unknown.join(', ')}`);
    const namedAge = file.name.match(/EPI[-_ ]?([1235])YEAR/i)?.[1];
    if (namedAge && Number(namedAge) !== age) throw new Error('กลุ่มอายุที่เลือกไม่ตรงกับชื่อไฟล์');
  }
  if (!columns.some(field => field.endsWith('_date'))) throw new Error('ไม่พบคอลัมน์วันที่วัคซีน');
  return { rows: cleaned, columns };
}
