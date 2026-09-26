// @vitest-environment jsdom
/**
 * Issue #24 RED contracts — Executive Year Comparison UX: interaction-lifecycle
 * behavior (the cluster declared a harness blocker in the executive RED file).
 *
 * Authorized harness upgrade: jsdom + @testing-library/react devDependencies
 * (reviewer-authorized). This file is the ONLY DOM-environment test file
 * (per-file `@vitest-environment` directive — no global vitest config change).
 *
 * Observable seam: the real `YearComparison` page rendered with React Testing
 * Library and a real per-test QueryClient. All interaction happens through
 * rendered controls (FY chips, the age-group Radix Select). The current
 * selection is observed through the multi-year API request payload — never by
 * mutating component state or intercepting hooks.
 *
 * All fixtures are synthetic aggregate summaries. No person-level data, real
 * identifiers, or secrets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { YearComparison } from './YearComparison';
import type { DashboardSummaryRow } from '../shared/types/dashboardSummary';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));

// Observed harness gaps (each proven by an error during bring-up, not speculative):
// Radix Select in jsdom needs pointer-capture stubs ("target.hasPointerCapture is not
// a function"), a PointerEvent constructor, and scrollIntoView. The selector is driven
// via its real keyboard path (Enter to open) because the jsdom pointer path cannot
// complete Radix's pointer-capture flow.
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

/** Synthetic current-contract summary row for whatever year is requested. */
const makeRow = (fiscalYear: number): DashboardSummaryRow => ({
  id: `Epi_1_Year_${fiscalYear}_all`,
  targetTable: 'Epi_1_Year',
  fiscalYear,
  updated_at: '2026-09-01T10:00:00.000Z',
  summaryData: {
    total: 100, view2Coverage: 50, view2Passed: 50,
    view2ApplicableTotal: 100, view2PendingCount: 0,
    view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 0,
    view1Breakdown: [], view2Breakdown: [], facilityBreakdownV1: [], facilityBreakdownV2: [],
  },
});

/** Wire the API mock: usable years per table + synthetic summaries for requested USABLE FYs only. */
function stubApi(tables: Record<string, number[]>) {
  api.fetchApi.mockImplementation(async (action: string, payload?: { fiscalYears?: number[] }) => {
    if (action === 'getDashboardSummaryYears') return { data: { success: true, tables } };
    if (action === 'getDashboardSummariesMultiYear') {
      const requested = payload?.fiscalYears ?? [];
      const usable = new Set(requested.filter(year => (tables.Epi_1_Year ?? []).includes(year) || (tables.Epi_2_Year ?? []).includes(year)));
      // Serve rows only for usable years — never fabricate data for clock-derived non-usable years.
      return { data: { success: true, summaries: requested.filter(year => usable.has(year)).map(makeRow) } };
    }
    if (action === 'getTargetConfig') return { data: {} };
    // Benign total fallback: the vitest runner itself probes the mock with no arguments
    // (observed via call logging — runner internals, not application code).
    return { data: {} };
  });
}

const multiYearCalls = () => api.fetchApi.mock.calls.filter(call => call[0] === 'getDashboardSummariesMultiYear');
const selectedYearsFromCalls = (): number[] => {
  const calls = multiYearCalls();
  return calls.length ? (calls[calls.length - 1][1] as { fiscalYears: number[] }).fiscalYears : [];
};
const chip = (year: number) => screen.queryByRole('button', { name: `ปี ${year}` });

