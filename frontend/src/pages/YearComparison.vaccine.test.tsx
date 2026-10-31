// @vitest-environment jsdom
/**
 * Issue #26 RED contracts — vaccine cross-year Comparison UX and legacy safety.
 *
 * Canonical contract: docs/specs/comparison-page-improvement.md §6 Decision E.
 * The vaccine surface joins ONLY valid metric_key values within the active age
 * group + view; display_name is display metadata only (no presentation policy
 * is mandated here); legacy entries never join (unavailable, visible notice,
 * never zero); targets use the existing authority via each entry's SNAPSHOT-time
 * vaccine_group; numeric values accompany all encoding; snapshot timestamps keep
 * their meaning.
 *
 * Black-box discipline: fixtures carry metric_key (the join identity), but NO
 * assertion requires the raw key to render. Series are located by VISIBLE
 * display names and values; identity semantics are proven by the D2/D3 pair —
 * same key + renamed display_name MUST stay one series (the pp delta forces a
 * genuine cross-year join), while equal display_names + different keys MUST
 * stay separate value sets. No sr-only keys, data-testids, or aria hooks.
 *
 * Expected today: RED — the canonical page has no vaccine comparison surface.
 * Harness follows the frozen #24/#25 interaction/facility conventions. All data
 * synthetic. Forward breakdown entries use a local test-only widened type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { YearComparisonDetail as YearComparison } from './YearComparison';
import type { DashboardSummaryRow, VaccineBreakdownEntry } from '../shared/types/dashboardSummary';
import { formatDateTimeStr } from '../shared/utils/dateUtils';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));

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

/** Forward current-contract vaccine breakdown entry (Decision E) — test-only widening. */
type ForwardEntry = VaccineBreakdownEntry & { metric_key?: string; vaccine_group?: string };
const vent = (metric_key: string, vaccine_group: string, name: string, passed: number, total: number, coverage: number): ForwardEntry =>
  ({ metric_key, vaccine_group, name, passed, total, coverage });
const lent = (name: string, passed: number, total: number, coverage: number): VaccineBreakdownEntry =>
  ({ name, passed, total, coverage });
/** Issue #97 writer contract: HDC-verdict bucket — keyless by design, labelled by the writer. */
const vbent = (passed: number, total: number): VaccineBreakdownEntry =>
  ({ name: 'ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)', passed, total, coverage: 0, category: 'hdc_verdict' });

const UPDATED_AT: Record<number, string> = { 2568: '2026-06-01T09:00:00.000Z', 2569: '2026-09-01T10:00:00.000Z', 2570: '2026-09-20T14:30:00.000Z' };

function summaryRow(
  fiscalYear: number,
  breakdowns: { v1?: ForwardEntry[]; v2?: ForwardEntry[] },
  targetTable: DashboardSummaryRow['targetTable'] = 'Epi_1_Year',
): DashboardSummaryRow {
  return {
    id: `${targetTable}_${fiscalYear}_all`,
    targetTable,
    fiscalYear,
    updated_at: UPDATED_AT[fiscalYear],
    summaryData: {
      total: 100, view2Coverage: fiscalYear === 2570 ? 86 : 85, view2Passed: 60,
      view2ApplicableTotal: 70, view2PendingCount: 30, view1Coverage: 84,
      view1PassedDoses: 50, view1TotalDoses: 60,
      view1Breakdown: breakdowns.v1 ?? [], view2Breakdown: breakdowns.v2 ?? [],
      facilityBreakdownV1: [], facilityBreakdownV2: [],
    },
  };
}

interface Setup {
  years: number[];
  /** Breakdowns per FY for the ACTIVE age group (Epi_1_Year). */
  byYear: Record<number, { v1?: ForwardEntry[]; v2?: ForwardEntry[] }>;
  /** Extra rows returned in the same API response (other age groups / unselected FYs). */
  extraRows?: DashboardSummaryRow[];
  targetConfig?: Record<string, number>;
}

function stubApi({ years, byYear, extraRows = [], targetConfig = {} }: Setup) {
  api.fetchApi.mockImplementation(async (action: string, payload?: { fiscalYears?: number[] }) => {
    if (action === 'getDashboardSummaryYears') return { data: { success: true, tables: { Epi_1_Year: years, Epi_2_Year: [] } } };
    if (action === 'getDashboardSummariesMultiYear') {
      const requested = payload?.fiscalYears ?? [];
      const summaries = requested.flatMap(fy => (byYear[fy] ? [summaryRow(fy, byYear[fy])] : []));
      return { data: { success: true, summaries: [...summaries, ...extraRows] } };
    }
    if (action === 'getTargetConfig') return { data: targetConfig };
    return { data: {} };
  });
}

