/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { AgeGroupExpandedView } from './AgeGroupExpandedView';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

vi.mock('../lib/api', () => ({ fetchApi: vi.fn() }));
vi.mock('../hooks/useTargetSettings', () => ({
  useTargetSettings: () => ({ getTarget: () => undefined }),
}));
vi.mock('../hooks/useVaccineRules', () => ({
  useVaccineRules: () => ({ rules: [], isLoading: false, error: null }),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

// s_epi_complete report IDs per Age Group (docs/hdc-opendata-comparison.md).
const REPORT_IDS = {
  '1yr': '28dd2c7955ce926456240b2ff0100bde',
  '2yr': '35f4a8d465e6e1edc05f3d8ab658c551',
  '3yr': 'd1fe173d08e959397adf34b1d77e88d7',
  '5yr': 'f033ab37c30201f73f142449d037028d',
} as const;
type Age = keyof typeof REPORT_IDS;

const PANEL = 'ความครอบคลุมตาม HDC (Fully Immunized)';

const summary: LegacyCompatibleGroupSummary = {
  total: 20,
  view1PassedDoses: 16, view1TotalDoses: 20, view1Coverage: 80,
  view1Breakdown: [{ name: 'BCG', passed: 16, total: 20, coverage: 80, metric_key: 'bcg' }],
  facilityBreakdownV1: [],
  view2Passed: 10, view2Coverage: 50, view2ApplicableTotal: 20, view2PendingCount: 0,
  view2Breakdown: [{ name: 'BCG', passed: 10, total: 20, coverage: 50, metric_key: 'bcg' }],
  facilityBreakdownV2: [],
};

// Synthetic district rows; codes and counts are invented.
function row(age: Age, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPORT_IDS[age], b_year: '2569', hospcode: '06413', areacode: '54060101',
    date_com: '202610310301', target: 8, result: 6, ...over,
  };
}

function respond(rows: unknown[]) {
  vi.mocked(fetchApi).mockResolvedValue({ status: 200, data: { statusCode: 200, data: rows } });
}

function renderView(age: Age = '1yr', quarter: 'all' | 1 | 2 | 3 | 4 = 'all') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>
    <AgeGroupExpandedView summary={summary} fiscalYear={2569} ageGroup={age} quarter={quarter} />
  </QueryClientProvider>);
}

// Assertions stay inside the panel: the View 2 rule rows above also show percentages.
function openPanel() {
  const toggle = screen.getByRole('button', { name: PANEL });
  fireEvent.click(toggle);
  return within(document.getElementById(toggle.getAttribute('aria-controls')!)!);
}

