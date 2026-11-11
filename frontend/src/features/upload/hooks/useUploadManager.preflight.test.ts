// @vitest-environment jsdom
/**
 * Issue #111 — the upload flow must preview the import (server-side preflight) and wait for the
 * admin's confirmation before any EPI write.
 *
 * Seam: `useUploadManager` with only external boundaries mocked (`fetchApi`, the file parser, `sonner`).
 * All records are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useUploadManager } from './useUploadManager';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const parser = vi.hoisted(() => ({ parseHdcFile: vi.fn() }));
vi.mock('../../../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('../utils/parseHdcFile', () => ({ parseHdcFile: parser.parseHdcFile }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rows = [
  { hoscode: '00001', hosname: 'หน่วยจำลอง', pid: '1', cid: '0000000000001', sex: '1', birth: '2024-11-15', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ', bcg_date: '2024-11-16' },
  { hoscode: '00001', hosname: 'หน่วยจำลอง', pid: '2', cid: '0000000000002', sex: '2', birth: '2024-12-01', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ', bcg_date: '2024-12-02' },
];

const riskyPreflight = {
  success: true, batchId: 'server-echo', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 0, newRows: 2, wouldDeactivate: 5, activeBefore: 5,
  byHoscode: [{ hoscode: '00001', activeBefore: 5, matched: 0, newRows: 2, wouldDeactivate: 5 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true }, requiredConfirmation: 5, shrinkThreshold: 0.2,
};
const safePreflight = { ...riskyPreflight, matched: 2, newRows: 0, wouldDeactivate: 0, activeBefore: 2,
  byHoscode: [{ hoscode: '00001', activeBefore: 2, matched: 2, newRows: 0, wouldDeactivate: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false }, requiredConfirmation: null };

function stubApi(preflight: Record<string, unknown>, { confirmError }: { confirmError?: string } = {}) {
  api.fetchApi.mockImplementation(async (action: string) => {
    if (action === 'preflightEpiImport') return { data: preflight };
    if (action === 'confirmEpiImport') return { data: confirmError ? { success: false, error: confirmError } : { success: true, required: true } };
    if (action === 'upsertEpiData') return { data: { success: true, inserted: 2, updated: 0 } };
    if (action === 'cleanupEpiData') return { data: { success: true, deactivated: 5 } };
    if (action === 'getEpiData') return { data: [] };
    if (action === 'getVaccineRules') return { data: [] };
    return { data: { success: true } };
  });
}
const calls = (action: string) => api.fetchApi.mock.calls.filter(([name]) => name === action).map(([, payload]) => payload);

async function preparedHook() {
  parser.parseHdcFile.mockResolvedValue({ rows, columns: Object.keys(rows[0]) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useUploadManager(), { wrapper });
  await act(async () => { result.current.setFiscalYear('2569'); result.current.setImportMode('sync'); });
  await act(async () => { await result.current.handleDrop([new File(['x'], 'EPI-1YEAR.xlsx')]); });
  await act(async () => { await result.current.handleUpload(); });
  return result;
}

beforeEach(() => { api.fetchApi.mockReset(); parser.parseHdcFile.mockReset(); });
afterEach(() => { cleanup(); });

describe('Issue #111 — preflight before any import write', () => {
  it('sends identity keys only to preflight and writes nothing until the admin confirms', async () => {
    stubApi(riskyPreflight);
    const result = await preparedHook();
    const [sent] = calls('preflightEpiImport') as Array<Record<string, unknown>>;
    expect(sent).toMatchObject({ fiscalYear: '2569', targetTable: 'Epi_1_Year', mode: 'sync' });
    expect(sent.keyChunks).toEqual([[
      { hoscode: '00001', pid: '1', cid: '0000000000001', sex: '1', birth: '2024-11-15', check_vhid: '00000101' },
      { hoscode: '00001', pid: '2', cid: '0000000000002', sex: '2', birth: '2024-12-01', check_vhid: '00000101' },
    ]]);
    expect(calls('upsertEpiData')).toHaveLength(0);
    expect(result.current.status).toBe('confirming');
    expect(result.current.preflight?.requiredConfirmation).toBe(5);
  });

  it('a risky import confirms the typed number, then uploads the same batch and finalizes', async () => {
    stubApi(riskyPreflight);
    const result = await preparedHook();
    const batchId = (calls('preflightEpiImport')[0] as { batchId: string }).batchId;
    await act(async () => { await result.current.confirmUpload('5'); });
    expect(calls('confirmEpiImport')).toEqual([{ batchId, typedNumber: '5' }]);
    expect(calls('upsertEpiData')).toEqual([expect.objectContaining({ batchId, chunk: rows, fiscalYear: '2569', targetTable: 'Epi_1_Year' })]);
    expect(calls('cleanupEpiData')).toEqual([expect.objectContaining({ batchId })]);
    expect(result.current.status).toBe('success');
  });

  it('a confirmation the server rejects writes nothing and stays on the confirmation step', async () => {
    stubApi(riskyPreflight, { confirmError: 'Typed number does not match.' });
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload('4'); });
    expect(calls('upsertEpiData')).toHaveLength(0);
    expect(result.current.status).toBe('confirming');
    expect(result.current.errorMsg).toMatch(/ตัวเลขยืนยันไม่ตรง/);
  });

  it('a confirmation failing for another reason shows that reason, not a typing error', async () => {
    stubApi(riskyPreflight, { confirmError: 'Only the admin who ran the preflight can confirm.' });
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload('5'); });
    expect(calls('upsertEpiData')).toHaveLength(0);
    expect(result.current.errorMsg).not.toMatch(/ตัวเลขยืนยันไม่ตรง/);
    expect(result.current.errorMsg).toContain('Only the admin who ran the preflight can confirm.');
  });

  it('cancelling after preflight writes nothing', async () => {
    stubApi(riskyPreflight);
    const result = await preparedHook();
    await act(async () => { result.current.cancelPreflight(); });
    expect(calls('confirmEpiImport')).toHaveLength(0);
    expect(calls('upsertEpiData')).toHaveLength(0);
    expect(result.current.preflight).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('a safe import needs only the summary click — no typed confirmation call', async () => {
    stubApi(safePreflight);
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload(); });
    expect(calls('confirmEpiImport')).toHaveLength(0);
    expect(calls('upsertEpiData')).toHaveLength(1);
    expect(result.current.status).toBe('success');
  });
});
