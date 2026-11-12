// @vitest-environment jsdom
/**
 * Issue #111 — the preflight summary must make the scope unmistakable and gate a risky import
 * behind typing the exact number. Issue #136 — births outside the Cohort Birth Range are a risk
 * condition of their own, with its own typed number. Seam: the rendered panel. Synthetic counts only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportPreflightPanel } from './ImportPreflightPanel';
import type { ImportPreflight } from '../hooks/useUploadManager';

const risky: ImportPreflight = {
  batchId: 'b1', targetTable: 'Epi_1_Year', fiscalYear: '2569', mode: 'sync',
  matched: 0, newRows: 143, wouldDeactivate: 181, activeBefore: 181, outsideCohort: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 181, matched: 0, newRows: 143, wouldDeactivate: 181, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true, outsideCohort: false },
  cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: null,
  requiredConfirmations: { existingChildren: 181 }, shrinkThreshold: 0.2,
};
const safe: ImportPreflight = { ...risky, matched: 181, newRows: 0, wouldDeactivate: 0,
  byHoscode: [{ hoscode: '00001', activeBefore: 181, matched: 181, newRows: 0, wouldDeactivate: 0, outsideCohort: 0 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohort: false }, requiredConfirmations: null };
/** The #136 incident: FY2569 2-year births synced into an empty FY2570. */
const wrongYear: ImportPreflight = { ...safe, targetTable: 'Epi_2_Year', fiscalYear: '2570', matched: 0, newRows: 203, activeBefore: 0,
  outsideCohort: 203, cohortBirthRange: { start: '2024-10-01', end: '2025-09-30' }, outsideCohortFiscalYear: '2569',
  byHoscode: [{ hoscode: '00001', activeBefore: 0, matched: 0, newRows: 200, wouldDeactivate: 0, outsideCohort: 200 },
    { hoscode: '00002', activeBefore: 0, matched: 0, newRows: 3, wouldDeactivate: 0, outsideCohort: 3 }],
  risk: { zeroMatchHoscodes: [], shrinkOverThreshold: false, outsideCohort: true }, requiredConfirmations: { outsideCohort: 203 } };
/** A sync that shrinks the existing children and also carries 2 out-of-range births. */
const twoRisks: ImportPreflight = { ...risky, outsideCohort: 2, outsideCohortFiscalYear: '2568',
  byHoscode: [{ hoscode: '00001', activeBefore: 181, matched: 0, newRows: 143, wouldDeactivate: 181, outsideCohort: 2 }],
  risk: { zeroMatchHoscodes: ['00001'], shrinkOverThreshold: true, outsideCohort: true },
  requiredConfirmations: { existingChildren: 181, outsideCohort: 2 } };

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
    const input = screen.getByLabelText(/พิมพ์ตัวเลข 181/);
    const confirm = screen.getByRole('button', { name: /ยืนยันนำเข้า/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '180' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '181' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ existingChildren: '181' });
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

describe('Issue #136 — births outside the Cohort Birth Range', () => {
  it('names the count, the range and the year the births match, and asks for the out-of-range count', () => {
    const onConfirm = vi.fn();
    render(<ImportPreflightPanel preflight={wrongYear} isBusy={false} errorMsg="" onConfirm={onConfirm} onCancel={vi.fn()} />);
    const warning = screen.getByText(/เกิดนอกช่วงวันเกิดของ/);
    expect(warning.textContent).toMatch(/203 รายชื่อ/);
    expect(warning.textContent).toMatch(/เด็ก 2 ปี ปีงบประมาณ 2570/);
    expect(warning.textContent).toMatch(/1 ต\.ค\. 2567.*30 ก\.ย\. 2568/);
    expect(screen.getByText(/วันเกิดตรงกับปีงบประมาณ 2569/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /ยืนยันนำเข้า/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/พิมพ์ตัวเลข 203/), { target: { value: '203' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ outsideCohort: '203' });
  });

  it('names no year when the out-of-range births match more than one', () => {
    render(<ImportPreflightPanel preflight={{ ...wrongYear, outsideCohortFiscalYear: null }} isBusy={false} errorMsg="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/เกิดนอกช่วงวันเกิดของ/)).toBeTruthy();
    expect(screen.queryByText(/วันเกิดตรงกับปีงบประมาณ/)).toBeNull();
  });

  it('shows the out-of-range count of each facility only when some row is out of range', () => {
    render(<ImportPreflightPanel preflight={wrongYear} isBusy={false} errorMsg="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: 'นอกช่วงวันเกิด' })).toBeTruthy();
    const row = screen.getByRole('cell', { name: '00002' }).closest('tr') as HTMLTableRowElement;
    expect(row.lastElementChild?.textContent).toBe('3');
    cleanup();
    render(<ImportPreflightPanel preflight={safe} isBusy={false} errorMsg="" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: 'นอกช่วงวันเกิด' })).toBeNull();
  });

  it('two risk conditions need both numbers before the import can be confirmed', () => {
    const onConfirm = vi.fn();
    render(<ImportPreflightPanel preflight={twoRisks} isBusy={false} errorMsg="" onConfirm={onConfirm} onCancel={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: /ยืนยันนำเข้า/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/พิมพ์ตัวเลข 181/), { target: { value: '181' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/พิมพ์ตัวเลข 2 /), { target: { value: '2' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ existingChildren: '181', outsideCohort: '2' });
  });
});
