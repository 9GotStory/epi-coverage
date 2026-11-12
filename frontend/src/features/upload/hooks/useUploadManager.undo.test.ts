// @vitest-environment jsdom
/**
 * Issue #139 (#112) — Import Undo on the Upload page: the admin picks a table and Fiscal Year, sees the
 * server-computed preview, confirms once, and the Dashboard Summaries follow the Active Records.
 *
 * Seam: `useUploadManager` with only external boundaries mocked (`fetchApi`, `sonner`). Synthetic counts only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useUploadManager } from './useUploadManager';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock('../../../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const eligible = {
  success: true, eligible: true, batchId: 'wrong-file', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  importedAt: '2026-11-11T03:00:00.000Z', importedBy: 'admin@example.test',
  wouldDeactivate: 143, wouldReactivate: 181, activeAfter: 181, summariesWillBeRemoved: false,
  byHoscode: [{ hoscode: '00001', wouldDeactivate: 143, wouldReactivate: 181 }],
};
const activeRecord = { hoscode: '00001', pid: '1', sex: '1', birth: '2024-11-15', bcg_date: '2024-11-16', is_active: true };

function stubApi({ preview = eligible as Record<string, unknown>, undo = { success: true, deactivated: 143, reactivated: 181, summariesRemoved: false } as Record<string, unknown>, summaryError = false } = {}) {
  api.fetchApi.mockImplementation(async (action: string) => {
    if (action === 'previewEpiImportUndo') return { data: preview };
    if (action === 'undoEpiImport') return { data: undo };
    if (action === 'getEpiData') return { data: [activeRecord] };
    if (action === 'getVaccineRules') return { data: [] };
    if (action === 'saveDashboardSummary') return { data: summaryError ? { success: false, error: 'write failed' } : { success: true } };
    return { data: { success: true } };
  });
}
const actions = () => api.fetchApi.mock.calls.map(([name]) => name as string);
const calls = (action: string) => api.fetchApi.mock.calls.filter(([name]) => name === action).map(([, payload]) => payload);

async function hookWithPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useUploadManager(), { wrapper });
  await act(async () => { result.current.setUndoTable('Epi_1_Year'); });
  expect(actions()).not.toContain('previewEpiImportUndo'); // no year chosen yet
  await act(async () => { result.current.setUndoFiscalYear('2569'); });
  await waitFor(() => expect(result.current.undoPreview).not.toBeNull());
  return { result, invalidate };
}

beforeEach(() => { api.fetchApi.mockReset(); vi.mocked(toast.error).mockReset(); });
afterEach(() => { cleanup(); });

describe('Issue #139 — Import Undo in useUploadManager', () => {
  it('starts with no table or year and previews only after both are chosen', async () => {
    stubApi();
    const { result } = await hookWithPreview();
    expect(calls('previewEpiImportUndo')).toEqual([{ targetTable: 'Epi_1_Year', fiscalYear: '2569' }]);
    expect(result.current.undoPreview?.batchId).toBe('wrong-file');
    expect(actions()).not.toContain('undoEpiImport');
  });

  it('confirms with the previewed counts, then rewrites the summaries and refreshes the dashboards', async () => {
    stubApi();
    const { result, invalidate } = await hookWithPreview();
    await act(async () => { await result.current.confirmUndo(); });
    expect(calls('undoEpiImport')).toEqual([{ batchId: 'wrong-file', expected: { wouldDeactivate: 143, wouldReactivate: 181 } }]);
    const order = actions();
    expect(order.indexOf('previewEpiImportUndo')).toBeLessThan(order.indexOf('undoEpiImport'));
    expect(order.indexOf('undoEpiImport')).toBeLessThan(order.indexOf('saveDashboardSummary'));
    expect(calls('saveDashboardSummary').map(payload => (payload as { quarter: unknown }).quarter)).toEqual(['all', 1, 2, 3, 4]);
    for (const queryKey of [['dashboardSummaries'], ['dashboardSummariesMultiYear'], ['dashboardSummaryYears']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    expect(result.current.undoResult).toMatchObject({ deactivated: 143, reactivated: 181, summariesRemoved: false, summaryFailed: false });
    expect(result.current.undoPreview).toBeNull();
  });

  it('skips Summary Regeneration when the server already removed the summaries', async () => {
    stubApi({ preview: { ...eligible, activeAfter: 0, summariesWillBeRemoved: true }, undo: { success: true, deactivated: 143, reactivated: 0, summariesRemoved: true } });
    const { result, invalidate } = await hookWithPreview();
    await act(async () => { await result.current.confirmUndo(); });
    expect(actions()).not.toContain('saveDashboardSummary');
    expect(actions()).not.toContain('getEpiData');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboardSummaries'] });
    expect(result.current.undoResult?.summariesRemoved).toBe(true);
  });

  it('tells the admin to run Summary Regeneration when the summary write fails after the undo', async () => {
    stubApi({ summaryError: true });
    const { result, invalidate } = await hookWithPreview();
    await act(async () => { await result.current.confirmUndo(); });
    expect(result.current.undoResult?.summaryFailed).toBe(true);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining('ประมวลผล Dashboard ใหม่'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboardSummaries'] });
  });

  it('sends nothing when the admin cancels the preview', async () => {
    stubApi();
    const { result } = await hookWithPreview();
    await act(async () => { result.current.cancelUndo(); });
    expect(result.current.undoPreview).toBeNull();
    expect(result.current.undoFiscalYear).toBe('');
    expect(actions()).not.toContain('undoEpiImport');
  });

  it('a refused undo writes no summary, says why and shows the current preview again', async () => {
    stubApi({ undo: { success: false, reason: 'stale', error: 'The undo preview is out of date. Review it again.' } });
    const { result } = await hookWithPreview();
    await act(async () => { await result.current.confirmUndo(); });
    expect(actions()).not.toContain('saveDashboardSummary');
    expect(result.current.undoError).toMatch(/ตัวอย่างล้าสมัย/);
    expect(calls('previewEpiImportUndo')).toHaveLength(2);
    expect(result.current.undoResult).toBeNull();
  });
});

/** Issue #140 (#142): an undo the server could not finish is shown and finished from its plan (ADR-0010). */
const unfinished = {
  success: true, eligible: true, unfinished: true, batchId: 'wrong-file', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  importedAt: '2026-11-11T03:00:00.000Z', importedBy: 'importer@example.test', startedBy: 'admin@example.test', startedAt: '2026-11-12T03:00:00.000Z',
  wouldDeactivate: 143, wouldReactivate: 181, activeAfter: 181, summariesWillBeRemoved: false,
};

