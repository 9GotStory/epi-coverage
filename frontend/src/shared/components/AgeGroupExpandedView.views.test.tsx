/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgeGroupExpandedView } from './AgeGroupExpandedView';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

// The View 2 HDC panel (Issue #186) queries only when opened; these tests keep it collapsed.
vi.mock('../lib/api', () => ({ fetchApi: vi.fn() }));
function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

vi.mock('../hooks/useTargetSettings', () => ({
  useTargetSettings: () => ({ getTarget: () => undefined }),
}));
vi.mock('../hooks/useVaccineRules', () => ({
  useVaccineRules: () => ({ rules: [], isLoading: false, error: null }),
}));
vi.mock('./HdcAgeAnnualComparison', () => ({
  HdcAgeAnnualComparison: () => <button type="button">เปรียบเทียบกับ HDC OpenData</button>,
}));

afterEach(cleanup);

const summary: LegacyCompatibleGroupSummary = {
  total: 20,
  view1PassedDoses: 16,
  view1TotalDoses: 20,
  view1Coverage: 80,
  view1Breakdown: [
    { name: 'BCG', passed: 16, total: 20, coverage: 80, metric_key: 'bcg' },
  ],
  facilityBreakdownV1: [],
  view2Passed: 10,
  view2Coverage: 50,
  view2ApplicableTotal: 20,
  view2PendingCount: 0,
  view2Breakdown: [
    { name: 'BCG', passed: 10, total: 20, coverage: 50, metric_key: 'bcg' },
  ],
  facilityBreakdownV2: [],
};

describe('age-group dashboard views have distinct responsibilities', () => {
  it.each(['1yr', '2yr', '3yr', '5yr'])(
    'keeps View 2 rule results with the HDC Fully Immunized panel, and the per-dose HDC comparison only in View 1: %s', (ageGroup) => {
      render(<AgeGroupExpandedView summary={summary} fiscalYear={2569}
        ageGroup={ageGroup} quarter="all" />);
      expect(screen.getByText('ผลการประเมินวัคซีนครบชุด')).toBeTruthy();
      expect(screen.getByText('ความครอบคลุมวัคซีนครบชุด แยกตามหน่วยบริการ')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'ความครอบคลุมตาม HDC (Fully Immunized)' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' })).toBeNull();
      expect(screen.queryByRole('button', { name: /ความครอบคลุมรายเข็มจาก HDC/ })).toBeNull();

      // Radix Tabs selects on primary mouseDown (not click) in jsdom.
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'มุมมองที่ 1 (รายวัคซีน)' }), { button: 0 });
      expect(screen.getByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'ความครอบคลุมตาม HDC (Fully Immunized)' })).toBeNull();
      expect(screen.getByText('ผลการประเมินวัคซีนรายเข็ม')).toBeTruthy();
    },
  );

  it.each([1, 2, 3, 4] as const)(
    'offers the annual HDC Fully Immunized panel only for the whole fiscal year, not quarter %s', (quarter) => {
      render(<AgeGroupExpandedView summary={summary} fiscalYear={2569} ageGroup="1yr" quarter={quarter} />);
      expect(screen.getByText('ผลการประเมินวัคซีนครบชุด')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'ความครอบคลุมตาม HDC (Fully Immunized)' })).toBeNull();
    },
  );
});

describe('Issue #89 — View 2 breakdown shows its denominator and ประเมินไม่ได้ states', () => {
  it('renders (passed/total) next to every View 2 rule percentage', () => {
    render(<AgeGroupExpandedView summary={summary} fiscalYear={2569} ageGroup="1yr" quarter="all" />);
    expect(screen.getByText('(10/20)')).toBeTruthy();
    expect(screen.getByText('50.0%')).toBeTruthy();
  });

  it('announces unevaluable children separately from coverage (data-quality, not chase list)', () => {
    render(<AgeGroupExpandedView summary={{ ...summary, view2NotEvaluableCount: 5 }} fiscalYear={2569} ageGroup="1yr" quarter="all" />);
    expect(screen.getByText('ข้อมูลไม่ครบตามเกณฑ์ 5 คน ประเมิน Fully Immunized ไม่ได้ จึงไม่รวมในการคำนวณร้อยละ')).toBeTruthy();
  });

  it('renders a rule with denominator 0 as ยังประเมินไม่ได้ instead of 0.0%', () => {
    const blocked: LegacyCompatibleGroupSummary = {
      ...summary,
      view2Breakdown: [{ name: 'MMR เข็ม 1', passed: 0, total: 0, coverage: 0, metric_key: 'mmr1' }],
    };
    render(<AgeGroupExpandedView summary={blocked} fiscalYear={2569} ageGroup="1yr" quarter="all" />);
    expect(screen.getByText('ยังประเมินไม่ได้')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
  });
});

describe('Issue #102 — ตรวจสอบประวัติ is announced apart from coverage', () => {
  it('announces children whose only problem is a date warning in View 2', () => {
    render(<AgeGroupExpandedView summary={{ ...summary, view2ReviewCount: 4 }} fiscalYear={2569} ageGroup="1yr" quarter="all" />);
    expect(screen.getByText('ตรวจสอบประวัติ 4 คน (วันที่ผิดปกติ ไม่ใช่วัคซีนขาด) จึงไม่รวมในการคำนวณร้อยละ')).toBeTruthy();
  });

  it('announces dose rules with only a date warning in View 1', () => {
    render(<AgeGroupExpandedView summary={{ ...summary, view1ReviewDoses: 3 }} fiscalYear={2569} ageGroup="1yr" quarter="all" />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'มุมมองที่ 1 (รายวัคซีน)' }), { button: 0 });
    expect(screen.getByText('ตรวจสอบประวัติ 3 รายการ (วันที่ผิดปกติ ไม่ใช่วัคซีนขาด) จึงไม่รวมในการคำนวณร้อยละ')).toBeTruthy();
  });
});
