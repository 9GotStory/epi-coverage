import type { EpiRecord } from '../../types';
import { vaccineFieldLabel } from './hdcData';

// Data-quality checks only. These warnings never replace the imported HDC result.
function dateKey(value: unknown): string | null {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '').trim();
  if (!text || text === '-' || text === '—') return null;
  const day = text.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? '' : day;
}

export function getRecordDateWarnings(record: EpiRecord): string[] {
  const warnings: string[] = [];
  const birth = dateKey(record.birth);
  const dates = Object.entries(record).filter(([field]) => field.endsWith('_date'))
    .map(([field, value]) => ({ field, day: dateKey(value) }));
  for (const { field, day } of dates) {
    if (day === '') warnings.push(`${vaccineFieldLabel(field)}: รูปแบบวันที่ไม่ถูกต้อง`);
    else if (day && birth && day < birth) warnings.push(`${vaccineFieldLabel(field)}: วันที่ฉีดก่อนวันเกิด`);
  }
  // Compare doses within the same series only; Rota 2/3-dose and LAJE/JE stay separate.
  const seriesDose = (field: string) => field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/);
  for (let i = 0; i < dates.length; i++) {
    const a = dates[i];
    const left = seriesDose(a.field);
    if (!left || !a.day) continue;
    for (const b of dates.slice(i + 1)) {
      const right = seriesDose(b.field);
      if (!right || !b.day || left[1] !== right[1]) continue;
      const [earlier, later] = Number(left[2]) < Number(right[2]) ? [a, b] : [b, a];
      if (earlier.day === later.day) warnings.push(`${vaccineFieldLabel(earlier.field)} / ${vaccineFieldLabel(later.field)}: วันที่ซ้ำซ้อนกับเข็มอื่น`);
      else if (earlier.day! > later.day!) warnings.push(`${vaccineFieldLabel(later.field)}: วันที่ฉีดก่อน ${vaccineFieldLabel(earlier.field)}`);
    }
  }
  return warnings;
}
