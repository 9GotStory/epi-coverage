import type { EpiRecord } from '../../types';
export function hasSourceColumn(record: EpiRecord, field: string): boolean {
  if (record.source_columns) {
    try {
      const columns: unknown = JSON.parse(record.source_columns);
      if (Array.isArray(columns)) return columns.includes(field);
    } catch { /* Legacy records have no reliable column manifest. */ }
  }
  if (Object.prototype.hasOwnProperty.call(record, 'source_columns')) {
    const value = record[field as keyof EpiRecord];
    return value !== '' && value !== null && value !== undefined;
  }
  return Object.prototype.hasOwnProperty.call(record, field) && record[field as keyof EpiRecord] !== undefined;
}
