// @vitest-environment jsdom
/**
 * Issue #134 (#115) — a Dashboard Summary is written only for an Age Group table that has
 * Active Records for the Fiscal Year (CONTEXT.md §44). Applies to Summary Regeneration
 * (`handleSyncAll`) and to the summary step after an Import (`confirmUpload`).
 *
 * Seam: `useUploadManager` with only external boundaries mocked (`fetchApi`, the file parser,
 * `sonner`). The real evaluators and calcGroupSummary run. All records are synthetic, and the
 * Fiscal Year is pinned to 2569 so the fixtures do not depend on today's date.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useUploadManager } from './useUploadManager';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const parser = vi.hoisted(() => ({ parseHdcFile: vi.fn() }));
vi.mock('../../../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('../utils/parseHdcFile', () => ({ parseHdcFile: parser.parseHdcFile }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

type Table = 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';

/** One synthetic Active Record per table, born in FY2569 Q1 for that table's age (Q2–Q4 stay empty). */
const recordInQ1: Record<Table, Record<string, unknown>> = {
  Epi_1_Year: { hoscode: '00001', pid: '1', sex: '1', birth: '2024-11-15', bcg_date: '2024-11-16' },
  Epi_2_Year: { hoscode: '00001', pid: '2', sex: '2', birth: '2023-11-15' },
  Epi_3_Year: { hoscode: '00001', pid: '3', sex: '1', birth: '2022-11-15' },
  Epi_5_Year: { hoscode: '00001', pid: '5', sex: '2', birth: '2020-11-15' },
};

interface SaveCall { targetTable: string; fiscalYear: number | string; quarter: string | number; summaryData: string }

function stubApi(activeRecords: Partial<Record<Table, Record<string, unknown>[]>>) {
  const saved: SaveCall[] = [];
  api.fetchApi.mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
    if (action === 'getEpiData') return { data: activeRecords[payload?.targetTable as Table] ?? [] };
    if (action === 'getVaccineRules') return { data: [] };
    if (action === 'saveDashboardSummary') {
      saved.push(payload as unknown as SaveCall);
      return { data: { success: true } };
    }
    if (action === 'preflightEpiImport') return { data: safePreflight };
    if (action === 'upsertEpiData') return { data: { success: true, inserted: 0, updated: 2, finalized: true, deactivated: 7 } }; // Issue #144: the last chunk finalizes
    return { data: { success: true } };
  });
  return saved;
}

const safePreflight = {
  success: true, batchId: 'server-echo', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 2, newRows: 0, wouldDeactivate: 0, activeBefore: 2, outsideCohort: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 2, matched: 2, newRows: 0, wouldDeactivate: 0, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohortBirthRange: false },
  cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: null,
  requiredConfirmations: null, shrinkThreshold: 0.2,
};

let client: QueryClient;
function renderManager() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useUploadManager(), { wrapper }).result;
}

async function runSummaryRegeneration(activeRecords: Partial<Record<Table, Record<string, unknown>[]>>) {
  const saved = stubApi(activeRecords);
  const result = renderManager();
  await act(async () => { result.current.setFiscalYear('2569'); });
  await act(async () => { await result.current.handleSyncAll(); });
  return saved;
}

const savedScopes = (saved: SaveCall[]) => saved.map(call => `${call.targetTable}_${call.fiscalYear}_${call.quarter}`);
const allFiveRows = (table: Table) => [`${table}_2569_all`, `${table}_2569_1`, `${table}_2569_2`, `${table}_2569_3`, `${table}_2569_4`];

