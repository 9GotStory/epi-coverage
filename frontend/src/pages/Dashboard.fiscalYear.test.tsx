/** @vitest-environment jsdom */
/**
 * Dashboard FY selection, missing-summary, and real-zero regression contracts.
 * Only synthetic, aggregate fixtures. The current fiscal year comes from the
 * application's clock authority, not from the latest available annual snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryRow } from '../shared/types/dashboardSummary';

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('Unexpected network call in Dashboard contract test');
  }),
}));

// Exercise real Dashboard state + QueryClient; native selects simplify Radix popover interactions.
vi.mock('../shared/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: {
    value?: string; onValueChange?: (value: string) => void;
    children?: ReactNode; disabled?: boolean;
  }) => (
    <select value={value ?? ''} disabled={disabled} onChange={event => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const currentYear = getCurrentFiscalYear();
const previousYear = currentYear - 1;
const earlierYear = currentYear - 2;

const makeRow = (table: string, year: number, total: number, coverage = 60): DashboardSummaryRow => ({
  id: `${table}_${year}_all`,
  targetTable: table as DashboardSummaryRow['targetTable'],
  fiscalYear: year,
  updated_at: '2026-09-23T05:00:00.000Z',
  summaryData: {
    total,
    view1PassedDoses: total,
    view1TotalDoses: total,
    view1Coverage: coverage,
    view1Breakdown: [],
    view2Passed: coverage === 0 ? 0 : total,
    view2Coverage: coverage,
    view2Breakdown: [],
    facilityBreakdownV1: [],
    facilityBreakdownV2: [],
  },
});

const yearTables = {
  Epi_1_Year: [earlierYear, previousYear],
  Epi_2_Year: [previousYear],
  Epi_3_Year: [previousYear],
  Epi_5_Year: [previousYear],
  unrelated_table: [3000],
};

function renderDashboard(
  tables: Record<string, number[]>,
  summaries: Record<string, DashboardSummaryRow[]> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['dashboardSummaryYears'], tables);
  client.setQueryData(['targetConfig'], {
    [`target_view2_q4_${currentYear}`]: 93,
    [`target_view2_q4_${previousYear}`]: 91,
    [`target_view2_q4_${earlierYear}`]: 81,
  });
  // A resolved API read with no summary returns [] (not a query still loading).
  client.setQueryData(['dashboardSummaries', currentYear, 'all'], []);
  for (const [key, rows] of Object.entries(summaries)) {
    const [year, quarter] = key.split(':');
    client.setQueryData(['dashboardSummaries', Number(year), quarter], rows);
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('Dashboard fiscal-year selection', () => {
  it('defaults to the current fiscal year even when only historical summaries exist', () => {
    renderDashboard(yearTables, {
      [`${previousYear}:all`]: [makeRow('Epi_1_Year', previousYear, 19)],
    });
    const [yearSelect] = screen.getAllByRole('combobox');
    expect((yearSelect as HTMLSelectElement).value).toBe(String(currentYear));
    expect(screen.getByText(new RegExp(`สรุปผลการได้รับวัคซีน ปีงบประมาณ ${currentYear}`))).toBeTruthy();
    expect(within(yearSelect).getByRole('option', { name: String(currentYear) })).toBeTruthy();
    expect(within(yearSelect).getByRole('option', { name: String(previousYear) })).toBeTruthy();
    expect(within(yearSelect).queryByRole('option', { name: '3000' })).toBeNull();
    const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    expect(within(age1).getByText(`ยังไม่มีข้อมูลสรุปปีงบประมาณ ${currentYear}`)).toBeTruthy();
    expect(within(age1).queryByText('0.00')).toBeNull();
  });

  it('allows past-year selection, year-specific targets, quarter reset and return to current year', () => {
    renderDashboard(yearTables, {
      [`${currentYear}:all`]: [makeRow('Epi_1_Year', currentYear, 23)],
      [`${currentYear}:2`]: [makeRow('Epi_1_Year', currentYear, 2)],
      [`${previousYear}:all`]: [makeRow('Epi_1_Year', previousYear, 19)],
    });
    const [yearSelect, quarterSelect] = screen.getAllByRole('combobox');
    expect((yearSelect as HTMLSelectElement).value).toBe(String(currentYear));
    expect(screen.getByText('เป้าหมาย: 93% ขึ้นไป')).toBeTruthy();
    fireEvent.change(quarterSelect, { target: { value: '2' } });
    expect((quarterSelect as HTMLSelectElement).value).toBe('2');
    fireEvent.change(yearSelect, { target: { value: String(previousYear) } });
    expect((yearSelect as HTMLSelectElement).value).toBe(String(previousYear));
    expect((quarterSelect as HTMLSelectElement).value).toBe('all');
    const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    expect(within(age1).getAllByText('19').length).toBeGreaterThan(0);
    expect(within(age1).getByText('เป้าหมาย: 91% ขึ้นไป')).toBeTruthy();
    fireEvent.change(yearSelect, { target: { value: String(currentYear) } });
    expect((yearSelect as HTMLSelectElement).value).toBe(String(currentYear));
    expect(within(age1).getAllByText('23').length).toBeGreaterThan(0);
  });

  it('distinguishes missing summary from an actual stored zero in the current year', () => {
    renderDashboard(yearTables, {
      [`${currentYear}:all`]: [makeRow('Epi_1_Year', currentYear, 10, 0)],
    });
    const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    const age2 = screen.getByText('ภาพรวมเด็กอายุครบ 2 ปี').closest('section')!;
    expect(within(age1).getAllByText('0.00').length).toBeGreaterThan(0);
    expect(within(age2).getByText(`ยังไม่มีข้อมูลสรุปปีงบประมาณ ${currentYear}`)).toBeTruthy();
    expect(within(age2).queryByText('0.00')).toBeNull();
  });

  it('offers the current FY and a no-data state when no annual years exist', () => {
    renderDashboard({});
    const [yearSelect] = screen.getAllByRole('combobox');
    expect((yearSelect as HTMLSelectElement).value).toBe(String(currentYear));
    expect(within(yearSelect).getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByText(`ยังไม่มีข้อมูลสรุปปีงบประมาณ ${currentYear}`)).toHaveLength(4);
    expect(screen.queryByText('ยังไม่มีข้อมูลสรุปปีงบประมาณใด')).toBeNull();
  });

  it('reads a current-year snapshot even if it is absent from the annual-year options', () => {
    renderDashboard({}, {
      [`${currentYear}:all`]: [makeRow('Epi_1_Year', currentYear, 17)],
    });
    const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    expect(within(age1).getAllByText('17').length).toBeGreaterThan(0);
  });
});
