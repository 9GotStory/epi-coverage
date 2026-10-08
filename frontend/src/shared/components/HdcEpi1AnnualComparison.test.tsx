/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { HdcEpi1AnnualComparison } from './HdcEpi1AnnualComparison';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

vi.mock('../lib/api', () => ({ fetchApi: vi.fn() }));

const rule: VaccineRule = {
  rule_id: 'fixture-bcg', fiscal_year: 2569, age_group: '1yr', view_type: 1,
  vaccine_group: 'BCG', display_name: 'BCG', hdc_code: '010',
  required_fields: ['bcg_date'], logic_type: 'ALL', is_active: true,
  is_required_for_v2: true,
};
const summary: LegacyCompatibleGroupSummary = {
  total: 181, view1PassedDoses: 178, view1TotalDoses: 181,
  view1Coverage: 178 / 181 * 100,
  view1Breakdown: [{ name: 'BCG', passed: 178, total: 181, coverage: 178/181*100, metric_key:'fixture-bcg' }],
  facilityBreakdownV1: [],
  view2Passed: 0, view2Coverage: 0, view2Breakdown: [], facilityBreakdownV2: [],
  view2ApplicableTotal: 181, view2PendingCount: 0,
};

function upstreamRow() {
  const fields: Record<string, unknown> = {
    id:'c88658f4d09acb8c76e6c06ffb58ebaf',
    b_year:'2569', hospcode:'06413', areacode:'54060101', date_com:'20261007231223',
  };
  for (const m of ['10','11','12','01','02','03','04','05','06','07','08','09']) {
    fields[`target${m}`] = 0;
    for (const v of ['bcg','dtp1','dtp2']) fields[`${v}_${m}`] = 0;
  }
  return { ...fields, target10:100, target11:81, bcg_10:99, bcg_11:81, dtp1_10:98, dtp1_11:80, dtp2_10:99, dtp2_11:80 };
}

function mount(data: LegacyCompatibleGroupSummary = summary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HdcEpi1AnnualComparison fiscalYear={2569} summary={data} rules={[rule]} />
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('HDC reference is optional, provenance-specific UI', () => {
  it('does not request HDC until expanded, then shows the separate numerators without replacing EPI values', async () => {
    vi.mocked(fetchApi).mockResolvedValue({
      status: 200, data: { statusCode: 200, data: [upstreamRow()], isFromCache: true },
    });
    mount();
    expect(fetchApi).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('99.45%')).toBeTruthy();
    expect(screen.getByText('98.34%')).toBeTruthy();
    expect(screen.getByText('180/181')).toBeTruthy();
    expect(screen.getByText('178/181')).toBeTruthy();
    expect(fetchApi).toHaveBeenCalledWith('getOpenData', { payload: { tableName: 's_epi1', year: '2569' } });
  });

  it('preserves HDC and EPI counts but forbids a comparable gap if population totals differ', async () => {
    vi.mocked(fetchApi).mockResolvedValue({ status: 200, data: { statusCode: 200, data: [upstreamRow()] } });
    mount({ ...summary, total: 180 });
    fireEvent.click(screen.getByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' }));
    expect(await screen.findByText('เทียบไม่ได้')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/จำนวนเด็กเป้าหมายไม่ตรงกัน/);
    expect(screen.getByText('180/181')).toBeTruthy();
    expect(screen.getByText('178/181')).toBeTruthy();
  });

  it('shows upstream errors independently without fabricating a reference percentage', async () => {
    vi.mocked(fetchApi).mockResolvedValue({ status: 200, data: { statusCode: 503, error: 'upstream failure' } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/ไม่สามารถเปรียบเทียบกับ HDC ได้/);
    expect(screen.queryByText('99.45%')).toBeNull();
  });
});
