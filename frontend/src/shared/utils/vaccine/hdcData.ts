import type { EpiAge } from '../../types/hdc';
import { AGE_VACCINES } from './ageVaccines';
import { hasSourceColumn } from './sourceColumns';
import type { EpiRecord } from '../../types';

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

export function getHdcVaccineRows(record: EpiRecord, age?: EpiAge) {
  const values = Object.fromEntries(Object.entries(record));
  const rows = age ? AGE_VACCINES[age].flatMap(item => {
    const fields = [...new Set([...item.fields, ...(item.alternatives || [])])];
    return (fields.length ? fields : ['']).map(field => ({ field, name: item.label, mappingNote: item.mappingNote, id: `${item.id}-${field}` }));
  }) : Object.keys(record).filter(field => field.endsWith('_date')).map(field => ({ field, name: vaccineFieldLabel(field), mappingNote: undefined, id: field }));
  return rows.map(row => ({
    ...row,
    date: row.field && hasSourceColumn(record, row.field) ? hdcValue(values[row.field]) : 'ไฟล์ไม่มีคอลัมน์ / ยังไม่มีข้อมูลต้นทาง',
    facility: hdcValue(values[row.field.replace(/_date$/, '_hospcode')]),
    inputFacility: hdcValue(values[row.field.replace(/_date$/, '_input_hosp')]),
  }));
}

export function getHdcExportRows(records: EpiRecord[], age?: EpiAge) {
  const allowedDates = age ? new Set(AGE_VACCINES[age].flatMap(item => [...item.fields, ...(item.alternatives || [])])) : null;
  const fields = [...new Set(records.flatMap(record =>
    Object.keys(record).filter(field => {
      if (field.startsWith('g_')) return !age;
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