describe('Issue #186 — View 2 shows HDC Coverage as a reference panel', () => {
  it('is collapsed and lazy, then shows the HDC figure of s_epi_complete', async () => {
    respond([row('1yr')]);
    renderView('1yr');
    const toggle = screen.getByRole('button', { name: PANEL });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fetchApi).not.toHaveBeenCalled();

    const panel = openPanel();
    expect(await panel.findByText('75.0%')).toBeTruthy();
    expect(fetchApi).toHaveBeenCalledWith('getOpenData', {
      payload: { tableName: 's_epi_complete', year: '2569' },
    });
    expect(panel.getByText('6/8 คน')).toBeTruthy();
    expect(panel.getByText('ข้อมูล HDC ณ 31/10/2026 03:01')).toBeTruthy();
    expect(panel.getByText(
      'HDC ใช้เกณฑ์และรอบประมวลผลของกระทรวง ผลจึงอาจต่างจากผลประเมินจากข้อมูลที่นำเข้าด้านบน',
    )).toBeTruthy();
  });

  // Two district rows per report; each group has its own counts.
  const allReports = [
    row('1yr', { hospcode: '06413', target: 8, result: 6 }), row('1yr', { hospcode: '06414', areacode: '54060202', target: 2, result: 1 }),
    row('2yr', { hospcode: '06413', target: 10, result: 4 }), row('2yr', { hospcode: '06414', areacode: '54060202', target: 10, result: 1 }),
    row('3yr', { hospcode: '06413', target: 3, result: 1 }), row('3yr', { hospcode: '06414', areacode: '54060202', target: 1, result: 1 }),
    row('5yr', { hospcode: '06413', target: 5, result: 5 }), row('5yr', { hospcode: '06414', areacode: '54060202', target: 15, result: 3 }),
    // Ignored: another year, another district, an unknown report.
    row('1yr', { b_year: '2568', target: 100, result: 100 }),
    row('1yr', { hospcode: '06501', areacode: '54050101', target: 100, result: 100 }),
    row('1yr', { id: 'ffffffffffffffffffffffffffffffff', hospcode: '06415', target: 100, result: 0 }),
  ];
  it.each([
    ['1yr', '70.0%', '7/10 คน'],
    ['2yr', '25.0%', '5/20 คน'],
    ['3yr', '50.0%', '2/4 คน'],
    ['5yr', '40.0%', '8/20 คน'],
  ] as const)('sums only its own report across district rows: %s', async (age, rate, counts) => {
    respond(allReports);
    renderView(age);
    const panel = openPanel();
    expect(await panel.findByText(rate)).toBeTruthy();
    expect(panel.getByText(counts)).toBeTruthy();
  });

  it('shows ยังไม่มีข้อมูลจาก HDC and no percentage when the year has no report', async () => {
    respond([row('1yr', { b_year: '2568' })]);
    renderView('1yr');
    const panel = openPanel();
    expect(await panel.findByText('ยังไม่มีข้อมูลจาก HDC ปีงบประมาณ 2569')).toBeTruthy();
    expect(panel.queryByText(/%/)).toBeNull();
  });

  it.each([
    ['a duplicate facility/area row', [row('1yr'), row('1yr')]],
    ['mixed processing rounds', [row('1yr'), row('1yr', { hospcode: '06414', areacode: '54060202', date_com: '202610300301' })]],
    ['a result larger than its target', [row('1yr', { target: 3, result: 4 })]],
    ['a non-integer count', [row('1yr', { result: '6.5' })]],
    ['a missing count', [row('1yr', { target: undefined })]],
    ['a zero total target', [row('1yr', { target: 0, result: 0 })]],
    ['a facility code that is not five digits', [row('1yr', { hospcode: '6413' })]],
    ['a numeric facility code', [row('1yr', { hospcode: 6413 })]],
    ['a malformed processing round', [row('1yr', { date_com: '2026-10-31' })]],
  ])('fails closed as ข้อมูล HDC ไม่ถูกต้อง on %s', async (_case, rows) => {
    respond(rows);
    renderView('1yr');
    const panel = openPanel();
    expect(await panel.findByText(/^ข้อมูล HDC ไม่ถูกต้อง/)).toBeTruthy();
    expect(panel.queryByText(/%/)).toBeNull();
    expect(panel.queryByText(/คน$/)).toBeNull();
  });

  it.each([
    ['a non-200 envelope', () => vi.mocked(fetchApi).mockResolvedValue({ status: 200, data: { statusCode: 500, error: 'boom' } })],
    ['a rejected request', () => vi.mocked(fetchApi).mockRejectedValue(new Error('network down'))],
  ])('reports %s as a request error, apart from invalid data', async (_case, arrange) => {
    arrange();
    renderView('1yr');
    const panel = openPanel();
    expect(await panel.findByText(/^ไม่สามารถดึงข้อมูล HDC ได้/)).toBeTruthy();
    expect(panel.queryByText(/ข้อมูล HDC ไม่ถูกต้อง/)).toBeNull();
    expect(panel.queryByText(/%/)).toBeNull();
  });

  it('shows the HDC figure alone: no difference against View 2 and no Coverage Goal', async () => {
    respond([row('1yr')]);
    renderView('1yr');
    const panel = openPanel();
    await panel.findByText('75.0%');
    expect(panel.queryByText(/จุด|HDC −|ส่วนต่าง|เป้าหมาย/)).toBeNull();
  });
});
