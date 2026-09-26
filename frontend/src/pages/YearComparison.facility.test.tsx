// @vitest-environment jsdom
/**
 * Issue #25 RED contracts — Facility cross-year comparison on the Year Comparison page.
 *
 * Observable seam: the real `YearComparison` page rendered with React Testing Library
 * and a real per-test QueryClient (jsdom environment; the #24 interaction harness is
 * now canonical). All facility data is served through the existing annual-summary
 * API surface (`facilityBreakdownV1` / `facilityBreakdownV2` inside
 * `getDashboardSummariesMultiYear`) — Issue #25 must consume stored snapshots only.
 *
 * Expected values are worked-example literals (fixture map below), never a
 * recomputation of production logic. No source-text assertions, no component-state
 * mutation, no mocks of page internals. The acceptable #25 UI shape per Issue #25 is
 * a comparison table (table / matrix / table + compact chart) — facility contracts
 * are therefore asserted through user-visible table rows plus page-level text, not
 * through internal structure.
 *
 * Fixture value map (all synthetic; years 2568+2569 selected by the #24 latest-2
 * default, 2567 usable-but-unselected):
 *   facility 06413 "บ้านหนุน" → FY2568 V1 71.25 / V2 82.50; FY2569 (renamed "ชื่อใหม่")
 *     V1 75.00 / V2 88.00 → cross-year V2 delta +5.50 pp; FY2569 target 90 → gap -2.00 pp;
 *     FY2568 target absent → missing-target wording.
 *   facility 6413 "รพ.สต.ตัวอย่าง" (no leading zero) → FY2568 V2 70.00; FY2569 V2 74.00.
 *   facility 06414 "รพ.สต.ตัวอย่าง" (same hosname as 6413) → FY2568 V2 65.00.
 *   facility 10620 "ป่าตึง" → FY2568 V1 55.00 / V2 80.00 (FY2569 absent → unavailable, never 0;
 *     FY2568 View 1 present so any row-level unavailable marker can only come from FY absence).
 *   facility 10621 "หนองกุ้ง" → FY2569 V2 85.50 only (FY2568 absent → no baseline delta).
 *   facility 10999 "กุดหมาก" → V2 coverage exactly 0 in BOTH years (real zero ≠ missing).
 *   FY2567 (unselected): 06413 V2 55.55 and facility 10630 V2 77.77 must never render.
 *   Epi_2_Year FY2569: facility 99999 V2 99.00 must never render on the Epi_1 page.
 *   Year-level coverages 90.00 / 91.00 and target 90 (FY2569 only) are chosen so no
 *   year-surface number collides with any facility assertion literal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { YearComparison } from './YearComparison';
import { formatDateTimeStr } from '../shared/utils/dateUtils';
import type { DashboardSummaryRow, FacilityBreakdownEntry } from '../shared/types/dashboardSummary';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));

// Radix Select in jsdom needs pointer-capture stubs and a PointerEvent constructor
// (same observed gaps as the #24 interaction harness; driven via its keyboard path).
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
    LineChart: stub, BarChart: stub, Line: stub, Bar: stub, XAxis: stub, YAxis: stub,
    CartesianGrid: stub, Tooltip: stub, Legend: stub, ReferenceLine: stub,
    ReferenceDot: stub, ComposedChart: stub, AreaChart: stub, Area: stub,
    Cell: stub, LabelList: stub, PieChart: stub, Pie: stub, ScatterChart: stub, Scatter: stub,
  };
});

// --- synthetic annual snapshots ---------------------------------------------------------------

const UPDATED_AT: Record<number, string> = {
  2567: '2026-06-01T09:00:00.000Z',
  2568: '2026-09-01T10:00:00.000Z',
  2569: '2026-09-20T14:30:00.000Z',
};

const fac = (hoscode: string, hosname: string, total: number, passed: number, coverage: number): FacilityBreakdownEntry =>
  ({ hoscode, hosname, total, passed, coverage });

const row = (
  fiscalYear: number,
  yearMetrics: { total: number; applicable: number; passed: number; pending: number; coverage: number; view1: number },
  breakdowns: { v1?: FacilityBreakdownEntry[]; v2: FacilityBreakdownEntry[] },
  targetTable: DashboardSummaryRow['targetTable'] = 'Epi_1_Year',
): DashboardSummaryRow => ({
  id: `${targetTable}_${fiscalYear}_all`,
  targetTable,
  fiscalYear,
  updated_at: UPDATED_AT[fiscalYear],
  summaryData: {
    total: yearMetrics.total,
    view2Coverage: yearMetrics.coverage,
    view2Passed: yearMetrics.passed,
    view2ApplicableTotal: yearMetrics.applicable,
    view2PendingCount: yearMetrics.pending,
    view1Coverage: yearMetrics.view1,
    view1PassedDoses: 0,
    view1TotalDoses: 0,
    view1Breakdown: [],
    view2Breakdown: [],
    facilityBreakdownV1: breakdowns.v1,
    facilityBreakdownV2: breakdowns.v2,
  },
});

const EPI1_ROWS: Record<number, DashboardSummaryRow> = {
  2567: row(2567,
    { total: 300, applicable: 280, passed: 238, pending: 20, coverage: 85, view1: 83 },
    { v2: [fac('06413', 'บ้านหนุน', 50, 27, 55.55), fac('10630', 'ไม่ถูกเลือก', 45, 35, 77.77)] }),
  2568: row(2568,
    { total: 500, applicable: 450, passed: 405, pending: 50, coverage: 90, view1: 84 },
    {
      v1: [fac('06413', 'บ้านหนุน', 80, 57, 71.25), fac('6413', 'รพ.สต.ตัวอย่าง', 50, 30, 60), fac('10620', 'ป่าตึง', 60, 33, 55)],
      v2: [
        fac('06413', 'บ้านหนุน', 80, 66, 82.5),
        fac('6413', 'รพ.สต.ตัวอย่าง', 50, 35, 70),
        fac('06414', 'รพ.สต.ตัวอย่าง', 40, 26, 65),
        fac('10620', 'ป่าตึง', 60, 48, 80),
        fac('10999', 'กุดหมาก', 30, 0, 0),
      ],
    }),
  2569: row(2569,
    { total: 520, applicable: 400, passed: 364, pending: 120, coverage: 91, view1: 86 },
    {
      v1: [fac('06413', 'ชื่อใหม่', 100, 75, 75), fac('6413', 'รพ.สต.ตัวอย่าง', 50, 36, 72)],
      v2: [
        fac('06413', 'ชื่อใหม่', 100, 88, 88),
        fac('6413', 'รพ.สต.ตัวอย่าง', 50, 37, 74),
        fac('10621', 'หนองกุ้ง', 40, 34, 85.5),
        fac('10999', 'กุดหมาก', 30, 0, 0),
      ],
    }),
};

/** Same-FY row for a DIFFERENT age group: present in the API response, must be filtered by the page. */
const EPI2_2569: DashboardSummaryRow = row(2569,
  { total: 120, applicable: 100, passed: 90, pending: 20, coverage: 90, view1: 88 },
  { v2: [fac('99999', 'กลุ่มอายุอื่น', 100, 99, 99)] },
  'Epi_2_Year');

