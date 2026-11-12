// @vitest-environment jsdom
/**
 * Issue #130 — the Rules Engine names each dose column unambiguously: the Same-Day/Ordered Pair
 * picker and the review page use the same label as the date warnings, so the FY2569 Rota and
 * LAJE/JE rules (which span several columns each) no longer give several columns one name.
 *
 * Seam: `VaccineRuleManager` with its rules served from the query cache — open a rule, read the pair
 * picker, change a pair, save the draft and open the review page.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { VaccineRuleManager } from './VaccineRuleManager';
import { AuthContext } from '../../../shared/contexts/AuthContext';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));
// jsdom has no ResizeObserver; the Radix Switch/Select in the rule form measure themselves with it.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const fiscalYear = getCurrentFiscalYear();
const noChecks = { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] };
const rule = (overrides: Partial<VaccineRule> & Pick<VaccineRule, 'rule_id' | 'display_name' | 'required_fields'>): VaccineRule => ({
  fiscal_year: fiscalYear, age_group: '1yr', view_type: 1, vaccine_group: 'X', hdc_code: '', logic_type: 'BRANCH',
  is_required_for_v2: true, is_active: true, target_age_months: 2, date_checks: noChecks, ...overrides,
});
// FY2569 shape: the Rota and LAJE/JE rules span several columns each.
const rules = [
  rule({ rule_id: 'rota-1', display_name: 'Rota เข็ม 1', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'] }),
  rule({
    rule_id: 'rota-full', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'],
    date_checks: { ...noChecks, same_day_pairs: [{ field: 'rv21_date', other_field: 'rv22_date' }, { field: 'rv32_date', other_field: 'rv33_date' }] },
  }),
  rule({ rule_id: 'laje-je', display_name: 'LAJE/JE 1 ปี', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], target_age_months: 12 }),
];

const renderManager = () => {
  const client = new QueryClient();
  client.setQueryData(['vaccineRules', fiscalYear, '1yr'], rules);
  client.setQueryData(['availableYears'], [fiscalYear]);
  const auth = { user: { role: 'admin' } } as unknown as React.ContextType<typeof AuthContext>;
  const router = createMemoryRouter([{ path: '/', element: <VaccineRuleManager /> }]);
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}><RouterProvider router={router} /></AuthContext.Provider>
    </QueryClientProvider>,
  );
};
const openRule = (name: string) => {
  const row = screen.getByText(name).closest('tr')!;
  fireEvent.click(within(row).getByRole('button'));
  return within(screen.getByRole('dialog'));
};
const optionLabels = (select: HTMLElement) => Object.fromEntries([...(select as HTMLSelectElement).options].map(option => [option.value, option.textContent]));

afterEach(cleanup);

describe('Issue #130 — Rules Engine dose labels', () => {
  it('the pair picker labels each Rota and JE/LAJE column distinctly', () => {
    renderManager();
    const labels = optionLabels(openRule('Rota (ครบถ้วนตามเกณฑ์)').getByLabelText('ห้ามบันทึกวันเดียวกัน 1 เข็มแรก'));
    expect(labels).toMatchObject({
      rv21_date: 'Rota ชนิด 2 เข็ม — เข็ม 1 (rv21_date)',
      rv22_date: 'Rota ชนิด 2 เข็ม — เข็ม 2 (rv22_date)',
      rv31_date: 'Rota ชนิด 3 เข็ม — เข็ม 1 (rv31_date)',
      rv32_date: 'Rota ชนิด 3 เข็ม — เข็ม 2 (rv32_date)',
      rv33_date: 'Rota ชนิด 3 เข็ม — เข็ม 3 (rv33_date)',
      j11_date: 'LAJE เข็ม 1 (j11_date)',
      je1_date: 'JE เข็ม 1 (je1_date)',
      je2_date: 'JE เข็ม 2 (je2_date)',
    });
  });

  // Renders the whole manager plus the rule form, so it needs more than the default 5 s under a full-suite load.
  it('the review page names a changed pair with the same labels', { timeout: 15_000 }, async () => {
    renderManager();
    const dialog = openRule('Rota (ครบถ้วนตามเกณฑ์)');
    fireEvent.change(dialog.getByLabelText('ห้ามบันทึกวันเดียวกัน 2 เข็มที่เปรียบเทียบ'), { target: { value: 'rv31_date' } });
    fireEvent.click(dialog.getByRole('button', { name: 'ตกลง (บันทึกฉบับร่าง)' }));
    // The page stays aria-hidden while the rule dialog is open.
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขทั้งหมด (Batch Save)' }));
    const review = screen.getByText('ยืนยันการบันทึกการเปลี่ยนแปลง').closest('div')!.parentElement!;
    expect(within(review).getByTitle(/^ตรวจฉีดก่อนวันเกิด.*Rota ชนิด 3 เข็ม — เข็ม 2 กับ Rota ชนิด 3 เข็ม — เข็ม 3;/)).toBeTruthy();
    expect(within(review).getByTitle(/^ตรวจฉีดก่อนวันเกิด.*Rota ชนิด 2 เข็ม — เข็ม 1 กับ Rota ชนิด 2 เข็ม — เข็ม 2, Rota ชนิด 3 เข็ม — เข็ม 2 กับ Rota ชนิด 3 เข็ม — เข็ม 1;/)).toBeTruthy();
  });
});
