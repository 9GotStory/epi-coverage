// @vitest-environment jsdom
/**
 * Issue #111 — the preflight summary must make the scope unmistakable and gate a risky import
 * behind typing the exact number. Seam: the rendered panel. Synthetic counts only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportPreflightPanel } from './ImportPreflightPanel';
import type { ImportPreflight } from '../hooks/useUploadManager';

const risky: ImportPreflight = {
  batchId: 'b1', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 0, newRows: 143, wouldDeactivate: 181, activeBefore: 181,
  byHoscode: [{ hoscode: '00001', activeBefore: 181, matched: 0, newRows: 143, wouldDeactivate: 181 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true }, requiredConfirmation: 181, shrinkThreshold: 0.2,
};
const safe: ImportPreflight = { ...risky, matched: 181, newRows: 0, wouldDeactivate: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 181, matched: 181, newRows: 0, wouldDeactivate: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false }, requiredConfirmation: null };

afterEach(() => { cleanup(); });

describe('Issue #111 — ImportPreflightPanel', () => {
  it('states the target table and fiscal year prominently with the per-facility counts', () => {
    render(<ImportPreflightPanel preflight={safe} isBusy={false} errorMsg="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /เด็ก 1 ปี.*ปีงบประมาณ 2569/ })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '00001' })).toBeTruthy();
  });

  it('a risky import keeps the confirm button disabled until the exact number is typed', () => {
    const onConfirm = vi.fn();
    render(<ImportPreflightPanel preflight={risky} isBusy={false} errorMsg="" onConfirm={onConfirm} onCancel={vi.fn()} />);
    const input = screen.getByLabelText(/พิมพ์ตัวเลข/);
    const confirm = screen.getByRole('button', { name: /ยืนยันนำเข้า/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '180' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '181' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('181');
  });

  it('a safe import needs only the confirm click and offers no typed-number field', () => {
    const onConfirm = vi.fn();
    render(<ImportPreflightPanel preflight={safe} isBusy={false} errorMsg="" onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/พิมพ์ตัวเลข/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันนำเข้า/ }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('states the shrink threshold the server applied instead of a hardcoded one', () => {
    render(<ImportPreflightPanel preflight={{ ...risky, shrinkThreshold: 0.25 }} isBusy={false} errorMsg="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/เกิน 25%/)).toBeTruthy();
  });

  it('cancel calls back without confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ImportPreflightPanel preflight={risky} isBusy={false} errorMsg="" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
