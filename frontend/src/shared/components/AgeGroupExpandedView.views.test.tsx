/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgeGroupExpandedView } from './AgeGroupExpandedView';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

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
    'keeps View 2 rule results but offers HDC comparison only in View 1: %s', (ageGroup) => {
      render(<AgeGroupExpandedView summary={summary} fiscalYear={2569}
        ageGroup={ageGroup} quarter="all" />);
      expect(screen.getByText('สัดส่วนตามกฎประเมินภายใน (View 2)')).toBeTruthy();
      expect(screen.getByText('ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 2')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' })).toBeNull();
      expect(screen.queryByRole('button', { name: /ความครอบคลุมรายเข็มจาก HDC/ })).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: 'มุมมองที่ 1 (รายวัคซีน)' }));
      expect(screen.getByRole('button', { name: 'เปรียบเทียบกับ HDC OpenData' })).toBeTruthy();
      expect(screen.getByText('สัดส่วนการได้รับวัคซีนรายชนิด (View 1)')).toBeTruthy();
    },
  );
});