function renderComparison(tables: Record<string, number[]>) {
  stubApi(tables);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearComparison />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchApi.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('#24 interaction — usable-year defaults (Issue #24 §B)', () => {
  it('A: default selection is the latest 2 usable FYs of the age group (not browser-clock FYs)', async () => {
    renderComparison({ Epi_1_Year: [2565, 2566, 2568] });
    await waitFor(() => {
      expect(api.fetchApi).toHaveBeenCalledWith('getDashboardSummariesMultiYear', { fiscalYears: [2566, 2568] });
    });
  });

  it('B: a single usable FY defaults to exactly that year — no fabricated second year', async () => {
    renderComparison({ Epi_1_Year: [2568] });
    await waitFor(() => {
      expect(api.fetchApi).toHaveBeenCalledWith('getDashboardSummariesMultiYear', { fiscalYears: [2568] });
    });
  });

  it('C: no usable years → empty selection, page-level no-data, and no multi-year request', async () => {
    renderComparison({ Epi_1_Year: [] });
    await waitFor(() => {
      expect(api.fetchApi).toHaveBeenCalledWith('getDashboardSummaryYears', {});
    });
    await waitFor(() => {
      expect(screen.getByText(/ไม่มีข้อมูล/)).toBeTruthy();
    });
    expect(multiYearCalls()).toHaveLength(0);
  });
});

describe('#24 interaction — age-group reset (Issue #24 §B/U)', () => {
  it('D: switching the age group through the rendered selector resets to that group’s latest-2 default', async () => {
    renderComparison({ Epi_1_Year: [2565, 2566, 2568], Epi_2_Year: [2564, 2567] });
    await waitFor(() => {
      expect(api.fetchApi).toHaveBeenCalledWith('getDashboardSummariesMultiYear', { fiscalYears: [2566, 2568] });
    });

    // Exercise the real Radix age-group selector via its keyboard path
    // (Enter opens — the jsdom pointer path cannot complete Radix pointer capture).
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'เด็กอายุ 2 ปี' });
    fireEvent.click(option);

    await waitFor(() => {
      expect(api.fetchApi).toHaveBeenCalledWith('getDashboardSummariesMultiYear', { fiscalYears: [2564, 2567] });
    });
  });
});

describe('#24 interaction — max-5 selection cap (Issue #24 §B)', () => {
  it('E: a sixth year cannot join a five-year selection and never silently replaces a selected year', async () => {
    renderComparison({ Epi_1_Year: [2563, 2564, 2565, 2566, 2567, 2568] });
    await waitFor(() => {
      expect(chip(2563)).toBeTruthy(); // chips exist once the usable-year query is reflected in the UI
    });

    // Grow the selection to five years via real chip clicks.
    for (const year of [2563, 2564, 2565]) {
      const button = chip(year);
      expect(button, `chip ปี ${year} must exist`).toBeTruthy();
      fireEvent.click(button!);
    }
    await waitFor(() => {
      expect(selectedYearsFromCalls()).toHaveLength(5);
    });

    // Attempt the sixth year through the real chip.
    const sixth = chip(2566);
    expect(sixth, 'chip ปี 2566 must exist').toBeTruthy();
    fireEvent.click(sixth!);

    // Contract: selection never exceeds 5 and no selected year is silently dropped.
    await waitFor(() => {
      expect(multiYearCalls().every(call => ((call[1] as { fiscalYears: number[] }).fiscalYears ?? []).length <= 5)).toBe(true);
    });
    const finalSelection = selectedYearsFromCalls();
    expect(finalSelection).toHaveLength(5);
    expect(finalSelection).toEqual(expect.arrayContaining([2563, 2564, 2565]));

    // Cap feedback is observable: the sixth chip is disabled OR explicit feedback text exists.
    const disabled = sixth!.hasAttribute('disabled');
    const feedback = /สูงสุด/.test(document.body.textContent ?? '');
    expect(disabled || feedback).toBe(true);
  });
});

describe('#24 interaction — deselect all and query suppression (Issue #24 §J/P3)', () => {
  async function deselectEverything() {
    renderComparison({ Epi_1_Year: [2565, 2566, 2568] });
    await waitFor(() => {
      expect(chip(2565)).toBeTruthy(); // chips exist once the usable-year query is reflected in the UI
    });
    const selected = selectedYearsFromCalls();
    expect(selected.length).toBeGreaterThanOrEqual(2);

    for (const year of selected) {
      const button = chip(year);
      // A selected year must correspond to a rendered usable-year chip; clock-derived
      // selections without chips are exactly the defect this contract forbids.
      expect(button, `selected FY ${year} must have a rendered chip to deselect`).toBeTruthy();
      fireEvent.click(button!);
    }
  }

  it('F: the user can deselect every FY and sees the select-at-least-one prompt — no silent reselect', async () => {
    await deselectEverything();
    await waitFor(() => {
      expect(screen.getByText('กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล')).toBeTruthy();
    });
  });

  it('G: an empty selection never issues a multi-year request with an empty/absent fiscalYears payload', async () => {
    await deselectEverything();
    await waitFor(() => {
      expect(screen.getByText('กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล')).toBeTruthy();
    });
    const emptyPayloadCalls = multiYearCalls().filter(call => {
      const years = (call[1] as { fiscalYears?: number[] } | undefined)?.fiscalYears;
      return !years || years.length === 0;
    });
    expect(emptyPayloadCalls).toHaveLength(0);
  });
});
