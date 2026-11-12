// @vitest-environment jsdom
/**
 * Issue #134 (#115) — the upload page must make the Summary Regeneration scope visible before
 * anything is written, and must say when an import wrote no Dashboard Summary.
 * Issue #136 — the page preselects no Fiscal Year; nothing can start until the admin chooses one.
 *
 * Seam: the rendered page with the real `useUploadManager`; only external boundaries are mocked
 * (`fetchApi`, the file parser, `sonner`). All records are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadDashboard } from './UploadDashboard';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const parser = vi.hoisted(() => ({ parseHdcFile: vi.fn() }));
vi.mock('../../../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('../utils/parseHdcFile', () => ({ parseHdcFile: parser.parseHdcFile }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><UploadDashboard /></QueryClientProvider>);
}

beforeEach(() => { api.fetchApi.mockReset(); parser.parseHdcFile.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Issue #134 — Summary Regeneration confirmation', () => {
  it('the dialog title names the selected Fiscal Year and the description lists the four Age Groups', async () => {
    // Pin today (options 2567–2571); only Date is faked so the dialog's timers still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T09:00:00+07:00'));
    renderPage();
    // A year other than the current one, so the title is shown to follow the selector.
    fireEvent.change(screen.getByRole('combobox', { name: 'ปีงบประมาณ' }), { target: { value: '2569' } });

    fireEvent.click(screen.getByRole('button', { name: 'ประมวลผล Dashboard ใหม่ทั้งหมด' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'ประมวลผล Dashboard ใหม่ · ปีงบประมาณ 2569' })).toBeTruthy();
    const description = within(dialog).getByText(/กลุ่มอายุ/);
    for (const label of ['เด็ก 1 ปี', 'เด็ก 2 ปี', 'เด็ก 3 ปี', 'เด็ก 5 ปี']) expect(description.textContent).toContain(label);
    expect(api.fetchApi).not.toHaveBeenCalledWith('saveDashboardSummary', expect.anything());
  });

  it('the advanced-tool heading says Summary Regeneration, not Sync Summaries', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /ประมวลผล Dashboard ใหม่ \(Summary Regeneration\)/ })).toBeTruthy();
    expect(screen.queryByText(/Sync Summaries/)).toBeNull();
  });
});

describe('Issue #134 — import result when no summary was created', () => {
  it('a successful import whose table has no Active Records left says no summary was created', async () => {
    const rows = [{ hoscode: '00001', pid: '1', cid: '0000000000001', sex: '1', birth: '2024-11-15', check_vhid: '00000101', name: 'สมมติ', lname: 'ทดสอบ' }];
    parser.parseHdcFile.mockResolvedValue({ rows, columns: Object.keys(rows[0]) });
    api.fetchApi.mockImplementation(async (action: string) => {
      if (action === 'preflightEpiImport') return { data: {
        success: true, batchId: 'server-echo', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
        matched: 1, newRows: 0, wouldDeactivate: 0, activeBefore: 1, outsideCohort: 0,
        byHoscode: [{ hoscode: '00001', activeBefore: 1, matched: 1, newRows: 0, wouldDeactivate: 0, outsideCohort: 0 }],
        risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohortBirthRange: false },
        cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: null,
        requiredConfirmations: null, shrinkThreshold: 0.2,
      } };
      if (action === 'upsertEpiData') return { data: { success: true, inserted: 0, updated: 1, finalized: true, deactivated: 0 } }; // Issue #144: the last chunk finalizes
      if (action === 'getEpiData') return { data: [] };
      return { data: { success: true } };
    });
    const { container } = renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'ปีงบประมาณ' }), { target: { value: '2569' } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'EPI-1YEAR.json', { type: 'application/json' })] } });
    fireEvent.click(await screen.findByRole('button', { name: /ตรวจสอบก่อนนำเข้า/ }));
    fireEvent.click(await screen.findByRole('button', { name: /ยืนยันนำเข้า/ }));

    await screen.findByText('นำเข้าข้อมูลสำเร็จ');
    expect(screen.getByText('ไม่ได้สร้างสรุปเพราะไม่มีรายการที่เปิดใช้งาน')).toBeTruthy();
    await waitFor(() => expect(api.fetchApi).not.toHaveBeenCalledWith('saveDashboardSummary', expect.anything()));
  });
});

describe('Issue #136 — no default Fiscal Year on the upload page', () => {
  const chooseFile = (container: HTMLElement) => fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement,
    { target: { files: [new File(['x'], 'EPI-1YEAR.json', { type: 'application/json' })] } });

  it('starts with no Fiscal Year selected', () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: 'ปีงบประมาณ' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.selectedOptions[0].textContent).toBe('เลือกปีงบประมาณ');
  });

  it('accepts no file and offers no Summary Regeneration until a year is chosen', async () => {
    parser.parseHdcFile.mockResolvedValue({ rows: [], columns: [] });
    const { container } = renderPage();
    const regenerate = screen.getByRole('button', { name: 'ประมวลผล Dashboard ใหม่ทั้งหมด' }) as HTMLButtonElement;
    expect(regenerate.disabled).toBe(true);
    chooseFile(container);
    expect(parser.parseHdcFile).not.toHaveBeenCalled();
    expect(screen.getByText('เลือกปีงบประมาณก่อนอัปโหลดไฟล์')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'ปีงบประมาณ' }), { target: { value: '2569' } });
    expect(regenerate.disabled).toBe(false);
    chooseFile(container);
    await waitFor(() => expect(parser.parseHdcFile).toHaveBeenCalledTimes(1));
  });
});

describe('Issue #139 — Import Undo section', () => {
  it('has its own table and year with no defaults, previews once both are chosen and confirms with one click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T09:00:00+07:00'));
    api.fetchApi.mockImplementation(async (action: string) => {
      if (action === 'previewEpiImportUndo') return { data: { success: true, eligible: true, batchId: 'b1', targetTable: 'Epi_2_Year', fiscalYear: '2569',
        mode: 'merge', importedAt: '2026-11-11T03:00:00.000Z', importedBy: 'admin@example.test', wouldDeactivate: 4, wouldReactivate: 0,
        activeAfter: 0, summariesWillBeRemoved: true, byHoscode: [{ hoscode: '00001', wouldDeactivate: 4, wouldReactivate: 0 }] } };
      if (action === 'undoEpiImport') return { data: { success: true, deactivated: 4, reactivated: 0, summariesRemoved: true } };
      return { data: { success: true } };
    });
    renderPage();
    const table = screen.getByRole('combobox', { name: 'กลุ่มอายุที่จะย้อนการนำเข้า' }) as HTMLSelectElement;
    const year = screen.getByRole('combobox', { name: 'ปีงบประมาณที่จะย้อนการนำเข้า' }) as HTMLSelectElement;
    expect([table.value, year.value]).toEqual(['', '']);
    fireEvent.change(table, { target: { value: 'Epi_2_Year' } });
    fireEvent.change(year, { target: { value: '2569' } });
    expect(await screen.findByRole('heading', { name: /เด็ก 2 ปี.*ปีงบประมาณ 2569/ })).toBeTruthy();
    expect(api.fetchApi).toHaveBeenCalledWith('previewEpiImportUndo', { targetTable: 'Epi_2_Year', fiscalYear: '2569' });
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันย้อนการนำเข้า/ }));
    expect(await screen.findByText(/ย้อนการนำเข้าล่าสุดของเด็ก 2 ปี ปีงบประมาณ 2569 แล้ว/)).toBeTruthy();
    expect(api.fetchApi).toHaveBeenCalledWith('undoEpiImport', { batchId: 'b1', expected: { wouldDeactivate: 4, wouldReactivate: 0 } });
    await waitFor(() => expect(api.fetchApi).not.toHaveBeenCalledWith('saveDashboardSummary', expect.anything()));
  });
});
