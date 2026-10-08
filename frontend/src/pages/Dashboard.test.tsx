/**
 * Issue #23 RED contracts — Dashboard "ยังไม่ผ่านเกณฑ์" correctness.
 *
 * Current behavior (the defect): Dashboard.tsx renders the View 2 missed count as
 * `summary.total - summary.view2Passed` — the COHORT total minus passed — while
 * `view2Coverage` is computed over the *applicable* denominator. That mixes two
 * populations on one card.
 *
 * Ticket #23 contract:
 *   - I1: for a current-contract summary (with `view2ApplicableTotal`), the
 *     missed/failed value shown must be `view2ApplicableTotal - view2Passed`
 *     (e.g. 7 - 5 = 2), never `total - view2Passed` (10 - 5 = 5).
 *   - I2: for a legacy summary lacking the denominator fields, the value must be
 *     unavailable (e.g. `—` or repository-consistent wording) — never derived as
 *     `total - view2Passed`.
 *
 * Seam: the real `Dashboard` page rendered with a seeded QueryClient (repo
 * convention) — behavior observed from rendered markup, not source text.
 * All fixtures are synthetic aggregate summaries.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryData, DashboardSummaryRow } from '../shared/types/dashboardSummary';

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('network is disabled in Dashboard contract tests');
  }),
}));

const currentYear = getCurrentFiscalYear();

/** Capture the rendered "ยังไม่ผ่านเกณฑ์" values, one per age-group section (JSX order: 1ปี, 2ปี, 3ปี, 5ปี). */
const missedValuesFrom = (html: string): string[] =>
  [...html.matchAll(/ยังไม่ผ่านเกณฑ์\s*<strong[^>]*>([^<]+)<\/strong>/g)].map(match => match[1].trim());

const renderDashboardWith = (summaryData: DashboardSummaryData): string => {
  const client = new QueryClient();
  const row: DashboardSummaryRow = {
    id: `Epi_1_Year_${currentYear}_all`,
    targetTable: 'Epi_1_Year',
    fiscalYear: currentYear,
    summaryData,
    updated_at: '2026-09-01T00:00:00.000Z',
  };
  client.setQueryData(['dashboardSummaryYears'], { Epi_1_Year: [currentYear] });
  client.setQueryData(['dashboardSummaries', currentYear, 'all'], [row]);
  client.setQueryData(['targetConfig'], {});
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Field set both summary generations provide (synthetic, View 1 neutral). */
const baseSummary = {
  total: 10,
  view1Coverage: 0,
  view1PassedDoses: 0,
  view1TotalDoses: 0,
  view1Breakdown: [],
  view2Breakdown: [],
  facilityBreakdownV1: [],
  facilityBreakdownV2: [],
};

describe('Issue #23 — Dashboard "ยังไม่ผ่านเกณฑ์" value correctness', () => {
  it('I1: current-contract summary shows the applicable-based missed count (7 - 5 = 2), not total - passed (5)', () => {
    const html = renderDashboardWith({
      ...baseSummary,
      view2Coverage: 71.43,
      view2Passed: 5,
      view2ApplicableTotal: 7,
      view2PendingCount: 3,
    });

    const missed = missedValuesFrom(html);
    expect(missed.length).toBeGreaterThan(0);
    // First section = เด็กอายุ 1 ปี (the seeded table). Contract: applicable − passed.
    expect(missed[0]).toBe('2');
  });

  it('I2: legacy summary without denominator fields shows an unavailable value, never total - view2Passed', () => {
    const html = renderDashboardWith({
      ...baseSummary,
      view2Coverage: 50,
      view2Passed: 5,
      // legacy row: no view2ApplicableTotal / view2PendingCount
    });

    const missed = missedValuesFrom(html);
    expect(missed.length).toBeGreaterThan(0);
    // Tolerant to the exact unavailable wording (— or Thai), but a derived NUMBER
    // (today: 10 - 5 = "5") is forbidden — pending records must not be counted as missed.
    expect(missed[0]).not.toMatch(/^\d/);
  });
});
