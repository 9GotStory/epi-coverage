/**
 * Issue #24 RED contracts — Executive Year Comparison UX.
 *
 * Observable surface: the preserved `YearComparisonDetail` regression surface rendered with a seeded
 * QueryClient (repository SSR convention: `renderToStaticMarkup` + `setQueryData`)
 * and behavior-capturing recharts/SubNav/network mocks. No source-text assertions.
 *
 * Coverage vs harness capability (see gate §G): this repository has NO DOM test
 * environment (no jsdom/happy-dom/@testing-library in devDependencies or
 * node_modules; vitest runs in the default node environment and existing page
 * tests are SSR-only). Therefore:
 *   - RENDER-OBSERVABLE contracts are tested here (first render with cached data):
 *     SubNav grammar, LineChart trend, executive KPIs, target/gap, real zero,
 *     legacy degradation, composition numbers, detailed table, snapshot wording,
 *     API-error states, age-group chip isolation.
 *   - INTERACTION-LIFECYCLE contracts are declared TEST HARNESS BLOCKERS and are
 *     NOT faked: latest-2 default derivation (clock-independence), max-5 cap
 *     interaction, deselect-all interaction, age-group switch reset. Proving them
 *     requires executing state/effect lifecycles and DOM events.
 *
 * Fixture years deliberately coincide with the page's clock default
 * (`[currentFY-1, currentFY]`, computed via the same `getCurrentFiscalYear()` the
 * page uses) so the tests observe CONTENT contracts without prescribing how the
 * default selection is derived — the derivation contract itself is the blocked
 * interaction item, not these content assertions.
 *
 * All fixtures are synthetic aggregate summaries. No person-level data, real
 * identifiers, or secrets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { YearComparisonDetail as YearComparison } from './YearComparison';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryRow } from '../shared/types/dashboardSummary';

// --- behavior-capturing mocks -------------------------------------------------

/** Captured recharts usage: line-chart datasets, bar-chart datasets, Line dataKeys. */
const charts = vi.hoisted(() => ({ line: [] as Array<Array<Record<string, unknown>>>, bar: [] as Array<Array<Record<string, unknown>>>, lineKeys: [] as string[] }));

vi.mock('recharts', () => {
  const stub = () => null;
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    __esModule: true,
    ResponsiveContainer: passthrough,
    LineChart: (props: { data?: Array<Record<string, unknown>> }) => { charts.line.push(props.data ?? []); return null; },
    BarChart: (props: { data?: Array<Record<string, unknown>> }) => { charts.bar.push(props.data ?? []); return null; },
    Line: (props: { dataKey?: string | number }) => { charts.lineKeys.push(String(props.dataKey)); return null; },
    // Stubbed recharts exports (current + plausible #24 usage) so the page can compose freely.
    Bar: stub, XAxis: stub, YAxis: stub, CartesianGrid: stub, Tooltip: stub, Legend: stub,
    ReferenceLine: stub, ReferenceDot: stub, ComposedChart: stub, AreaChart: stub, Area: stub,
    Cell: stub, LabelList: stub, PieChart: stub, Pie: stub, ScatterChart: stub, Scatter: stub,
  };
});

vi.mock('../widgets/layout/SubNav', () => ({
  SubNav: ({ title }: { title?: string }) => <div data-subnav={title ?? ''}>{title}</div>,
}));

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('network is disabled in YearComparison executive tests');
  }),
}));

// --- fixtures -----------------------------------------------------------------

const currentYear = getCurrentFiscalYear();
const previousYear = currentYear - 1;

/** Current-contract synthetic summary (all values synthetic). */
const summary = (fiscalYear: number, s: Partial<DashboardSummaryRow['summaryData']>): DashboardSummaryRow => ({
  id: `Epi_1_Year_${fiscalYear}_all`,
  targetTable: 'Epi_1_Year',
  fiscalYear,
  updated_at: '2026-09-01T10:00:00.000Z',
  summaryData: {
    total: 0, view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 0,
    view1Breakdown: [], view2Breakdown: [], facilityBreakdownV1: [], facilityBreakdownV2: [],
    view2Coverage: 0, view2Passed: 0,
    view2ApplicableTotal: 0, view2PendingCount: 0,
    ...s,
  },
});

