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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const rows = [
  { hoscode: '00001', hosname: 'หน่วยจำลอง', pid: '1', cid: '0000000000001', sex: '1', birth: '2024-11-15', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ', bcg_date: '2024-11-16' },
  { hoscode: '00001', hosname: 'หน่วยจำลอง', pid: '2', cid: '0000000000002', sex: '2', birth: '2024-12-01', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ', bcg_date: '2024-12-02' },
];

const riskyPreflight = {
  success: true, batchId: 'server-echo', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 0, newRows: 2, wouldDeactivate: 5, activeBefore: 5, outsideCohort: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 5, matched: 0, newRows: 2, wouldDeactivate: 5, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true, outsideCohortBirthRange: false },
  cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: null,
  requiredConfirmations: { existingChildren: 5 }, shrinkThreshold: 0.2,
};
const safePreflight = { ...riskyPreflight, matched: 2, newRows: 0, wouldDeactivate: 0, activeBefore: 2,
  byHoscode: [{ hoscode: '00001', activeBefore: 2, matched: 2, newRows: 0, wouldDeactivate: 0, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohortBirthRange: false }, requiredConfirmations: null };
/** Issue #136: a sync that both shrinks the existing children and has births outside the Cohort Birth Range. */
const twoRiskPreflight = { ...riskyPreflight, outsideCohort: 2, outsideCohortFiscalYear: '2568',
  byHoscode: [{ hoscode: '00001', activeBefore: 5, matched: 0, newRows: 2, wouldDeactivate: 5, outsideCohort: 2 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true, outsideCohortBirthRange: true },
  requiredConfirmations: { existingChildren: 5, outsideCohort: 2 } };

function stubApi(preflight: Record<string, unknown>, { confirmError }: { confirmError?: string } = {}) {
  api.fetchApi.mockImplementation(async (action: string) => {
    if (action === 'preflightEpiImport') return { data: preflight };
    if (action === 'confirmEpiImport') return { data: confirmError ? { success: false, error: confirmError } : { success: true, required: true } };
    // Issue #144 (ADR-0011): the last chunk finalizes the batch and reports its deactivations.
    if (action === 'upsertEpiData') return { data: { success: true, inserted: 2, updated: 0, finalized: true, deactivated: 5 } };
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
    expect(result.current.preflight?.requiredConfirmations).toEqual({ existingChildren: 5 });
  });

  it('a risky import confirms the typed number, then uploads the same batch, which its last chunk finalizes', async () => {
    stubApi(riskyPreflight);
    const result = await preparedHook();
    const batchId = (calls('preflightEpiImport')[0] as { batchId: string }).batchId;
    await act(async () => { await result.current.confirmUpload({ existingChildren: '5' }); });
    expect(calls('confirmEpiImport')).toEqual([{ batchId, typedNumbers: { existingChildren: '5' } }]);
    expect(calls('upsertEpiData')).toEqual([expect.objectContaining({ batchId, chunk: rows, fiscalYear: '2569', targetTable: 'Epi_1_Year' })]);
    expect(calls('cleanupEpiData')).toHaveLength(0);
    expect(result.current.results.deactivated).toBe(5);
    expect(result.current.status).toBe('success');
  });

  it('a confirmation the server rejects writes nothing and stays on the confirmation step', async () => {
    stubApi(riskyPreflight, { confirmError: 'Typed number does not match.' });
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload({ existingChildren: '4' }); });
    expect(calls('upsertEpiData')).toHaveLength(0);
    expect(result.current.status).toBe('confirming');
    expect(result.current.errorMsg).toMatch(/ตัวเลขยืนยันไม่ตรง/);
  });

  it('a confirmation failing for another reason shows that reason, not a typing error', async () => {
    stubApi(riskyPreflight, { confirmError: 'Only the admin who ran the preflight can confirm.' });
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload({ existingChildren: '5' }); });
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

describe('Issue #136 — one typed number per risk condition; no default Fiscal Year', () => {
  it('sends the typed number of every fired condition in one confirmation', async () => {
    stubApi(twoRiskPreflight);
    const result = await preparedHook();
    const batchId = (calls('preflightEpiImport')[0] as { batchId: string }).batchId;
    await act(async () => { await result.current.confirmUpload({ existingChildren: '5', outsideCohort: '2' }); });
    expect(calls('confirmEpiImport')).toEqual([{ batchId, typedNumbers: { existingChildren: '5', outsideCohort: '2' } }]);
    expect(calls('upsertEpiData')).toHaveLength(1);
  });

  it('starts with no Fiscal Year and sends nothing to the server until one is chosen', async () => {
    stubApi(safePreflight);
    parser.parseHdcFile.mockResolvedValue({ rows, columns: Object.keys(rows[0]) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useUploadManager(), { wrapper });
    expect(result.current.fiscalYear).toBe('');
    await act(async () => { await result.current.handleDrop([new File(['x'], 'EPI-1YEAR.xlsx')]); });
    await act(async () => { await result.current.handleUpload(); });
    await act(async () => { await result.current.handleSyncAll(); });
    expect(api.fetchApi).not.toHaveBeenCalled();
  });

  it('keeps the chosen Fiscal Year after an import so the next file of the round uses it', async () => {
    stubApi(safePreflight);
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload(); });
    await act(async () => { result.current.handleReset(); });
    expect(result.current.file).toBeNull();
    expect(result.current.fiscalYear).toBe('2569');
  });
});

describe('Issue #140 — an Unfinished Import Undo blocks the import', () => {
  const blocked = { success: false, reason: 'unfinished_undo', error: 'An Import Undo of this table and fiscal year is unfinished. Finish it first.' };

  it('explains a refused preflight in Thai, naming the table and Fiscal Year and the undo section', async () => {
    stubApi(blocked);
    const result = await preparedHook();
    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toMatch(/เด็ก 1 ปี.*ปีงบประมาณ 2569/);
    expect(result.current.errorMsg).toMatch(/ย้อนการนำเข้าล่าสุด/);
    expect(calls('upsertEpiData')).toHaveLength(0);
  });

  it('explains the same refusal of the first chunk write', async () => {
    stubApi(safePreflight);
    const result = await preparedHook();
    const fetchApi = api.fetchApi.getMockImplementation()!;
    api.fetchApi.mockImplementation(async (action: string, payload: unknown) =>
      action === 'upsertEpiData' ? { data: blocked } : fetchApi(action, payload));
    await act(async () => { await result.current.confirmUpload(); });
    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toMatch(/เด็ก 1 ปี.*ปีงบประมาณ 2569.*ย้อนการนำเข้าล่าสุด/);
    expect(calls('cleanupEpiData')).toHaveLength(0);
  });
});

describe('Issue #144 — the last chunk finalizes the import (ADR-0011)', () => {
  it('a successful import never calls cleanup, shows the finalizing chunk\'s deactivations, then writes the summaries', async () => {
    stubApi(safePreflight);
    const result = await preparedHook();
    await act(async () => { await result.current.confirmUpload(); });
    expect(calls('cleanupEpiData')).toHaveLength(0);
    expect(result.current.status).toBe('success');
    expect(result.current.results).toEqual({ inserted: 2, updated: 0, deactivated: 5 });
    expect(calls('getEpiData')).toHaveLength(1); // the Dashboard Summary step still runs after the finalize
  });

  it('a last chunk that does not report the batch finalized is a failure: no cleanup call and no summary', async () => {
    stubApi(safePreflight);
    const result = await preparedHook();
    const fetchApi = api.fetchApi.getMockImplementation()!;
    api.fetchApi.mockImplementation(async (action: string, payload: unknown) =>
      action === 'upsertEpiData' ? { data: { success: true, inserted: 2, updated: 0, finalized: false } } : fetchApi(action, payload));
    await act(async () => { await result.current.confirmUpload(); });
    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).not.toBe('');
    expect(calls('cleanupEpiData')).toHaveLength(0);
    expect(calls('getEpiData')).toHaveLength(0);
  });
});
