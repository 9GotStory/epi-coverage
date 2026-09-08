import { describe, expect, it } from 'vitest';
import type { EpiRecord } from '../../types';
import { getRecordDateWarnings } from './dateWarnings';
const record = (values: Partial<EpiRecord>) => ({ birth: '2024-01-01', ...values }) as EpiRecord;
describe('record date warnings', () => {
  it('warns for duplicate doses and reversed order', () => {
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-05-01', dtp2_date: '2024-03-01' })).join()).toContain('DTP เข็ม 2: วันที่ฉีดก่อน DTP เข็ม 1');
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-03-01', dtp2_date: '2024-03-01T12:00:00Z' })).join()).toContain('วันที่ซ้ำซ้อน');
  });
  it('accepts normal order and coadministration of different vaccines', () => {
    expect(getRecordDateWarnings(record({ dtp1_date: '2024-03-01', dtp2_date: '2024-05-01', hib1_date: '2024-03-01' }))).toEqual([]);
  });
  it('checks dates before birth and invalid calendar dates', () => {
    const warnings = getRecordDateWarnings(record({ bcg_date: '2023-12-31', dtp1_date: '2024-02-30', dtp2_date: 'invalid' }));
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('ก่อนวันเกิด');
    expect(warnings[1]).toContain('รูปแบบวันที่ไม่ถูกต้อง');
  });
  it('keeps alternate series separate and detects order within LAJE', () => {
    expect(getRecordDateWarnings(record({ rv21_date: '2024-03-01', rv31_date: '2024-03-01', j11_date: '2024-04-01', je1_date: '2024-04-01' }))).toEqual([]);
    expect(getRecordDateWarnings(record({ j11_date: '2024-05-01', j12_date: '2024-04-01' })).join()).toContain('LAJE เข็ม 2: วันที่ฉีดก่อน LAJE เข็ม 1');
  });
  it('checks duplicates without birth and preserves the source result', () => {
    const input = record({ birth: '', result: 'ผ่าน', dtp1_date: '2024-03-01', dtp2_date: '2024-03-01' });
    const original = { ...input };
    expect(getRecordDateWarnings(input)).toHaveLength(1);
    expect(input).toEqual(original);
  });
  it('ignores empty dates and permits birth doses', () => {
    expect(getRecordDateWarnings(record({ bcg_date: '2024-01-01', dtp1_date: '', dtp2_date: '-' }))).toEqual([]);
  });
});
