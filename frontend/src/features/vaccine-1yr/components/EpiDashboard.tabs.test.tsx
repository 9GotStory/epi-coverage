/** @vitest-environment jsdom */
/**
 * Public EPI age-group navigation: only the two individual-record views are
 * accessible. Removing the OpenData UI must not remove or alter backend data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EpiDashboard } from './EpiDashboard';
import { EpiDashboard2Yr } from '../../vaccine-2yr/components/EpiDashboard2Yr';
import { EpiDashboard3Yr } from '../../vaccine-3yr/components/EpiDashboard3Yr';
import { EpiDashboard5Yr } from '../../vaccine-5yr/components/EpiDashboard5Yr';

vi.mock('../../../widgets/layout/SubNav', () => ({
  SubNav: () => null,
}));
vi.mock('../../../shared/hooks/useEpiData', () => ({
  useEpiData: () => ({ data: [], isLoading: false, error: null, asOfDate: undefined }),
}));
vi.mock('../../../shared/hooks/useAvailableYears', () => ({
  useAvailableYears: () => ({ years: [] }),
}));
vi.mock('../../../shared/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
vi.mock('../../../shared/components/HdcRecordsView', () => ({
  HdcRecordsView: () => <div data-testid="individual-view-2">Fully Immunized individual records</div>,
}));
vi.mock('./View1Individual', () => ({
  View1Individual: () => <div data-testid="individual-view-1">Individual vaccine records</div>,
}));
vi.mock('../../vaccine-2yr/components/View1Individual2Yr', () => ({
  View1Individual2Yr: () => <div data-testid="individual-view-1">Individual vaccine records</div>,
}));
vi.mock('../../vaccine-3yr/components/View1Individual3Yr', () => ({
  View1Individual3Yr: () => <div data-testid="individual-view-1">Individual vaccine records</div>,
}));
vi.mock('../../vaccine-5yr/components/View1Individual5Yr', () => ({
  View1Individual5Yr: () => <div data-testid="individual-view-1">Individual vaccine records</div>,
}));

afterEach(() => cleanup());

describe.each([
  ['1 year', EpiDashboard],
  ['2 years', EpiDashboard2Yr],
  ['3 years', EpiDashboard3Yr],
  ['5 years', EpiDashboard5Yr],
])('EPI Tracking %s', (_label, Page) => {
  it('exposes only individual vaccine and Fully Immunized views', () => {
    render(<Page />);

    const view1 = screen.getByRole('button', { name: 'มุมมองที่ 1 (รายชนิดวัคซีน)' });
    const view2 = screen.getByRole('button', { name: 'มุมมองที่ 2 (Fully Immunized)' });
    expect(view1).toBeTruthy();
    expect(view2).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ภาพรวม (OpenData)' })).toBeNull();
    expect(screen.queryByText('รายชนิดวัคซีน (View 1)')).toBeNull();
    expect(screen.queryByText('รับวัคซีนครบชุด (View 2)')).toBeNull();

    expect(screen.getByTestId('individual-view-1')).toBeTruthy();
    fireEvent.click(view2);
    expect(screen.getByTestId('individual-view-2')).toBeTruthy();
    expect(screen.queryByTestId('individual-view-1')).toBeNull();
    fireEvent.click(view1);
    expect(screen.getByTestId('individual-view-1')).toBeTruthy();
  });
});