describe('Issue #140 — Unfinished Import Undo in useUploadManager', () => {
  it('finishes an unfinished undo with the planned counts and follows the normal success path', async () => {
    stubApi({ preview: unfinished });
    const { result, invalidate } = await hookWithPreview();
    expect(result.current.undoPreview).toMatchObject({ unfinished: true, startedBy: 'admin@example.test' });
    await act(async () => { await result.current.confirmUndo(); });
    expect(calls('undoEpiImport')).toEqual([{ batchId: 'wrong-file', expected: { wouldDeactivate: 143, wouldReactivate: 181 } }]);
    expect(calls('saveDashboardSummary')).toHaveLength(5);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboardSummaries'] });
    expect(result.current.undoResult).toMatchObject({ deactivated: 143, reactivated: 181 });
  });

  it('shows the current preview again when the undo request itself fails', async () => {
    stubApi();
    const { result } = await hookWithPreview();
    const fetchApi = api.fetchApi.getMockImplementation()!;
    api.fetchApi.mockImplementation(async (action: string, payload: unknown) => {
      if (action === 'undoEpiImport') throw new Error('Network Error');
      if (action === 'previewEpiImportUndo') return { data: unfinished };
      return fetchApi(action, payload);
    });
    await act(async () => { await result.current.confirmUndo(); });
    expect(result.current.undoError).toMatch(/ย้อนการนำเข้าไม่สำเร็จ/);
    await waitFor(() => expect(result.current.undoPreview).toMatchObject({ unfinished: true }));
    expect(calls('previewEpiImportUndo')).toHaveLength(2);
  });

  it('says in Thai to contact the system owner when the records no longer match the unfinished undo', async () => {
    stubApi({ preview: unfinished, undo: { success: false, reason: 'unfinished_mismatch', error: 'The records no longer match the unfinished undo.' } });
    const { result } = await hookWithPreview();
    await act(async () => { await result.current.confirmUndo(); });
    expect(result.current.undoError).toMatch(/ผู้ดูแลระบบ/);
    expect(actions()).not.toContain('saveDashboardSummary');
  });
});
