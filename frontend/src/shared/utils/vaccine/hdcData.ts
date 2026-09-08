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

export function getHdcVaccineRows(record: EpiRecord) {
  const values = Object.fromEntries(Object.entries(record));
  return Object.entries(record)
    .filter(([field]) => field.endsWith('_date'))
    .map(([field, value]) => ({
      field,
      name: vaccineFieldLabel(field),
      date: hdcValue(value),
      facility: hdcValue(values[field.replace(/_date$/, '_hospcode')]),
    }));
}

export function getHdcExportRows(records: EpiRecord[]) {
  const fields = [...new Set(records.flatMap(record =>
    Object.keys(record).filter(field => field.endsWith('_date') || field.endsWith('_hospcode')),
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
      'ผลจาก HDC': hdcValue(record.result),
      ...Object.fromEntries(fields.map(field => [field, hdcValue(values[field])])),
    };
  });
}
