import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import { getHdcExportRows, getHdcVaccineRows, hdcValue, formatHdcDate } from './hdcData';

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
      id: 'j12_date', inputFacility: '—', mappingNote: undefined, field: 'j12_date', name: 'LAJE เข็ม 2', date: '2024-01-23', facility: '—',
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
      id: 'future1_date', inputFacility: '—', mappingNote: undefined, field: 'future1_date', name: 'future1_date', date: '2030-01-01', facility: '00002',
    });
  });

  it('exports every source dose column across records with source results and leading zeros', () => {
    const exported = getHdcExportRows([record, { ...record, pcv4_date: '2026-01-01', bcg_hospcode: '00002' }]);
    expect(exported[0]).toMatchObject({ CID: '0000000000000', 'ผลจาก HDC': 'ไม่ผ่าน', j12_date: '2024-01-23', je3_date: '—', pcv4_date: 'ไม่มีคอลัมน์ต้นทาง' });
    expect(exported[1]).toMatchObject({ pcv4_date: '2026-01-01', bcg_hospcode: '00002' });
    expect(exported[0]).not.toHaveProperty('ai_analysis');
    expect(record.j12_date).toBe('2024-01-23');
  });

  it('does not infer a result when HDC has no result', () => {
    expect(hdcValue(null)).toBe('—');
    expect(hdcValue('')).toBe('—');
    expect(hdcValue('ผ่านบางรายการ')).toBe('ผ่านบางรายการ');
    const rows = getHdcVaccineRows({ ...record, j11_date: undefined, j12_date: '', je3_date: null });
    expect(rows.find(row => row.field === 'j11_date')?.date).toContain('ไม่มีคอลัมน์');
    expect(rows.filter(row => row.field !== 'j11_date').every(row => row.date === '—')).toBe(true);
  });
});


describe('HDC history date formatting', () => {
  it('displays the literal source day as DD-MM-YYYY without a timezone shift', () => {
    expect(formatHdcDate('2023-10-03T17:00:00.000Z')).toBe('03-10-2023');
    expect(formatHdcDate('2023-10-03')).toBe('03-10-2023');
    expect(formatHdcDate('2023-10-03T23:30:00-07:00')).toBe('03-10-2023');
    expect(formatHdcDate(new Date('2023-10-03T17:00:00.000Z'))).toBe('03-10-2023');
    expect(formatHdcDate('2024-02-29')).toBe('29-02-2024');
  });
  it('retains empty, unknown and invalid source values rather than inventing dates', () => {
    expect(formatHdcDate(null)).toBe('—');
    expect(formatHdcDate('')).toBe('—');
    expect(formatHdcDate('2023-02-29')).toBe('2023-02-29');
    expect(formatHdcDate('2023-10-03Tinvalid')).toBe('2023-10-03Tinvalid');
    expect(formatHdcDate('ไฟล์ไม่มีคอลัมน์')).toBe('ไฟล์ไม่มีคอลัมน์');
    expect(formatHdcDate('ตรวจสอบต้นทาง')).toBe('ตรวจสอบต้นทาง');
  });
  it('does not change the stored or exported source timestamp', () => {
    const source = { ...record, j12_date: '2023-10-03T17:00:00.000Z' };
    const row = getHdcVaccineRows(source).find(row => row.field === 'j12_date')!;
    expect(formatHdcDate(row.date)).toBe('03-10-2023');
    expect(source.j12_date).toBe('2023-10-03T17:00:00.000Z');
    expect(getHdcExportRows([source])[0]).toHaveProperty('j12_date', source.j12_date);
  });
});