/**
 * Executive fixture pair — displayed coverage values are exactly derivable:
 *   previousYear: 893/1000  = 89.30%   (total 1010, applicable 1000, pending 10)
 *   currentYear:  231/250   = 92.40%   (total 260,  applicable 250,  pending 10)
 * delta = +3.10 pp; with a cur-year target of 90 the gap is +2.40 pp;
 * cur-year composition = passed 231 / failed 19 / pending 10 (sums to total 260).
 */
const executiveRows: DashboardSummaryRow[] = [
  summary(previousYear, { total: 1010, view2ApplicableTotal: 1000, view2Passed: 893, view2PendingCount: 10, view2Coverage: 89.3 }),
  summary(currentYear, { total: 260, view2ApplicableTotal: 250, view2Passed: 231, view2PendingCount: 10, view2Coverage: 92.4 }),
];

interface RenderOptions {
  rows?: DashboardSummaryRow[];
  yearsByTable?: Record<string, number[]>;
  targetConfig?: Record<string, number>;
  errorYears?: boolean;
  errorSummaries?: boolean;
}

async function renderComparison(options: RenderOptions = {}): Promise<string> {
  const { rows = executiveRows, yearsByTable = { Epi_1_Year: [previousYear, currentYear] }, targetConfig = {} } = options;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['dashboardSummariesMultiYear', [previousYear, currentYear]], rows);
  client.setQueryData(['dashboardSummaryYears'], yearsByTable);
  client.setQueryData(['targetConfig'], targetConfig);

  if (options.errorYears) {
    await client.fetchQuery({
      queryKey: ['dashboardSummaryYears'],
      queryFn: () => Promise.reject(new Error('ไม่สามารถดึงข้อมูลปีงบประมาณที่มีข้อมูลสรุปได้')),
    }).catch(() => undefined);
  }
  if (options.errorSummaries) {
    await client.fetchQuery({
      queryKey: ['dashboardSummariesMultiYear', [previousYear, currentYear]],
      queryFn: () => Promise.reject(new Error('ไม่สามารถดึงข้อมูลสรุปได้')),
    }).catch(() => undefined);
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <YearComparison />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  charts.line.length = 0;
  charts.bar.length = 0;
  charts.lineKeys.length = 0;
});

// --- Group H — application grammar ---------------------------------------------

describe('#24 H — application grammar', () => {
  it('renders inside the shared SubNav chrome with a Year Comparison title', async () => {
    const html = await renderComparison();
    expect(html).toContain('data-subnav="เปรียบเทียบ');
  });
});

// --- Group Q — trend chart -------------------------------------------------------

describe('#24 Q — annual coverage trend', () => {
  it('uses a LineChart (not a coverage BarChart) with FY ascending and real values', async () => {
    const html = await renderComparison();
    expect(charts.line.length).toBeGreaterThan(0);
    const data = charts.line[0];
    expect(data.length).toBe(2);
    expect(String(data[0].name) < String(data[1].name)).toBe(true);
    // Real values present as numbers for both years.
    expect(String(data.map(d => d.name))).toContain(String(previousYear));
    expect(String(data.map(d => d.name))).toContain(String(currentYear));
    // No fabricated zero point: every point carries a real coverage value.
    for (const entry of data) {
      expect(entry.percentV2 === 0 || entry.percentV2 === '0.00').toBe(false);
    }
    // Per-FY targets are represented as their own series, not one fixed line.
    expect(new Set(charts.lineKeys).size).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('NaN');
  });
});

// --- Group L/M/N — latest-year KPI area ------------------------------------------

describe('#24 L/M/N — latest-year KPI area', () => {
  it('shows latest coverage, passed/applicable, and pp delta from the previous selected usable FY', async () => {
    const html = await renderComparison();
    expect(html).toContain('92.40');            // latest coverage 231/250
    expect(html).toMatch(/231\s*\/\s*250/);     // passed / applicable
    expect(html).toContain('+3.10');            // 92.40 - 89.30 in percentage points
    expect(html).not.toContain('% จากปีก่อน');  // never framed as percent growth
  });

  it('shows the FY-specific target gap in pp via the real target convention (all → Q4)', async () => {
    const html = await renderComparison({ targetConfig: { [`target_view2_q4_${currentYear}`]: 90 } });
    expect(html).toContain('+2.40');            // 92.40 - 90
  });

  it('shows ไม่ได้กำหนดเป้าหมาย when the FY has no configured target (never 0)', async () => {
    const html = await renderComparison({ targetConfig: {} });
    expect(html).toContain('ไม่ได้กำหนดเป้าหมาย');
  });

  it('treats a real view2Coverage of 0 as a real value — not missing, not no-data', async () => {
    const html = await renderComparison({
      rows: [
        summary(previousYear, { total: 200, view2ApplicableTotal: 200, view2Passed: 180, view2PendingCount: 0, view2Coverage: 90 }),
        summary(currentYear, { total: 100, view2ApplicableTotal: 100, view2Passed: 0, view2PendingCount: 0, view2Coverage: 0 }),
      ],
    });
    expect(html).toContain('0.00');
    expect(html).not.toContain('ไม่มีข้อมูลสรุป');
  });
});

