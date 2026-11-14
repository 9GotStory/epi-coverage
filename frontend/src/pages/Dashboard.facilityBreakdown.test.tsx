/** @vitest-environment jsdom */
/**
 * Issue #200 (#197, ADR-0014) — the Facility Breakdown (CONTEXT.md §57) is shown only to
 * signed-in users.
 *
 * Signed out, the page shows "เข้าสู่ระบบเพื่อดูผลรายหน่วยบริการ" with a sign-in link where
 * the Facility Breakdown would be, in View 1 and View 2, for the whole year and every quarter.
 * The server sends anonymous callers summaries without the Facility Breakdown, and those
 * summaries must still render. Signed in, the Facility Breakdown shows as before.
 *
 * Seam: the real `Dashboard` page with a seeded QueryClient and an AuthContext value.
 * All fixtures are synthetic aggregates; no real facilities or person data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { AuthContext, AuthProvider, useAuth } from '../shared/contexts/AuthContext';
import { fetchApi } from '../shared/lib/api';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryData, DashboardSummaryRow } from '../shared/types/dashboardSummary';

vi.mock('../shared/lib/api', () => ({
  fetchApi: vi.fn(async () => {
    throw new Error('Unexpected network call in Dashboard contract test');
  }),
}));

// Native selects simplify Radix popover interactions (as in Dashboard.fiscalYear.test.tsx).
vi.mock('../shared/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: ReactNode }) => (
    <select value={value ?? ''} onChange={event => onValueChange?.(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => <option value={value}>{children}</option>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const currentYear = getCurrentFiscalYear();
const SIGN_IN_MESSAGE = 'เข้าสู่ระบบเพื่อดูผลรายหน่วยบริการ';

const district = {
  total: 7,
  view1PassedDoses: 9, view1TotalDoses: 12, view1Coverage: 75,
  view1Breakdown: [{ name: 'BCG', passed: 7, total: 7, coverage: 100, metric_key: 'bcg' }],
  view2Passed: 6, view2Coverage: 85.7, view2ApplicableTotal: 7, view2PendingCount: 0,
  view2Breakdown: [{ name: 'BCG', passed: 7, total: 7, coverage: 100, metric_key: 'bcg' }],
};
const facilityBreakdown = {
  facilityBreakdownV1: [{ hoscode: '00001', hosname: 'รพ.สต.ทดสอบหนึ่ง', total: 12, passed: 9, coverage: 75 }],
  facilityBreakdownV2: [{ hoscode: '07002', hosname: 'รพ.สต.ทดสอบสอง', total: 3, passed: 2, coverage: 66.7 }],
};

const row = (quarter: string, summaryData: DashboardSummaryData): DashboardSummaryRow => ({
  id: `Epi_1_Year_${currentYear}_${quarter}`,
  targetTable: 'Epi_1_Year',
  fiscalYear: currentYear,
  updated_at: '2026-11-01T00:00:00.000Z',
  summaryData,
});

/** The anonymous response shape: the server removed the Facility Breakdown keys. */
const anonymous = district as DashboardSummaryData;
const signedInShape = { ...district, ...facilityBreakdown } as DashboardSummaryData;

function renderDashboard(signedIn: boolean, summaryData: DashboardSummaryData) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['dashboardSummaryYears'], { Epi_1_Year: [currentYear] });
  client.setQueryData(['targetConfig'], {});
  client.setQueryData(['dashboardSummaries', currentYear, 'all'], [row('all', summaryData)]);
  client.setQueryData(['dashboardSummaries', currentYear, 1], [row('1', summaryData)]);
  const auth = { user: signedIn ? { role: 'user', hoscode: '00001' } : null } as unknown as React.ContextType<typeof AuthContext>;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

/** Expand the 1-year card and return it; View 2 is the default tab. */
function expandAge1() {
  const age1 = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
  fireEvent.click(within(age1).getByRole('button', { name: /ดูรายละเอียดการประเมิน/ }));
  return age1;
}

function openView1(card: HTMLElement) {
  // Radix Tabs selects on primary mouseDown (not click) in jsdom.
  fireEvent.mouseDown(within(card).getByRole('tab', { name: 'มุมมองที่ 1 (รายวัคซีน)' }), { button: 0 });
}

