import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import { getHdcExportRows, getHdcVaccineRows, hdcValue } from './hdcData';

const record: EpiRecord = {
  hoscode: '00001', hosname: 'สถานบริการทดสอบ', pid: '0001',
  cid: '0000000000000', name: 'ข้อมูล', lname: 'ทดสอบ', birth: '2022-12-23',
  j11_date: '2024-01-23', j12_date: '2024-01-23', je3_date: null,
  result: 'ไม่ผ่าน', ai_analysis: 'ข้อความเก่า', ai_analyzed_at: '2025-01-01',
};

describe('HDC source data', () => {
  it('keeps duplicate dates in separate doses and retains empty alternatives', () => {
    const rows = getHdcVaccineRows(record);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.field === 'j12_date')).toEqual({
      field: 'j12_date', name: 'LAJE เข็ม 2', date: '2024-01-23', facility: '—',
    });
    expect(rows.find(row => row.field === 'je3_date')?.date).toBe('—');
    expect(rows.filter(row => row.date === '2024-01-23')).toHaveLength(2);
  });

  it('preserves unusual source values and dates outside local rules', () => {
    const rows = getHdcVaccineRows({ ...record, bcg_date: '2020-01-01', pcv1_date: 'ตรวจสอบต้นทาง', ipv1_date: '2024-01-23T00:00:00.000Z' });
    expect(rows.find(row => row.field === 'bcg_date')?.date).toBe('2020-01-01');
    expect(rows.find(row => row.field === 'pcv1_date')?.date).toBe('ตรวจสอบต้นทาง');
    expect(rows.find(row => row.field === 'ipv1_date')?.date).toBe('2024-01-23T00:00:00.000Z');
  });

  it('includes new vaccine columns and their facility codes without a rule', () => {
    const rows = getHdcVaccineRows({ ...record, future1_date: '2030-01-01', future1_hospcode: '00002' } as EpiRecord);
    expect(rows.find(row => row.field === 'future1_date')).toEqual({
      field: 'future1_date', name: 'future1_date', date: '2030-01-01', facility: '00002',
    });
  });

  it('exports every source dose column across records with source results and leading zeros', () => {
    const exported = getHdcExportRows([record, { ...record, pcv4_date: '2026-01-01', bcg_hospcode: '00002' }]);
    expect(exported[0]).toMatchObject({ CID: '0000000000000', 'ผลจาก HDC': 'ไม่ผ่าน', j12_date: '2024-01-23', je3_date: '—', pcv4_date: '—' });
    expect(exported[1]).toMatchObject({ pcv4_date: '2026-01-01', bcg_hospcode: '00002' });
    expect(exported[0]).not.toHaveProperty('ai_analysis');
    expect(record.j12_date).toBe('2024-01-23');
  });

  it('does not infer a result when HDC has no result', () => {
    expect(hdcValue(null)).toBe('—');
    expect(hdcValue('')).toBe('—');
    expect(hdcValue('ผ่านบางรายการ')).toBe('ผ่านบางรายการ');
    expect(getHdcVaccineRows({ ...record, j11_date: undefined, j12_date: '', je3_date: null }).every(row => row.date === '—')).toBe(true);
  });
});
