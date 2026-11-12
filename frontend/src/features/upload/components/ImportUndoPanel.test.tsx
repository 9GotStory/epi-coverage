// @vitest-environment jsdom
/**
 * Issue #139 (#112) — the Import Undo preview must make the scope unmistakable, show the effect per facility,
 * and explain every refusal with its recovery. Seam: the rendered panel. Synthetic counts only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportUndoPanel } from './ImportUndoPanel';
import type { ImportUndoPreview, UndoRefusalReason } from '../hooks/useUploadManager';

const eligible: ImportUndoPreview = {
  eligible: true, batchId: 'wrong-file', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  importedAt: '2026-11-11T03:00:00.000Z', importedBy: 'admin@example.test',
  wouldDeactivate: 143, wouldReactivate: 181, activeAfter: 181, summariesWillBeRemoved: false,
  byHoscode: [{ hoscode: '00001', wouldDeactivate: 140, wouldReactivate: 181 }, { hoscode: '00002', wouldDeactivate: 3, wouldReactivate: 0 }],
};
const refused = (reason: Exclude<UndoRefusalReason, 'stale'>): ImportUndoPreview =>
  ({ eligible: false, reason, targetTable: 'Epi_2_Year', fiscalYear: '2570', batchId: 'b1', mode: 'merge', importedAt: null, importedBy: null });

const renderPanel = (preview: ImportUndoPreview, handlers = { onConfirm: vi.fn(), onCancel: vi.fn() }) =>
  render(<ImportUndoPanel preview={preview} isBusy={false} errorMsg="" {...handlers} />);

afterEach(() => { cleanup(); });

describe('Issue #139 — ImportUndoPanel', () => {
  it('states the table and Fiscal Year prominently, with who imported, when and in which mode', () => {
    renderPanel(eligible);
    expect(screen.getByRole('heading', { name: /เด็ก 1 ปี.*ปีงบประมาณ 2569/ })).toBeTruthy();
    expect(screen.getByText(/admin@example\.test/)).toBeTruthy();
    expect(screen.getByText(/ซิงค์ไฟล์เต็ม/)).toBeTruthy();
    expect(screen.getByText(/11\/11\/2569|2569-11-11|11 พ\.ย\./)).toBeTruthy();
  });

  it('shows how many rows each facility would deactivate and reactivate', () => {
    renderPanel(eligible);
    const row = screen.getByRole('cell', { name: '00002' }).closest('tr')!;
    expect(row.textContent).toContain('3');
    expect(screen.getByRole('cell', { name: '00001' }).closest('tr')!.textContent).toMatch(/140.*181/);
  });

  it('warns that the Dashboard Summaries will be removed when no Active Records remain', () => {
    renderPanel({ ...eligible, activeAfter: 0, wouldReactivate: 0, summariesWillBeRemoved: true });
    expect(screen.getByText(/ไม่มีข้อมูลสรุป/)).toBeTruthy();
  });

  it('says nothing about removed summaries when Active Records remain', () => {
    renderPanel(eligible);
    expect(screen.queryByText(/ไม่มีข้อมูลสรุป/)).toBeNull();
  });

  it('confirms with one click and cancels without confirming', () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    renderPanel(eligible, { onConfirm, onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันย้อนการนำเข้า/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('explains each refusal in Thai and names the recovery where one exists, with no confirm button', () => {
    const expected: Array<[Exclude<UndoRefusalReason, 'stale'>, RegExp, boolean]> = [
      ['no_batch', /ยังไม่มีการนำเข้า/, false],
      ['in_progress', /ยังอัปโหลดไม่เสร็จ/, true],
      ['already_undone', /ถูกย้อนไปแล้ว/, true],
      ['not_recorded', /ก่อนมีระบบย้อนการนำเข้า/, true],
      ['updated_existing', /อัปเดตข้อมูลเด็กที่มีอยู่แล้ว/, true],
      ['newer_import', /การนำเข้าที่ใหม่กว่า/, true],
    ];
    for (const [reason, text, hasRecovery] of expected) {
      renderPanel(refused(reason));
      expect(screen.getByRole('heading', { name: /เด็ก 2 ปี.*ปีงบประมาณ 2570/ })).toBeTruthy();
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryAllByText(/นำเข้าไฟล์ที่ถูกต้องอีกครั้ง/).length > 0).toBe(hasRecovery);
      expect(screen.queryByRole('button', { name: /ยืนยันย้อนการนำเข้า/ })).toBeNull();
      cleanup();
    }
  });
});