function expectSignInMessageOnly(card: HTMLElement) {
  expect(within(card).getByRole('link', { name: SIGN_IN_MESSAGE }).getAttribute('href')).toBe('/login');
  expect(within(card).queryByText(/รพ\.สต\.ทดสอบ|ทดสอบหนึ่ง|ทดสอบสอง/)).toBeNull();
  expect(within(card).queryByText('(2/3)')).toBeNull();
  expect(within(card).queryByText('(9/12)')).toBeNull();
}

describe('Issue #200 — signed out, the Facility Breakdown is replaced by a sign-in message', () => {
  it('renders the anonymous summary and shows the message in View 2 and View 1 for the whole year', () => {
    renderDashboard(false, anonymous);
    const card = expandAge1();
    expect(within(card).queryByText(/ยังไม่มีข้อมูลสรุป/)).toBeNull();
    expect(within(card).getByText('85.70')).toBeTruthy();
    expectSignInMessageOnly(card);
    openView1(card);
    expectSignInMessageOnly(card);
  });

  it('shows the message for a quarter as well', () => {
    renderDashboard(false, anonymous);
    const [, quarterSelect] = screen.getAllByRole('combobox');
    fireEvent.change(quarterSelect, { target: { value: '1' } });
    const card = expandAge1();
    expectSignInMessageOnly(card);
    openView1(card);
    expectSignInMessageOnly(card);
  });

  it('never shows Facility rows while signed out, even if a summary still carries them', () => {
    renderDashboard(false, signedInShape);
    const card = expandAge1();
    expectSignInMessageOnly(card);
    openView1(card);
    expectSignInMessageOnly(card);
  });
});

describe('Issue #200 — signed in, the Facility Breakdown shows as before', () => {
  it('lists every Facility with its counts in View 2 and View 1', () => {
    renderDashboard(true, signedInShape);
    const card = expandAge1();
    expect(within(card).queryByText(SIGN_IN_MESSAGE)).toBeNull();
    expect(within(card).getByText('(2/3)')).toBeTruthy();
    openView1(card);
    expect(within(card).getByText('(9/12)')).toBeTruthy();
    expect(within(card).queryByText(SIGN_IN_MESSAGE)).toBeNull();
  });

  it('shows the district figures and an empty Facility list, not the sign-in message, for a summary without a Facility Breakdown', () => {
    renderDashboard(true, anonymous);
    const card = expandAge1();
    expect(within(card).queryByText(/ยังไม่มีข้อมูลสรุป/)).toBeNull();
    expect(within(card).queryByText(SIGN_IN_MESSAGE)).toBeNull();
    expect(within(card).getAllByText('ยังไม่มีหน่วยบริการในกลุ่มนี้').length).toBeGreaterThan(0);
  });
});

// The same in-memory stand-in as LoginScreen.sessionEnd.test.tsx.
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

function SignOutButton() {
  const { logout } = useAuth();
  return <button type="button" onClick={() => logout()}>sign out</button>;
}

describe('Issue #200 — Sign-out on an open dashboard', () => {
  it('fetches the summaries again without a token and shows no Facility rows', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem('user', JSON.stringify({ id: 'u1', role: 'user', status: 'approved', hoscode: '00001' }));
    localStorage.setItem('token', 'synthetic-token-0200');
    const calls: { action: string; token: string | null }[] = [];
    vi.mocked(fetchApi).mockImplementation(async (action: string) => {
      calls.push({ action, token: localStorage.getItem('token') });
      if (action === 'getDashboardSummaries') return { data: { success: true, summaries: [row('all', anonymous)] } };
      if (action === 'getDashboardSummaryYears') return { data: { success: true, tables: { Epi_1_Year: [currentYear] } } };
      return { data: { success: true } };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['dashboardSummaryYears'], { Epi_1_Year: [currentYear] });
    client.setQueryData(['targetConfig'], {});
    client.setQueryData(['dashboardSummaries', currentYear, 'all'], [row('all', signedInShape)]);
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter>
            <SignOutButton />
            <Dashboard />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(within(expandAge1()).getByText('(2/3)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(calls).toContainEqual({ action: 'getDashboardSummaries', token: null }));
    expect(calls.filter(call => call.action === 'getDashboardSummaries' && call.token !== null)).toEqual([]);
    const card = await waitFor(() => {
      const section = screen.getByText('ภาพรวมเด็กอายุครบ 1 ปี').closest('section')!;
      expect(within(section).getByText('85.70')).toBeTruthy();
      return section;
    });
    expect(client.getQueryData(['dashboardSummaries', currentYear, 'all'])).toEqual([row('all', anonymous)]);
    expect(within(card).queryByText('(2/3)')).toBeNull();
  });
});
