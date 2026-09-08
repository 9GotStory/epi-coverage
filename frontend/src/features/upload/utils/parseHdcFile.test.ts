/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHdcFile } from './parseHdcFile';
import { hdcSourceFields } from '../../../shared/utils/vaccine/hdcSchema';
import type { EpiAge } from '../../../shared/types/hdc';

const base = { hoscode: '00588', cid: '0000000000001', name: 'ข้อมูล', lname: 'จำลอง', birth: '2025-01-01', bcg_date: '2025-01-01' };
const json = (rows: unknown, name = 'EPI-1YEAR.json') => new File([JSON.stringify(rows)], name, { type: 'application/json' });

describe('HDC parsing contract', () => {
  it('normalizes aliases and all facility codes, preserving text addresses', async () => {
    const { rows } = await parseHdcFile(json([{ ...base, hoscode: 588, bcg_hospcode: 1, bcg_input_hosp: 'AE123', addr: '001/2', heck_typearea: 3 }]), 1);
    expect(rows[0]).toMatchObject({ hoscode: '00588', bcg_hospcode: '00001', bcg_input_hosp: 'AE123', addr: '001/2', check_typearea: '3' });
  });
  it('retains entirely empty Excel columns while omitted JSON keys remain absent', async () => {
    const sheet = utils.aoa_to_sheet([Object.keys(base).concat('bcg_input_hosp'), Object.values(base).concat('')]);
    const book = utils.book_new(); utils.book_append_sheet(book, sheet, 'HDC');
    const file = new File([write(book, { type: 'array', bookType: 'xlsx' })], 'test.xlsx');
    const parsed = await parseHdcFile(file, 1);
    expect(parsed.columns).toContain('bcg_input_hosp'); expect(parsed.rows[0].bcg_input_hosp).toBeNull();
    expect((await parseHdcFile(json([base]), 1)).rows[0]).not.toHaveProperty('bcg_input_hosp');
  });
  it('validates after row 50, rejects impossible dates, and rejects duplicate identities', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...base, cid: String(index).padStart(13, '0') }));
    rows[50].birth = '2025-02-30';
    await expect(parseHdcFile(json(rows), 1)).rejects.toThrow('วันที่');
    await expect(parseHdcFile(json([base, base]), 1)).rejects.toThrow('ซ้ำ');
  });
  it('rejects ambiguous headers, wrong age, unsupported data and protected metadata before upload', async () => {
    await expect(parseHdcFile(json([{ ...base, hosp: '00001' }]), 1)).rejects.toThrow('ซ้ำ');
    await expect(parseHdcFile(json([base], 'EPI-5YEAR.json'), 1)).rejects.toThrow('กลุ่มอายุ');
    await expect(parseHdcFile(json([{ ...base, ai_analysis: 'bad' }]), 1)).rejects.toThrow('ไม่รองรับ');
    await expect(parseHdcFile(json({ data: [base] }), 1)).rejects.toThrow('JSON');
  });
  it('keeps frontend source allowlists exactly aligned with backend schemas', () => {
    const context: { getEpiSchemas?: () => Record<string, string[]> } = {};
    runInNewContext(readFileSync(new URL('../../../../../backend/src/Setup.js', import.meta.url), 'utf8'), context);
    const system = ['batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at', 'source_columns'];
    for (const age of [1, 2, 3, 5] as EpiAge[]) {
      expect(hdcSourceFields(age).sort()).toEqual(context.getEpiSchemas!()[`Epi_${age}_Year`].filter(field => !system.includes(field)).sort());
    }
  });
});

it('supports masked CIDs with unique PIDs and refuses masked records without PID', async () => {
  const rows = [{ ...base, cid: '123456*******', pid: '001' }, { ...base, cid: '123456*******', pid: '002' }];
  expect((await parseHdcFile(json(rows), 1)).rows).toHaveLength(2);
  await expect(parseHdcFile(json([{ ...base, cid: '123456*******' }]), 1)).rejects.toThrow('PID');
});