beforeEach(() => {
  api.fetchApi.mockReset();
  parser.parseHdcFile.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => { cleanup(); });

describe('Issue #134 — Summary Regeneration skips Age Group tables with no Active Records', () => {
  it('#115 regression: all four tables empty writes nothing and reports an error naming the Fiscal Year', async () => {
    const saved = await runSummaryRegeneration({});
    expect(saved).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ไม่มีข้อมูลปีงบประมาณ 2569 ในทุกกลุ่มอายุ — ไม่ได้บันทึกสรุป');
  });

  it('a partial run writes `_all` + Q1–Q4 for tables with data, nothing for the empty one, and warns which was skipped', async () => {
    const saved = await runSummaryRegeneration({
      Epi_1_Year: [recordInQ1.Epi_1_Year], Epi_2_Year: [recordInQ1.Epi_2_Year], Epi_3_Year: [recordInQ1.Epi_3_Year],
    });
    expect(savedScopes(saved)).toEqual([...allFiveRows('Epi_1_Year'), ...allFiveRows('Epi_2_Year'), ...allFiveRows('Epi_3_Year')]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith('ประมวลผลปีงบประมาณ 2569 แล้ว 3 กลุ่มอายุ · ข้ามเด็ก 5 ปี (ไม่มีข้อมูลปีนี้)');
  });

  it('a failure after some tables were written still refreshes the summary queries for what was written', async () => {
    const saved = stubApi({ Epi_1_Year: [recordInQ1.Epi_1_Year], Epi_2_Year: [recordInQ1.Epi_2_Year] });
    const fallback = api.fetchApi.getMockImplementation()!;
    api.fetchApi.mockImplementation(async (action: string, payload?: Record<string, unknown>) =>
      action === 'getVaccineRules' && payload?.ageGroup === '2yr' ? { data: { error: 'boom' } } : fallback(action, payload));
    const result = renderManager();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => { result.current.setFiscalYear('2569'); });
    await act(async () => { await result.current.handleSyncAll(); });
    expect(savedScopes(saved)).toEqual(allFiveRows('Epi_1_Year'));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboardSummaries'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboardSummaryYears'] });
  });

  it('names every skipped Age Group when more than one table is empty', async () => {
    const saved = await runSummaryRegeneration({ Epi_2_Year: [recordInQ1.Epi_2_Year] });
    expect(savedScopes(saved)).toEqual(allFiveRows('Epi_2_Year'));
    expect(toast.warning).toHaveBeenCalledWith('ประมวลผลปีงบประมาณ 2569 แล้ว 1 กลุ่มอายุ · ข้ามเด็ก 1 ปี, เด็ก 3 ปี, เด็ก 5 ปี (ไม่มีข้อมูลปีนี้)');
  });

  it('all four tables with data keep the plain success toast', async () => {
    const saved = await runSummaryRegeneration({
      Epi_1_Year: [recordInQ1.Epi_1_Year], Epi_2_Year: [recordInQ1.Epi_2_Year],
      Epi_3_Year: [recordInQ1.Epi_3_Year], Epi_5_Year: [recordInQ1.Epi_5_Year],
    });
    expect(saved).toHaveLength(20);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an empty quarter inside a table with Active Records is still saved as a real 0', async () => {
    const saved = await runSummaryRegeneration({ Epi_1_Year: [recordInQ1.Epi_1_Year] });
    const q2 = saved.find(call => call.targetTable === 'Epi_1_Year' && call.quarter === 2);
    expect(q2, 'Q2 has no births but the table has Active Records').toBeTruthy();
    expect(JSON.parse(q2!.summaryData).total).toBe(0);
  });

  it('an empty annual birth cohort inside a table with Active Records is still saved', async () => {
    // Active for FY2569 but born outside the FY2569 age-1 birth range (2024-10-01..2025-09-30).
    const outsideCohort = { ...recordInQ1.Epi_1_Year, birth: '2023-05-01' };
    const saved = await runSummaryRegeneration({ Epi_1_Year: [outsideCohort] });
    expect(savedScopes(saved)).toEqual(allFiveRows('Epi_1_Year'));
    expect(JSON.parse(saved[0].summaryData).total).toBe(0);
  });
});

describe('Issue #134 — the summary step after an Import follows the same rule', () => {
  async function runImport(activeRecords: Partial<Record<Table, Record<string, unknown>[]>>) {
    const saved = stubApi(activeRecords);
    const rows = [{ hoscode: '00001', pid: '1', cid: '0000000000001', sex: '1', birth: '2024-11-15', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ' }];
    parser.parseHdcFile.mockResolvedValue({ rows, columns: Object.keys(rows[0]) });
    const result = renderManager();
    await act(async () => { result.current.setFiscalYear('2569'); result.current.setImportMode('sync'); });
    await act(async () => { await result.current.handleDrop([new File(['x'], 'EPI-1YEAR.xlsx')]); });
    await act(async () => { await result.current.handleUpload(); });
    await act(async () => { await result.current.confirmUpload(); });
    return { saved, result };
  }

  it('no Active Records left after a Full-File Sync: no summary is written, the import still succeeds with its counts', async () => {
    const { saved, result } = await runImport({});
    expect(saved).toEqual([]);
    expect(result.current.status).toBe('success');
    expect(result.current.results).toEqual({ inserted: 0, updated: 2, deactivated: 7 });
    expect(result.current.summarySkipped).toBe(true);
  });

  it('Active Records remain: the imported table gets `_all` + Q1–Q4 and no skip notice', async () => {
    const { saved, result } = await runImport({ Epi_1_Year: [recordInQ1.Epi_1_Year] });
    expect(savedScopes(saved)).toEqual(allFiveRows('Epi_1_Year'));
    expect(result.current.status).toBe('success');
    expect(result.current.summarySkipped).toBe(false);
  });
});