const YEARS_TABLES: Record<string, number[]> = { Epi_1_Year: [2567, 2568, 2569], Epi_2_Year: [2569] };

function stubApi() {
  api.fetchApi.mockImplementation(async (action: string, payload?: { fiscalYears?: number[] }) => {
    if (action === 'getDashboardSummaryYears') return { data: { success: true, tables: YEARS_TABLES } };
    if (action === 'getDashboardSummariesMultiYear') {
      const requested = payload?.fiscalYears ?? [];
      const summaries = requested.flatMap(fy => {
        const rows: DashboardSummaryRow[] = [];
        if (EPI1_ROWS[fy]) rows.push(EPI1_ROWS[fy]);
        if (fy === 2569) rows.push(EPI2_2569);
        return rows;
      });
      return { data: { success: true, summaries } };
    }
    if (action === 'getTargetConfig') return { data: { target_view2_q4_2569: 90 } };
    return { data: {} };
  });
}

async function renderComparison() {
  stubApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearComparison />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Harness validity gate: the #24 year-level surface must be fully rendered before
  // facility contracts are evaluated — otherwise failures would be loading races, not RED.
  await screen.findByText('ตารางเปรียบเทียบรายปีงบประมาณ');
}

// --- assertion helpers ------------------------------------------------------------------------

