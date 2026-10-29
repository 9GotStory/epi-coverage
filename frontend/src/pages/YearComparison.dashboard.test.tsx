// @vitest-environment jsdom
/**
 * Ticket #50 — route-level four-age/year Dashboard tests.
 * Public seam: actual YearComparison, network-mocked annual summary APIs and
 * real user interactions. Fixtures are synthetic, aggregate, and non-identifying.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { YearComparison } from './YearComparison';
import type { DashboardSummaryRow, EpiTargetTable } from '../shared/types/dashboardSummary';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const charts = vi.hoisted(() => ({
  rendered: [] as Array<Array<{ fiscalYear: string; coverage: number | null; target: number | null }>>,
}));

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => undefined;
HTMLElement.prototype.releasePointerCapture ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;
window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;

vi.mock('../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('recharts', () => {
  const stub = () => null;
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    __esModule: true,
    ResponsiveContainer: passthrough,
    ComposedChart: ({ data, children }: {
      data: Array<{ fiscalYear: string; coverage: number | null; target: number | null }>;
      children?: ReactNode;
    }) => { charts.rendered.push(data); return children ?? null; },
    LineChart: stub, BarChart: stub, Line: stub, Bar: stub, XAxis: stub, YAxis: stub,
    CartesianGrid: stub, Tooltip: stub, Legend: stub, ReferenceLine: stub,
    ReferenceDot: stub, AreaChart: stub, Area: stub, Cell: stub, LabelList: stub,
    PieChart: stub, Pie: stub, ScatterChart: stub, Scatter: stub,
  };
});

const groups: EpiTargetTable[] = ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];
function annual(targetTable: EpiTargetTable, fiscalYear: number, coverage = 70): DashboardSummaryRow {
  return {
    id: `${targetTable}_${fiscalYear}_all`,
    targetTable,
    fiscalYear,
    updated_at: '2026-09-23T12:22:00.000Z',
    summaryData: {
      total: 100,
      view1Coverage: coverage + 5, view1PassedDoses: 75, view1TotalDoses: 100,
      view2Coverage: coverage, view2Passed: 70, view2ApplicableTotal: 100, view2PendingCount: 0,
      view1Breakdown: [], view2Breakdown: [],
      facilityBreakdownV1: [], facilityBreakdownV2: [],
    },
  };
}
const rows = [
  annual('Epi_1_Year', 2568, 80),
  annual('Epi_1_Year', 2569, 85),
  annual('Epi_2_Year', 2569, 62),
  annual('Epi_3_Year', 2567, 73),
  annual('Epi_3_Year', 2569, 64),
  annual('Epi_5_Year', 2569, 97),
];
const yearsByTable: Record<string, number[]> = {
  Epi_1_Year: [2568, 2569],
  Epi_2_Year: [2569],
  Epi_3_Year: [2567, 2569],
  Epi_5_Year: [2569],
};

function mount({
  years = yearsByTable,
  summaries = rows,
  failure = null,
}: {
  years?: Record<string, number[]>;
  summaries?: DashboardSummaryRow[];
  failure?: 'years' | 'summaries' | null;
} = {}) {
  api.fetchApi.mockImplementation(async (action: string, payload?: { fiscalYears?: number[] }) => {
    if (action === 'getDashboardSummaryYears') {
      if (failure === 'years') throw new Error('Year API unavailable');
      return { data: { success: true, tables: years } };
    }
    if (action === 'getDashboardSummariesMultiYear') {
      if (failure === 'summaries') throw new Error('Summary API unavailable');
      return { data: { success: true, summaries: summaries.filter(r => (payload?.fiscalYears ?? []).includes(r.fiscalYear)) } };
    }
    if (action === 'getTargetConfig') {
      return { data: { target_view1_q4_2568: 89, target_view1_q4_2569: 91, target_view2_q4_2569: 90 } };
    }
    return { data: {} };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><YearComparison /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const annualRequests = () => api.fetchApi.mock.calls
  .filter(call => call[0] === 'getDashboardSummariesMultiYear')
  .map(call => (call[1] as { fiscalYears: number[] }).fiscalYears);

beforeEach(() => { api.fetchApi.mockReset(); charts.rendered.length = 0; });
afterEach(() => cleanup());

describe('#50 — actual /dashboard/comparison: four-age annual overview', () => {
  it('D01 renders all four ages with two View 1/View 2 charts each; same selected FYs on every age', async () => {
    mount();
    await screen.findByRole('heading', { name: 'เด็กอายุ 5 ปี' });
    await waitFor(() => expect(charts.rendered.length).toBeGreaterThanOrEqual(8));
    for (const age of ['1','2','3','5']) {
      const ageSection = screen.getByRole('region', { name: `เด็กอายุ ${age} ปี` });
      expect(within(ageSection).getByText('มุมมองที่ 1 (รายชนิดวัคซีน)')).toBeTruthy();
      expect(within(ageSection).getByText('มุมมองที่ 2 (Fully Immunized)')).toBeTruthy();
    }
    expect(annualRequests()).toContainEqual([2568, 2569]);
    expect(charts.rendered.some(chart => chart.some(point => point.fiscalYear === '2568' && point.coverage === null))).toBe(true);
    expect(document.body.textContent).toContain('ไม่มีข้อมูลสรุป');
  });

  it('D02 global FY options use the union, including age-3-only year 2567; no clock phantom years', async () => {
    mount();
    const FY2567 = await screen.findByRole('button', { name: 'ปี 2567' });
    const FY2568 = screen.getByRole('button', { name: 'ปี 2568' });
    expect(FY2567.getAttribute('aria-pressed')).toBe('false');
    expect(FY2568.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(FY2567);
    await waitFor(() => expect(annualRequests()).toContainEqual([2567, 2568, 2569]));
    expect(screen.getByRole('button', { name: 'ปี 2569' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('D03 one year uses real values and never invents a second FY or delta', async () => {
    mount({ years: Object.fromEntries(groups.map(group => [group, [2569]])), summaries: groups.map(group => annual(group, 2569)) });
    await screen.findByRole('heading', { name: 'เด็กอายุ 3 ปี' });
    await waitFor(() => expect(annualRequests()).toContainEqual([2569]));
    expect(screen.queryByRole('button', { name: 'ปี 2568' })).toBeNull();
    expect(screen.getAllByText('ยังไม่มีปีงบประมาณอื่นสำหรับเปรียบเทียบ').length).toBeGreaterThanOrEqual(8);
  });

  it('D04 five-year cap, deselect-all and no empty-year API request', async () => {
    mount({ years: Object.fromEntries(groups.map(group => [group, [2563,2564,2565,2566,2567,2568,2569]])) });
    await screen.findByRole('button', { name: 'ปี 2563' });
    for(const year of [2563,2564,2565]) fireEvent.click(screen.getByRole('button', { name: `ปี ${year}` }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ปี 2566' }).hasAttribute('disabled')).toBe(true));
    expect(annualRequests().every(years => years.length > 0 && years.length <= 5)).toBe(true);
    const selected = [...screen.getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true')];
    expect(selected).toHaveLength(5);
    for(const button of selected) fireEvent.click(button);
    await screen.findByText('กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล');
    expect(annualRequests().every(years => years.length > 0)).toBe(true);
  });

  it('D05 deep-dive remains secondary, exact facility ID is scoped to chosen age with global FYs', async () => {
    const withFacility = rows.map(row => ({
      ...row, summaryData: {
        ...row.summaryData,
        facilityBreakdownV2: [
          { hoscode: row.targetTable === 'Epi_2_Year' ? '99999' : '06413',
            hosname: 'หน่วยบริการสังเคราะห์', total: 10, passed: 8, coverage: 80 },
        ],
      },
    }));
    mount({ summaries: withFacility });
    await screen.findByRole('heading', { name: 'เด็กอายุ 5 ปี' });
    expect(screen.queryByRole('button', { name: /เลือกหน่วยบริการ 99999/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'เจาะลึกผลการดำเนินงานรายปีงบประมาณ' }));
    const panel = screen.getByRole('region', { name: 'ส่วนเจาะลึกผลการดำเนินงาน' });
    fireEvent.click(within(panel).getByRole('button', { name: 'View 2 — รายคน' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'เด็กอายุ 2 ปี' }));
    expect(within(panel).getByRole('button', { name: 'เลือกหน่วยบริการ 99999 หน่วยบริการสังเคราะห์' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /เลือกหน่วยบริการ 06413/ })).toBeNull();
    expect(annualRequests()).toContainEqual([2568, 2569]);
  });

  it('D06 errors from annual-year discovery or summaries are not shown as successful empty data', async () => {
    const first = mount({ failure: 'years' });
    await screen.findByText('ไม่สามารถดึงข้อมูลปีงบประมาณที่มีข้อมูลสรุปได้');
    expect(annualRequests()).toHaveLength(0);
    first.unmount(); cleanup(); api.fetchApi.mockReset(); charts.rendered.length = 0;
    mount({ failure: 'summaries' });
    await screen.findByText('ไม่สามารถดึงข้อมูลสรุปได้');
    expect(document.body.textContent).not.toContain('80.00%');
  });
});
