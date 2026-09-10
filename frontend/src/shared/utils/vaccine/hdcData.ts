import { hasSourceColumn } from './sourceColumns';
import type { EpiRecord } from '../../types';
import type { VaccineRule } from './ruleEngine';
import { format } from 'date-fns';

/**
 * วันปฏิทิน yyyy-MM-dd — จัดการ 3 รูปแบบให้ถูกต้อง:
 * 1. วันที่ล้วน "2024-10-31" → ใช้ตรง ๆ ตาม literal
 * 2. Timestamp ที่มี timezone (เช่น "2024-10-30T17:00:00.000Z" ที่ GAS สร้างจากเที่ยงคืนไทย)
 *    → แปลงเป็นวันตามเขตเวลาท้องถิ่นของผู้ใช้ ไม่ตัดข้อความหน้า T ตรง ๆ (วันจะเลื่อนหลัง 1 วัน)
 * คืนค่า: null = ไม่มีค่า/ขีด, '' = รูปแบบไม่ถูกต้อง, ไม่งั้นคืน "yyyy-MM-dd"
 */
export function calendarDay(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : format(value, 'yyyy-MM-dd');
  const text = String(value ?? '').trim();
  if (!text || text === '-' || text === '—') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(text);
  if (!match) return '';
  if (match[2]) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'yyyy-MM-dd');
  }
  const day = match[1];
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? '' : day;
}

// Column labels only: no dose requirements or clinical evaluation.
export function vaccineFieldLabel(field: string): string {
  if (field === 'bcg_date') return 'BCG';
  if (field === 'j11_date') return 'LAJE เข็ม 1';
  if (field === 'j12_date') return 'LAJE เข็ม 2';
  const rota = field.match(/^rv([23])([123])_date$/);
  if (rota) return `Rota ชนิด ${rota[1]} เข็ม — เข็ม ${rota[2]}`;
  const dose = field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je)(\d+)_date$/);
  if (dose) return `${dose[1] === 'hib' ? 'Hib' : dose[1].toUpperCase()} เข็ม ${dose[2]}`;
  return field;
}

export function hdcValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Display the source calendar day — timestamp ที่มี timezone ถูกแปลงตามเขตเวลาท้องถิ่นก่อน */
export function formatHdcDate(value: unknown): string {
  const text = hdcValue(value).trim();
  if (text === '—') return text;
  const day = calendarDay(text);
  return day ? `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}` : text;
}

export function getHdcVaccineRows(record: EpiRecord, rules?: VaccineRule[]) {
  const values = Object.fromEntries(Object.entries(record));
  const rows = rules ? rules.flatMap(rule => {
    const fields = [...new Set([...(rule.required_fields || []), ...(rule.branch_alt_fields || [])])];
    return fields.map(field => ({ field, name: rule.display_name || field, note: rule.note, id: `${rule.rule_id}-${field}` }));
  }) : Object.keys(record).filter(field => field.endsWith('_date')).map(field => ({ field, name: vaccineFieldLabel(field), note: undefined, id: field }));
  return rows.map(row => ({
    ...row,
    date: row.field && hasSourceColumn(record, row.field) ? hdcValue(values[row.field]) : 'ไฟล์ไม่มีคอลัมน์ / ยังไม่มีข้อมูลต้นทาง',
    facility: hdcValue(values[row.field.replace(/_date$/, '_hospcode')]),
    inputFacility: hdcValue(values[row.field.replace(/_date$/, '_input_hosp')]),
  }));
}

export function getHdcExportRows(records: EpiRecord[], rules?: VaccineRule[]) {
  const allowedDates = rules ? new Set(rules.flatMap(rule => [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])])) : null;
  const fields = [...new Set(records.flatMap(record =>
    Object.keys(record).filter(field => {
      if (field.startsWith('g_')) return !rules;
      if (!/_date$|_hospcode$|_input_hosp$/.test(field)) return false;
      return !allowedDates || allowedDates.has(field.replace(/_hospcode$|_input_hosp$/, '_date'));
    }),
  ))];
  return records.map(record => {
    const values = Object.fromEntries(Object.entries(record));
    return {
      'รหัสสถานบริการ': record.hoscode,
      'สถานบริการ': record.hosname,
      'PID': record.pid,
      'CID': record.cid,
      'ชื่อ-สกุล': `${record.name} ${record.lname}`,
      'วันเกิด': hdcValue(record.birth),
      'ที่อยู่': hdcValue(record.addr),
      'รหัสหมู่บ้าน': hdcValue(record.check_vhid),
      'ประเภทพื้นที่': hdcValue(record.check_typearea),
      'สัญชาติ': hdcValue(record.nation),
      'สถานะจำหน่าย': hdcValue(record.discharge),
      'ผลจาก HDC': hdcValue(record.result),
      ...Object.fromEntries(fields.map(field => [field, hasSourceColumn(record, field) ? hdcValue(values[field]) : 'ไม่มีคอลัมน์ต้นทาง'])),
    };
  });
}
