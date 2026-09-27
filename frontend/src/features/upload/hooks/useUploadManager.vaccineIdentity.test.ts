// @vitest-environment jsdom
/**
 * Issue #26 RED contracts — actual summary-writer integration.
 *
 * Exercises the REAL `handleSyncAll` path (rules fetch → evaluators →
 * calcGroupSummary → saveDashboardSummary) with only external boundaries
 * mocked (`fetchApi`, `sonner`). The production summary call path does not
 * pass snapshot-time rules into calcGroupSummary (the Issue #26 locked seam),
 * so saved `summaryData` breakdown entries today lack metric_key/vaccine_group
 * — that absence is the intended RED.
 *
 * The hook's default fiscal year is derived at runtime (2026-09 → '2569'); the
 * synthetic record's birth is chosen inside that year's age-1 'all' AND Q1
 * (Oct–Dec 2024) birth ranges so annual + quarter summaries both see it. No
 * calcGroupSummary logic is duplicated here — the real one runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useUploadManager } from './useUploadManager';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock('../../../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Synthetic snapshot-time rules with forward identity fields (test-only widening). */
function v1Rule(metricKey: string): VaccineRule {
  return {
    rule_id: 'live-v1', fiscal_year: 2569, age_group: '1yr', view_type: 1,
    vaccine_group: 'BCG', display_name: 'BCG วัคซีน', hdc_code: '010',
    required_fields: ['bcg_date'], branch_alt_fields: [], logic_type: 'ALL',
    is_required_for_v2: true, is_active: true, target_age_months: 0, metric_key: metricKey,
  } as unknown as VaccineRule;
}
function v2Rule(metricKey: string): VaccineRule {
  return {
    rule_id: metricKey || 'legacy-rule-x', fiscal_year: 2569, age_group: '1yr', view_type: 2,
    vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010',
    required_fields: ['bcg_date'], branch_alt_fields: [], logic_type: 'ALL',
    is_required_for_v2: true, is_active: true, target_age_months: 0, metric_key: metricKey,
  } as unknown as VaccineRule;
}

/** One synthetic record: birth inside FY2569 age-1 'all' AND Q1 (Oct–Dec 2024) ranges; passes the BCG rule. */
const syntheticRecord = { hoscode: '06413', hosname: 'บ้านหนุน', birth: '2024-11-15', bcg_date: '2024-11-20', sex: 'หญิง' };

interface SaveCall { targetTable: string; fiscalYear: number; quarter: string | number; summaryData: string }

function stubApi({ rules }: { rules: VaccineRule[] }) {
  const saved: SaveCall[] = [];
  api.fetchApi.mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
    if (action === 'getEpiData') {
      return { data: payload?.targetTable === 'Epi_1_Year' ? [syntheticRecord] : [] };
    }
    if (action === 'getVaccineRules') {
      return { data: payload?.ageGroup === '1yr' ? rules : [] };
    }
    if (action === 'saveDashboardSummary') {
      saved.push(payload as unknown as SaveCall);
      return { data: { success: true } };
    }
    return { data: {} };
  });
  return saved;
}

async function runSyncAll(rules: VaccineRule[]): Promise<SaveCall[]> {
  const saved = stubApi({ rules });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // JSX is avoided deliberately: the Issue #26 plan pins this file's .ts extension.
  const wrapper = ({ children }: { children?: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useUploadManager(), { wrapper });
  await act(async () => { await result.current.handleSyncAll(); });
  return saved;
}

const annualFor = (saved: SaveCall[]) => {
  const annual = saved.find(call => call.targetTable === 'Epi_1_Year' && call.quarter === 'all');
  expect(annual, 'harness validity: the real path must save an Epi_1_Year annual summary').toBeTruthy();
  return JSON.parse(annual!.summaryData);
};

beforeEach(() => { api.fetchApi.mockReset(); });
afterEach(() => { cleanup(); });

describe('#26 — writer integration (RED)', () => {
  it('C1/C4: the real saved annual summary carries metric_key + vaccine_group for BOTH views', async () => {
    const saved = await runSyncAll([v1Rule('v1-bcg'), v2Rule('v2-bcg')]);
    const annual = annualFor(saved);
    const v1 = annual.view1Breakdown.find((e: { name: string }) => e.name === 'BCG วัคซีน');
    const v2 = annual.view2Breakdown.find((e: { name: string }) => e.name === 'BCG 1 เข็ม');
    expect(v1?.metric_key).toBe('v1-bcg');
    expect(v1?.vaccine_group).toBe('BCG');
    expect(v2?.metric_key).toBe('v2-bcg');
    expect(v2?.vaccine_group).toBe('BCG');
  });

  it('C2: quarter summaries written by the same path persist identity too', async () => {
    const saved = await runSyncAll([v1Rule('v1-bcg'), v2Rule('v2-bcg')]);
    const quarter = saved.find(call => call.targetTable === 'Epi_1_Year' && call.quarter !== 'all');
    expect(quarter, 'harness validity: at least one quarter summary must be saved for Epi_1_Year').toBeTruthy();
    const parsed = JSON.parse(quarter!.summaryData);
    const entries = [...(parsed.view1Breakdown ?? []), ...(parsed.view2Breakdown ?? [])] as Array<{ metric_key?: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => typeof entry.metric_key === 'string' && entry.metric_key.length > 0)).toBe(true);
  });

  it('C3: an empty API metric_key persists the effective rule_id in the saved summary — never empty', async () => {
    const saved = await runSyncAll([v1Rule('v1-bcg'), v2Rule('')]);
    const annual = annualFor(saved);
    const v2 = annual.view2Breakdown.find((e: { name: string }) => e.name === 'BCG 1 เข็ม');
    expect(v2?.metric_key).toBe('legacy-rule-x');
  });
});