const bodyText = (): string => document.body.textContent ?? '';

/** Identity match for an all-numeric identifier: `6413` must not match inside `06413`. */
const codeBoundary = (code: string): RegExp => new RegExp(`(?<![0-9])${code}(?![0-9])`);

/** Standalone numeric value: `0.00` must not match inside `80.00` / `90.00`. */
const valueBoundary = (value: string): RegExp =>
  new RegExp(`(?<![0-9.])${value.replace('.', '\\.')}(?![0-9])`);

/** Text of every rendered table row whose identity includes the exact hoscode. */
const facilityRowsText = (code: string): string[] => {
  const re = codeBoundary(code);
  return screen
    .getAllByRole('row')
    .filter(r => re.test(r.textContent ?? ''))
    .map(r => (r.textContent ?? '').replace(/\s+/g, ' '));
};
const facilityText = (code: string): string => facilityRowsText(code).join(' | ');

const UNAVAILABLE = /—|ไม่มีข้อมูล/;

beforeEach(() => {
  api.fetchApi.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('#25 — facility cross-year comparison (RED)', () => {
  it('harness validity: the #24 year-level analytical surface renders (setup, expected PASS today)', async () => {
    await renderComparison();
    expect(screen.getByRole('row', { name: /ปี 2568/ })).toBeTruthy();
    expect(screen.getByRole('row', { name: /ปี 2569/ })).toBeTruthy();
  });

  it('RED 1: exposes a user-visible facility cross-year comparison surface for the selected FYs', async () => {
    await renderComparison();
    // A facility-named section title — no facility surface exists on the canonical #24 page.
    expect(screen.getAllByText(/สถานบริการ|รพ\.สต\./).length).toBeGreaterThan(0);
    expect(facilityRowsText('06413').length).toBeGreaterThan(0);
    // The surface compares FYs: each selected FY is communicated by SOME rendered row —
    // header rows (wide layout) and per-FY data rows (long layout) both satisfy this.
    const allRows = screen.getAllByRole('row');
    expect(allRows.some(row => /2568/.test(row.textContent ?? ''))).toBe(true);
    expect(allRows.some(row => /2569/.test(row.textContent ?? ''))).toBe(true);
  });

  it('RED 2: renders hoscode as an exact string identifier — leading zero preserved, 06413 ≠ 6413', async () => {
    await renderComparison();
    expect(bodyText()).toContain('06413');
    expect(facilityRowsText('06413').length).toBeGreaterThan(0);
    expect(facilityRowsText('6413').length).toBeGreaterThan(0);
    // Two distinct facility series — each keeps its own values, never merged or collided.
    expect(facilityText('06413')).toContain('82.50');
    expect(facilityText('6413')).toContain('70.00');
    expect(facilityText('06413')).not.toContain('70.00');
    expect(facilityText('6413')).not.toContain('82.50');
  });

  it('RED 3: represents BOTH breakdown sources — View 1 and View 2 facility coverage', async () => {
    await renderComparison();
    expect(bodyText()).toContain('View 1');
    expect(facilityText('06413')).toContain('71.25'); // View 1, FY2568
    expect(facilityText('06413')).toContain('82.50'); // View 2, FY2568
  });

  it('RED 4: joins the same exact hoscode across FYs into one facility series with a pp delta', async () => {
    await renderComparison();
    const series = facilityText('06413');
    expect(series).toContain('82.50'); // FY2568 V2
    expect(series).toContain('88.00'); // FY2569 V2
    expect(series).toContain('+5.50'); // 88.00 − 82.50 in percentage points, not % growth
  });

  it('RED 11: a hosname change between years does not split the facility identity', async () => {
    await renderComparison();
    // Same hoscode 06413 carries FY2568 "บ้านหนุน" and FY2569 "ชื่อใหม่": one series with both values.
    const series = facilityText('06413');
    expect(series).toContain('82.50');
    expect(series).toContain('88.00');
    expect(series).toContain('+5.50');
  });

  it('RED 12: facilities sharing a hosname stay separate by hoscode', async () => {
    await renderComparison();
    expect(facilityRowsText('6413').length).toBeGreaterThan(0);
    expect(facilityRowsText('06414').length).toBeGreaterThan(0);
    expect(facilityText('6413')).toContain('74.00');  // its FY2569 V2 value
    expect(facilityText('06414')).toContain('65.00'); // its FY2568 V2 value
    expect(facilityText('6413')).not.toContain('65.00');
    expect(facilityText('06414')).not.toContain('74.00');
  });

  it('RED 5: a missing facility/year is unavailable — never 0 — while a real facility zero stays 0', async () => {
    await renderComparison();
    // 10620 exists only in FY2568: its FY2569 state is unavailable, not a fabricated zero.
    const absentLater = facilityText('10620');
    expect(absentLater).toContain('80.00');
    expect(absentLater).toMatch(UNAVAILABLE);
    expect(absentLater).not.toMatch(valueBoundary('0.00'));
    // 10999 has a genuine V2 coverage of exactly 0 in both years: a real zero value.
    // (Its View 1 data is intentionally absent from the fixture, so no row-level
    // dash-free expectation is placed here — an honest `—` for its View 1 is fine.)
    const realZero = facilityText('10999');
    expect(realZero).toMatch(valueBoundary('0.00'));
  });

  it('RED 6: facility delta is derived only from present values — no subtract-from-zero', async () => {
    await renderComparison();
    // 10621 is absent in FY2568: no baseline → delta unavailable, never 85.50 − 0 = +85.50.
    const noBaseline = facilityText('10621');
    expect(noBaseline).toContain('85.50');
    expect(noBaseline).toMatch(UNAVAILABLE);
    expect(noBaseline).not.toContain('+85.50');
    // 10620 is absent in FY2569: never 0 − 80.00 = −80.00.
    const noLater = facilityText('10620');
    expect(noLater).not.toContain('-80.00');
  });

  it('RED 7: facility target gap uses the existing annual View 2 target (all → Q4), no 0-fallback', async () => {
    await renderComparison();
    const series = facilityText('06413');
    expect(series).toContain('-2.00'); // FY2569: 88.00 − target 90
    // FY2568 has no configured target: existing missing-target wording, never a 0-target gap.
    expect(series).toContain('ไม่ได้กำหนดเป้าหมาย');
  });

  it('RED 8: communicates each FY snapshot computation time (ข้อมูลสรุป ณ วันที่ …), not upload freshness', async () => {
    await renderComparison();
    const body = bodyText();
    // The year table already contributes two per-FY timestamps; the facility surface must
    // make the snapshot-time relationship visible on its own (at least one more occurrence).
    expect((body.match(/ข้อมูลสรุป ณ วันที่/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(body).toContain(formatDateTimeStr(UPDATED_AT[2568]));
    expect(body).toContain(formatDateTimeStr(UPDATED_AT[2569]));
    expect(body).not.toContain('ข้อมูลอัปเดตล่าสุด');
  });

  it('RED 9: only the SELECTED fiscal years participate — unselected FY data never renders', async () => {
    await renderComparison();
    // Anchor to the facility surface first so the absence assertions below cannot pass
    // vacuously while no facility comparison exists at all.
    expect(facilityRowsText('06413').length).toBeGreaterThan(0);
    const body = bodyText();
    expect(body).not.toContain('10630'); // facility present only in unselected FY2567
    expect(body).not.toContain('77.77'); // its conspicuous coverage
    expect(body).not.toContain('55.55'); // 06413's unselected-FY value
  });

  it('RED 10: only the ACTIVE age group’s facility data participates', async () => {
    await renderComparison();
    // Same non-vacuity anchor as RED 9.
    expect(facilityRowsText('06413').length).toBeGreaterThan(0);
    const body = bodyText();
    expect(body).not.toContain('99999'); // facility only in Epi_2_Year FY2569 (present in the API response)
    expect(body).not.toMatch(valueBoundary('99.00'));
  });
});
