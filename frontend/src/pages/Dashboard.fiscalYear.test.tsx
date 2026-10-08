/** @vitest-environment jsdom */
/**
 * Dashboard fiscal-year selector / missing-summary regression contracts.
 * Only synthetic, aggregate records; no production healthcare data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import type { DashboardSummaryRow } from '../shared/types/dashboardSummary';

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('Unexpected network call in Dashboard contract test');
  }),
}));

// Keep the real Dashboard wired while substituting native selects for Radix's
// browser-specific popover interactions in this state/contract test.
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
  Epi_1_Year: [2568, 2569],
  Epi_2_Year: [2569],
  Epi_3_Year: [2569],
  Epi_5_Year: [2569],
  unrelated_table: [3000],
};

function renderDashboard(
  tables: Record<string, number[]>,
  summaries: Record<string, DashboardSummaryRow[]> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['dashboardSummaryYears'], tables);
  client.setQueryData(['targetConfig'], {
    target_view2_q4_2568: 81,
    target_view2_q4_2569: 91,
  });
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
  it('defaults to the latest year with an actual usable summary rather than the browser year or unrelated tables', () => {
    renderDashboard(yearTables, {
      '2569:all': [makeRow('Epi_1_Year', 2569, 19), makeRow('Epi_2_Year', 2569, 28)],
      '2568:all': [makeRow('Epi_1_Year', 2568, 8)],
    });
    const [yearSelect] = screen.getAllByRole('combobox');
    expect(yearSelect).toHaveValue('2569');
    expect(within(screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!).getAllByText('19').length).toBeTruthy();
    expect(screen.getByText(/ภาพรวมผลการดำเนินงานสร้างเสริมภูมิคุ้มกันโรค ปีงบประมาณ 2569/)).toBeTruthy();
    expect(within(yearSelect).queryByRole('option', { name: /3000/ })).toBeNull();
  });

  it('switches annual snapshots, year-specific targets and resets the quarter to all', () => {
    renderDashboard(yearTables, {
      '2569:all': [makeRow('Epi_1_Year', 2569, 19)],
      '2568:all': [makeRow('Epi_1_Year', 2568, 8)],
      '2569:2': [makeRow('Epi_1_Year', 2569, 2)],
    });
    const [yearSelect, quarterSelect] = screen.getAllByRole('combobox');
    expect(screen.getByText('เป้าหมาย: ≥ 91%')).toBeTruthy();
    fireEvent.change(quarterSelect, { target: { value: '2' } });
    expect(quarterSelect).toHaveValue('2');
    fireEvent.change(yearSelect, { target: { value: '2568' } });
    expect(yearSelect).toHaveValue('2568');
    expect(quarterSelect).toHaveValue('all');
    const section = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    expect(within(section).getAllByText('8').length).toBeGreaterThan(0);
    expect(within(section).getByText('เป้าหมาย: ≥ 81%')).toBeTruthy();
  });

  it('distinguishes a missing group/year snapshot from a genuine 0% stored value', () => {
    renderDashboard(yearTables, {
      '2569:all': [makeRow('Epi_1_Year', 2569, 10, 0)],
    });
    const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
    const age2 = screen.getByText('ภาพรวมเด็กอายุครบ 2 ปี').closest('section')!;
    expect(within(age1).getAllByText('0.00').length).toBeGreaterThan(0);
    expect(within(age2).getByText(/ไม่มีข้อมูลสรุปสำหรับปีงบประมาณ 2569/)).toBeTruthy();
    expect(within(age2).queryByText('0.00')).toBeNull();
  });

  it('shows an empty-state message rather than fabricating zero summaries if no fiscal year is usable', () => {
    renderDashboard({});
    expect(screen.getByText(/ยังไม่มีข้อมูลสรุปสำหรับปีงบประมาณใด/)).toBeTruthy();
    expect(screen.queryByText('ภาพรวมเด็กอายุครบ 1 ปี')).toBeNull();
  });
});
