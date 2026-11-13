// @vitest-environment jsdom
/**
 * Issue #156 — when an `upsertEpiData` answer is a Lost Response (CONTEXT.md §50), the Import checks its own
 * Batch through the Import Undo preview instead of signing the admin out or resending a chunk.
 *
 * Seam: `useUploadManager` with only external boundaries mocked (`fetchApi`, the file parser, `sonner`);
 * the real `LostResponseError` is kept. All records are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useUploadManager } from './useUploadManager';
import { LostResponseError } from '../../../shared/lib/api';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const parser = vi.hoisted(() => ({ parseHdcFile: vi.fn() }));
vi.mock('../../../shared/lib/api', async importOriginal => ({ ...(await importOriginal<object>()), fetchApi: api.fetchApi }));
vi.mock('../utils/parseHdcFile', () => ({ parseHdcFile: parser.parseHdcFile }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const NOT_FINALIZED = 'ระบบยังไม่ปิดการนำเข้าชุดนี้ กรุณานำเข้าไฟล์ใหม่อีกครั้ง';
const LOST = 'ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ — คำขออาจทำงานสำเร็จแล้ว โปรดตรวจสอบก่อนทำซ้ำ';

/** `count` synthetic children of one facility; 1,001 rows are three chunks of 500, 500 and 1. */
const syntheticRows = (count: number) => Array.from({ length: count }, (_, i) => ({
  hoscode: '00001', hosname: 'หน่วยจำลอง', pid: String(i + 1), cid: String(i + 1).padStart(13, '0'), sex: '1',
  birth: '2024-11-15', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ',
}));

const preflight = {
  success: true, batchId: 'server-echo', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 0, newRows: 1, wouldDeactivate: 0, activeBefore: 0, outsideCohort: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 0, matched: 0, newRows: 1, wouldDeactivate: 0, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohortBirthRange: false },
  cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: null,
  requiredConfirmations: null, shrinkThreshold: 0.2,
};

type Preview = (batchId: string) => unknown;
/** `lostChunk`: the chunk index whose answer is lost; `preview`: what previewEpiImportUndo answers (or throws). */
function stubApi({ lostChunk, preview }: { lostChunk: number; preview: Preview }) {
  api.fetchApi.mockImplementation(async (action: string, payload: { batchId?: string; options?: { chunkIndex: number; totalChunks: number } }) => {
    if (action === 'preflightEpiImport') return { data: preflight };
    if (action === 'upsertEpiData') {
      const { chunkIndex, totalChunks } = payload.options!;
      if (chunkIndex === lostChunk) throw new LostResponseError();
      return { data: { success: true, inserted: 500, updated: 0, finalized: chunkIndex === totalChunks - 1, deactivated: 0 } };
    }
    if (action === 'previewEpiImportUndo') return { data: preview(batchOf()) };
    if (action === 'getEpiData') return { data: syntheticRows(1) };
    if (action === 'getVaccineRules') return { data: [] };
    return { data: { success: true } };
  });
}
const calls = (action: string) => api.fetchApi.mock.calls.filter(([name]) => name === action).map(([, payload]) => payload);
const batchOf = () => (calls('preflightEpiImport')[0] as { batchId: string }).batchId;
/** Every chunk sent, in order; a resent chunk would show up twice. */
const chunkIndexesSent = () => calls('upsertEpiData').map(payload => (payload as { options: { chunkIndex: number } }).options.chunkIndex);

async function importRows(count: number) {
  parser.parseHdcFile.mockResolvedValue({ rows: syntheticRows(count), columns: Object.keys(syntheticRows(1)[0]) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useUploadManager(), { wrapper });
  await act(async () => { result.current.setFiscalYear('2569'); result.current.setImportMode('sync'); });
  await act(async () => { await result.current.handleDrop([new File(['x'], 'EPI-1YEAR.xlsx')]); });
  await act(async () => { await result.current.handleUpload(); });
  await act(async () => { await result.current.confirmUpload(); });
  return result;
}

const finalizedPreview: Preview = batchId => ({ targetTable: 'Epi_1_Year', fiscalYear: '2569', eligible: false, reason: 'updated_existing',
  batchId, mode: 'sync', importedAt: '2026-11-12T03:00:00.000Z', importedBy: 'admin@example.test' });
const notFinalizedPreview: Preview = batchId => ({ targetTable: 'Epi_1_Year', fiscalYear: '2569', eligible: false, reason: 'in_progress',
  batchId, mode: 'sync', importedAt: null, importedBy: 'admin@example.test' });

beforeEach(() => { api.fetchApi.mockReset(); parser.parseHdcFile.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Issue #156 — an Import checks its own Batch after a Lost Response', () => {
  it('a lost last-chunk answer whose Batch the server finalized finishes as a success without counts', async () => {
    stubApi({ lostChunk: 2, preview: finalizedPreview });
    const result = await importRows(1001);

    expect(calls('previewEpiImportUndo')).toEqual([{ targetTable: 'Epi_1_Year', fiscalYear: '2569' }]);
    expect(result.current.status).toBe('success');
    expect(result.current.countsNotReceived).toBe(true);
    expect(calls('saveDashboardSummary')).toHaveLength(5);
    expect(chunkIndexesSent()).toEqual([0, 1, 2]);
  });

  it.each<[string, Preview]>([
    ['this Batch is not finalized', notFinalizedPreview],
    ['the latest receipt is another Batch', () => ({ ...(finalizedPreview('another-batch') as object) })],
    ['no receipt exists yet', () => ({ targetTable: 'Epi_1_Year', fiscalYear: '2569', eligible: false, reason: 'no_batch' })],
  ])('when %s, the Import is not finished and no summary is written', async (_case, preview) => {
    stubApi({ lostChunk: 2, preview });
    const result = await importRows(1001);

    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toBe(NOT_FINALIZED);
    expect(calls('saveDashboardSummary')).toHaveLength(0);
    expect(result.current.countsNotReceived).toBe(false);
    expect(chunkIndexesSent()).toEqual([0, 1, 2]);
  });

  it.each<[string, Preview]>([
    ['the check is a Lost Response too', () => { throw new LostResponseError(); }],
    ['the check answers with an error', () => ({ success: false, error: 'Invalid import scope.' })],
  ])('when %s, the admin is told to look at Import Undo before importing again', async (_case, preview) => {
    stubApi({ lostChunk: 2, preview });
    const result = await importRows(1001);

    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toContain(LOST);
    expect(result.current.errorMsg).toContain('ย้อนการนำเข้าล่าสุด');
    expect(calls('saveDashboardSummary')).toHaveLength(0);
    expect(result.current.countsNotReceived).toBe(false);
    expect(chunkIndexesSent()).toEqual([0, 1, 2]);
  });

  it('a lost middle-chunk answer sends no later chunk and follows the check', async () => {
    stubApi({ lostChunk: 1, preview: notFinalizedPreview });
    const result = await importRows(1001);

    expect(chunkIndexesSent()).toEqual([0, 1]);
    expect(calls('previewEpiImportUndo')).toHaveLength(1);
    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toBe(NOT_FINALIZED);
  });

  it('a normal Import does not mark its counts as not received', async () => {
    stubApi({ lostChunk: -1, preview: finalizedPreview });
    const result = await importRows(1001);

    expect(result.current.status).toBe('success');
    expect(result.current.countsNotReceived).toBe(false);
    expect(result.current.results.inserted).toBe(1500);
    expect(calls('previewEpiImportUndo')).toHaveLength(0);
  });
});