async function renderComparison(setup: Setup) {
  stubApi(setup);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearComparison />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('ตารางเปรียบเทียบรายปีงบประมาณ');
}

const HEADING = 'การเปรียบเทียบวัคซีนข้ามปีงบประมาณ';
const bodyText = (): string => document.body.textContent ?? '';
const valueBoundary = (value: string): RegExp => new RegExp(`(?<![0-9.])${value.replace('.', '\\.')}(?![0-9])`);

/**
 * Visible-black-box series location: vaccine display names appear only in the vaccine
 * surface (year/facility fixtures carry none of them), so rows whose visible text
 * contains the display name are that vaccine's series rows — no raw metric_key,
 * sr-only text, or test hooks required.
 */
const rowsWithText = (needle: string): string[] =>
  screen.getAllByRole('row')
    .filter(r => (r.textContent ?? '').includes(needle))
    .map(r => (r.textContent ?? '').replace(/\s+/g, ' '));
const joinedText = (needles: string[]): string => needles.flatMap(rowsWithText).join(' | ');

beforeEach(() => { api.fetchApi.mockReset(); });
afterEach(() => { cleanup(); });

describe('#26 — vaccine cross-year comparison (RED)', () => {
  it('D1: one stable series across selected FYs joins by metric_key with a pp delta', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92)] },
      },
    });
    expect(screen.getAllByText(HEADING).length).toBeGreaterThan(0);
    // ONE visible vaccine row carries both FY values AND the computed delta — the join
    // is a single series row, not values scattered across separate rows.
    const rows = rowsWithText('DTP เข็ม 1');
    expect(
      rows.some(row => row.includes('80.00') && row.includes('92.00') && row.includes('+12.00')),
    ).toBe(true); // 92 − 80 in pp — forces a genuine cross-year join
  });

  it('D2: a display-name rename does not split the lineage — one series keeps both FY values and the pp delta', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'วัคซีน DTP เข็มที่ 1', 92, 100, 92)] },
      },
    });
    // Either visible-name presentation is acceptable; the identity contract is that the
    // SAME metric_key with different names stays ONE series. Deduplicate the rows matched
    // by either name: exactly ONE relevant series row may exist, and it must carry both
    // FY values and the delta — the values must not be split across two rename-fragments.
    const uniqueRows = [...new Set([...rowsWithText('DTP เข็ม 1'), ...rowsWithText('วัคซีน DTP เข็มที่ 1')])];
    const relevant = uniqueRows.filter(row => row.includes('80.00') || row.includes('92.00'));
    expect(relevant.length).toBe(1);
    expect(relevant[0]).toContain('80.00');
    expect(relevant[0]).toContain('92.00');
    expect(relevant[0]).toContain('+12.00');
  });

  it('D3: equal display_names with different metric_keys stay two distinct series — never merged by name', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-a', 'DTP', 'DTP เข็ม 1', 70, 100, 70), vent('dtp-b', 'DTP', 'DTP เข็ม 1', 60, 100, 60)] },
        2570: { v2: [vent('dtp-a', 'DTP', 'DTP เข็ม 1', 71, 100, 71), vent('dtp-b', 'DTP', 'DTP เข็ม 1', 61, 100, 61)] },
      },
    });
    // Two separate value sets under the SAME visible name: one lineage carries 70/71 only,
    // the other 60/61 only. A name-joined implementation collapses them into one series
    // whose rows then mix both value families — caught by the negative assertions.
    const rows = rowsWithText('DTP เข็ม 1');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some(r => r.includes('71.00') && !r.includes('61.00'))).toBe(true);
    expect(rows.some(r => r.includes('61.00') && !r.includes('71.00'))).toBe(true);
    expect(rows.some(r => r.includes('71.00') && r.includes('61.00'))).toBe(false);
  });

  it('D4: a legacy same-name entry never joins the current series; the legacy FY shows unavailable + a visible notice', async () => {
    await renderComparison({
      years: [2568, 2569],
      byYear: {
        2568: { v2: [lent('DTP เข็ม 1', 80, 100, 80)] }, // legacy: name-keyed only
        2569: { v2: [vent('dtp-1', 'DTP', 'DTP เข็ม 1', 90, 100, 90)] },
      },
    });
    const series = joinedText(['DTP เข็ม 1']);
    expect(series).toContain('90.00');
    expect(series).toContain('—'); // legacy FY2568 is unavailable
    // Decision E: the legacy entry is unavailable for vaccine-level identity — it may not
    // join the current series NOR surface as its own separate name-based vaccine row.
    expect(series).not.toContain('80.00');
    // #58 Phase 1 copy (#97): measured counts for the selected age+view+FY — 1 entry, all unkeyed
    expect(bodyText()).toContain('ปี 2568 · View 2: ข้อมูลสรุปมีวัคซีน 1 รายการ โดยทุกรายการยังไม่มีรหัสเชื่อมโยงสำหรับการเปรียบเทียบข้ามปี');
  });

  it('D4b: an HDC-verdict bucket owning no key by design is not a vaccine — never raises the join warning (#97)', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80), vbent(1, 23)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92), vbent(0, 20)] },
      },
    });
    // Every real vaccine carries a key → no join warning anywhere, and the keyed series joins.
    expect(bodyText()).not.toContain('ยังไม่มีรหัสเชื่อมโยง');
    expect(bodyText()).not.toContain('ไม่มีรหัสเชื่อมโยงวัคซีน');
    const series = joinedText(['DTP เข็ม 1']);
    expect(series).toContain('80.00');
    expect(series).toContain('+12.00');
    // The verdict bucket is not a vaccine series — it never renders as one.
    expect(bodyText()).not.toContain('ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)');
  });

  it('D5: an all-legacy selection renders the vaccine section with an explicit unavailable state — no fabricated rows', async () => {
    await renderComparison({
      years: [2568, 2569],
      byYear: {
        2568: { v2: [lent('DTP เข็ม 1', 80, 100, 80)] },
        2569: { v2: [lent('DTP เข็ม 1', 90, 100, 90)] },
      },
    });
    expect(screen.getAllByText(HEADING).length).toBeGreaterThan(0);
    expect(bodyText()).toContain('ไม่มีข้อมูลวัคซีนที่มีรหัสเชื่อมโยงสำหรับปีที่เลือก');
    // No fabricated VACCINE-level zero: scope to the vaccine Card's existing DOM
    // boundary — an unrelated legitimate year-level/KPI delta (e.g. a real `0.00 pp`
    // from equal year coverages) elsewhere on the page is valid #24 behavior.
    const heading = screen.getByText(HEADING);
    const vaccineCard = heading.closest('[data-slot="card"]');
    expect(vaccineCard).not.toBeNull();
    expect(vaccineCard?.textContent ?? '').not.toMatch(valueBoundary('0.00'));
  });

  it('D6: a missing metric/year is unavailable — never 0 — while a stored real zero renders 0.00%', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('mmr-dose-1', 'MMR', 'MMR เข็ม 1', 0, 100, 0)] }, // dtp absent in 2570; mmr real zero
      },
    });
    const dtp = joinedText(['DTP เข็ม 1']);
    expect(dtp).toContain('80.00');
    expect(dtp).toContain('—');
    expect(dtp).not.toMatch(valueBoundary('0.00'));
    expect(joinedText(['MMR เข็ม 1'])).toMatch(valueBoundary('0.00'));
  });

  it('D7: only selected FYs participate — an unselected FY vaccine never renders', async () => {
    await renderComparison({
      years: [2568, 2569, 2570], // default selection = [2569, 2570]
      byYear: {
        2568: { v2: [vent('unselected-key', 'Hib', 'Hib เข็ม 1', 35, 45, 77.77)] },
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92)] },
      },
    });
    expect(joinedText(['DTP เข็ม 1'])).toContain('92.00');
    expect(bodyText()).not.toContain('Hib เข็ม 1'); // unselected-FY vaccine (name and value)
    expect(bodyText()).not.toContain('77.77');
  });

  it('D8: only the active age group participates — another age group\'s vaccine series never leaks', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92)] },
      },
      extraRows: [summaryRow(2570, { v2: [vent('dtp-dose-1', 'DTP', 'Epi2 DTP', 99, 100, 99)] }, 'Epi_2_Year')],
    });
    const series = joinedText(['DTP เข็ม 1']);
    expect(series).toContain('92.00');
    expect(bodyText()).not.toContain('Epi2 DTP'); // same metric_key in another age group — never joins
    expect(bodyText()).not.toContain('99.00');
  });

  it('D9: the same metric_key string in View 1 and View 2 stays two separate identities', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: {
          v1: [vent('shared-key', 'VX', 'VX ร่วม', 70, 100, 70)],
          v2: [vent('shared-key', 'VX', 'VX ร่วม', 80, 100, 80)],
        },
        2570: {
          v1: [vent('shared-key', 'VX', 'VX ร่วม', 71, 100, 71)],
          v2: [vent('shared-key', 'VX', 'VX ร่วม', 81, 100, 81)],
        },
      },
    });
    // Same visible name, two views, disjoint value families (71 vs 81) — a cross-view
    // merge would mix both families into one series row.
    const rows = rowsWithText('VX ร่วม');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some(r => r.includes('71.00') && !r.includes('81.00'))).toBe(true);
    expect(rows.some(r => r.includes('81.00') && !r.includes('71.00'))).toBe(true);
    expect(rows.some(r => r.includes('71.00') && r.includes('81.00'))).toBe(false);
  });

  it('D10/D11: target lookup uses the entry snapshot vaccine_group via the existing authority; missing and zero targets are distinct', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2570: {
          v2: [
            vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92),
            vent('hib-dose-1', 'Hib', 'Hib เข็ม 1', 50, 100, 50),   // no target configured
            vent('mmr-dose-1', 'MMR', 'MMR เข็ม 1', 0, 100, 0),     // REAL configured target of 0
          ],
        },
        2569: {
          v2: [
            vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80),
            vent('hib-dose-1', 'Hib', 'Hib เข็ม 1', 40, 100, 40),
            vent('mmr-dose-1', 'MMR', 'MMR เข็ม 1', 10, 100, 10),
          ],
        },
      },
      // Existing target authority: vaccine-group-specific keys resolved through the real hook
      // (getTarget('all', VIEW_TYPE, entry.vaccine_group, fiscalYear) semantics).
      targetConfig: { target_DTP_q4_2570: 90, target_MMR_q4_2570: 0 },
    });
    // DTP: 92 − 90 → +2.00 pp proves the snapshot-time vaccine_group reached the lookup.
    expect(joinedText(['DTP เข็ม 1'])).toContain('+2.00');
    expect(joinedText(['DTP เข็ม 1'])).toContain('92.00%'); // D12: numeric value accompanies any encoding
    // Hib: no target → existing missing-target wording.
    expect(joinedText(['Hib เข็ม 1'])).toContain('ไม่ได้กำหนดเป้าหมาย');
    // MMR: a configured 0 is a REAL target (gap computed), never "missing".
    expect(joinedText(['MMR เข็ม 1'])).not.toContain('ไม่ได้กำหนดเป้าหมาย');
    expect(joinedText(['MMR เข็ม 1'])).toMatch(valueBoundary('0.00'));
  });

  it('D13: snapshot timestamps keep computation-time wording; upload wording never appears', async () => {
    await renderComparison({
      years: [2569, 2570],
      byYear: {
        2569: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 80, 100, 80)] },
        2570: { v2: [vent('dtp-dose-1', 'DTP', 'DTP เข็ม 1', 92, 100, 92)] },
      },
    });
    // Anchor to the vaccine surface first so the timestamp contract binds to it
    // (the year/facility tables already contribute occurrences of their own).
    expect(screen.getAllByText(HEADING).length).toBeGreaterThan(0);
    const body = bodyText();
    expect((body.match(/ข้อมูลสรุป ณ วันที่/g) ?? []).length).toBeGreaterThanOrEqual(3); // year table 2 + vaccine ≥1
    expect(body).toContain(formatDateTimeStr(UPDATED_AT[2570]));
    expect(body).not.toContain('ข้อมูลอัปเดตล่าสุด');
  });

  it('D14: the page never consults current vaccine-rule configuration for identity (no repair path)', async () => {
    await renderComparison({
      years: [2568, 2569],
      byYear: {
        2568: { v2: [lent('DTP เข็ม 1', 80, 100, 80)] },
        2569: { v2: [vent('dtp-1', 'DTP', 'DTP เข็ม 1', 90, 100, 90)] },
      },
    });
    expect(screen.getAllByText(HEADING).length).toBeGreaterThan(0);
    expect(api.fetchApi.mock.calls.filter(call => call[0] === 'getVaccineRules')).toHaveLength(0);
  });
});
