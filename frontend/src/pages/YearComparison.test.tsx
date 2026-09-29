/**
 * Issue #22 RED contracts — honest no-data on the Comparison page (frontend seam).
 *
 * Observable contract (Issue #22 / docs/specs/comparison-page-improvement.md §12):
 *   - C1: a selected fiscal year with NO usable annual summary must not be
 *     represented as coverage 0 / zero totals in the data handed to the chart
 *     surface, and the page must expose an honest no-data state (ไม่มีข้อมูลสรุป).
 *   - C2 (preservation): a real summary with view2Coverage 0 is a legitimate
 *     0% value — it must still produce its chart point and must NOT be treated
 *     as missing.
 *
 * The seam under test is the `data` prop the page passes to its chart surface
 * plus the rendered markup — behavior, not private implementation. Ticket #22
 * boundary: no KPI/trend/composition redesign assertions here (Ticket #24).
 *
 * All data is synthetic aggregate summary material.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { YearComparisonDetail as YearComparison } from './YearComparison';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';

// Capture the chart data at the rendered comparison surface (recharts mock).
const chart = vi.hoisted(() => ({ data: undefined as Array<Record<string, unknown>> | undefined }));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  BarChart: (props: { data?: Array<Record<string, unknown>> }) => {
    chart.data = props.data;
    return null;
  },
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('network is disabled in YearComparison contract tests');
  }),
}));

const currentYear = getCurrentFiscalYear();
const previousYear = currentYear - 1;

/** A synthetic, structurally valid multi-year summary row. */
function makeSummary(fiscalYear: number, payload: Record<string, unknown>) {
  return {
    id: `Epi_1_Year_${fiscalYear}_all`,
    targetTable: 'Epi_1_Year',
    fiscalYear,
    summaryData: payload,
    updated_at: '2026-08-01T10:00:00.000Z',
  };
}

function renderComparison(summaries: ReturnType<typeof makeSummary>[]) {
  const client = new QueryClient();
  // Default page selection is [currentFY-1, currentFY]; seed exactly that query key.
  client.setQueryData(['dashboardSummariesMultiYear', [previousYear, currentYear]], summaries);
  client.setQueryData(['availableYears'], [currentYear, previousYear]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <YearComparison />
    </QueryClientProvider>,
  );
  return { html, chartData: chart.data };
}

const isExplicitZero = (value: unknown) => value === 0 || value === '0' || value === '0.00';

describe('YearComparison honest no-data vs real zero (Issue #22)', () => {
  it('C1: a selected FY without an annual summary is never rendered as fabricated 0% / zero counts and shows ไม่มีข้อมูลสรุป', () => {
    // previousYear has a real summary; currentYear has none at all.
    const { html, chartData } = renderComparison([
      makeSummary(previousYear, { total: 10, view2Coverage: 55.5, view2Passed: 5 }),
    ]);

    expect(chartData, 'chart surface must receive data for the selected years').toBeDefined();

    const missingEntry = chartData!.find((d) => d.name === `ปี ${currentYear}`);
    const fabricatedZero =
      missingEntry !== undefined && isExplicitZero(missingEntry.percentV2) && isExplicitZero(missingEntry.total);
    // Future contract: a missing summary is not a 0%/0-count chart point — it is
    // either omitted or represented as no-data, never as numeric zero coverage.
    expect(fabricatedZero, `FY ${currentYear} has no summary and must not be charted as 0% / 0 children`).toBe(false);

    // Future contract: an honest no-data state is exposed for the missing year.
    expect(html).toContain('ไม่มีข้อมูลสรุป');
  });

  it('C2 (preservation): a real view2Coverage of 0 stays a legitimate 0% chart point and is not treated as missing', () => {
    const { html, chartData } = renderComparison([
      makeSummary(previousYear, { total: 12, view2Coverage: 41.7, view2Passed: 5 }),
      makeSummary(currentYear, { total: 8, view2Coverage: 0, view2Passed: 0 }),
    ]);

    expect(chartData).toBeDefined();
    const zeroEntry = chartData!.find((d) => d.name === `ปี ${currentYear}`);
    expect(zeroEntry, 'a real-zero summary year must keep its chart point').toBeDefined();
    expect(Number(zeroEntry!.percentV2)).toBe(0);
    expect(Number(zeroEntry!.total)).toBe(8);
    expect(html).not.toContain('ไม่มีข้อมูลสรุป');
  });
});