// --- Group O/P — legacy degradation and current composition ----------------------

describe('#24 O/P — legacy degradation and current composition', () => {
  it('legacy FY keeps coverage and passed but marks denominator detail unavailable — never total − passed', async () => {
    const html = await renderComparison({
      rows: [
        // legacy: no view2ApplicableTotal / view2PendingCount
        { ...summary(previousYear, { total: 300, view2Passed: 150, view2Coverage: 50, view2ApplicableTotal: undefined, view2PendingCount: undefined }) },
        summary(currentYear, { total: 260, view2ApplicableTotal: 250, view2Passed: 231, view2PendingCount: 10, view2Coverage: 92.4 }),
      ],
    });
    expect(html).toContain('ไม่มีข้อมูลรายละเอียดสำหรับ summary รุ่นนี้');
    expect(html).toMatch(/—/); // unavailable cells exist
    // Fabricated failed (300 - 150 = 150) must not be presented as the legacy failed value.
    expect(html).not.toMatch(/[^0-9]150[^0-9]/);
  });

  it('current-contract composition exposes passed/failed/pending as real numbers (231/19/10)', async () => {
    const html = await renderComparison();
    expect(html).toMatch(/[^0-9]231[^0-9]/);
    expect(html).toMatch(/[^0-9]19[^0-9]/);   // failed = 250 - 231
    expect(html).toMatch(/[^0-9]10[^0-9]/);   // pending
  });
});

// --- Group R/S — detailed table and snapshot wording -----------------------------

describe('#24 R/S — detailed table and snapshot semantics', () => {
  it('renders the detailed comparison surface with per-year summary timestamps (ข้อมูลสรุป ณ วันที่ …)', async () => {
    const html = await renderComparison({ targetConfig: { [`target_view2_q4_${currentYear}`]: 90 } });
    expect(html).toContain('ข้อมูลสรุป ณ วันที่');
    expect((html.match(/ข้อมูลสรุป ณ วันที่/g) ?? []).length).toBeGreaterThanOrEqual(2); // one per selected FY
    expect(html).not.toContain('ข้อมูลอัปเดตล่าสุด'); // forbidden upload-freshness wording
  });

  it('carries concise help text that FY points are stored snapshots with different computation times', async () => {
    const html = await renderComparison();
    expect(html).toContain('ต่างกัน');
  });
});

// --- Group T — distinct states ---------------------------------------------------

describe('#24 T — distinct states', () => {
  it('usable-years API error renders an error state — not an empty-years/no-data page', async () => {
    const html = await renderComparison({ errorYears: true });
    expect(html).toContain('ไม่สามารถดึงข้อมูลปีงบประมาณ');
    expect(html).not.toContain('กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี');
  });

  it('multi-year summary API error renders an error state and is not converted to no-data (preservation)', async () => {
    const html = await renderComparison({ errorSummaries: true });
    expect(html).toContain('ไม่สามารถดึงข้อมูลสรุปได้');
    expect(html).not.toContain('ไม่มีข้อมูลสรุป');
  });
});

// --- Group U — age-group chip isolation (static part) -----------------------------

describe('#24 U — age-group chip isolation', () => {
  it('year chips come only from the active age group table — no cross-table union (preservation)', async () => {
    const html = await renderComparison({
      yearsByTable: { Epi_1_Year: [previousYear, currentYear], Epi_2_Year: [2560] },
    });
    expect(html).toContain(`ปี ${previousYear}`);
    expect(html).toContain(`ปี ${currentYear}`);
    expect(html).not.toContain('ปี 2560');
  });
});
