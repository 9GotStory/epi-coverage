// @vitest-environment jsdom
/**
 * Issue #148 — staff add and delete a Vaccine Rule on the Rules Engine page. Both go into the draft
 * and through the review-then-confirm Batch Save, which names every deletion in `deleted_rule_ids`.
 *
 * Seam: `VaccineRuleManager` with its rules served from the query cache and the API client mocked.
 * Observations are what the admin sees and what the page sends to the server.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { VaccineRuleManager } from './VaccineRuleManager';
import { AuthContext } from '../../../shared/contexts/AuthContext';
import { fetchApi } from '../../../shared/lib/api';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));
// jsdom has no ResizeObserver; the Radix Switch/Select in the rule form measure themselves with it.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const fiscalYear = getCurrentFiscalYear();
const noChecks = { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] };
const rule = (overrides: Partial<VaccineRule> & Pick<VaccineRule, 'rule_id' | 'display_name' | 'required_fields'>): VaccineRule => ({
  fiscal_year: fiscalYear, age_group: '1yr', view_type: 1, vaccine_group: 'X', hdc_code: '', logic_type: 'ALL',
  is_required_for_v2: true, is_active: true, date_checks: noChecks, ...overrides,
});
const peers = [
  rule({ rule_id: 'hbv1', display_name: 'HBV เข็ม 1', vaccine_group: 'HBV', required_fields: ['hbv1_date'], target_age_months: 0 }),
  rule({ rule_id: 'dtp1', display_name: 'DTP เข็ม 1', vaccine_group: 'DTP', required_fields: ['dtp1_date'], target_age_months: 2 }),
];
// The backend default map (TARGET_AGE_MONTHS_BY_FIELD) answers through suggestRuleTargetAges; a stand-in for the columns used here.
const suggestedAge: Record<string, number> = { hbv4_date: 4, hbv3_date: 6 };

const mockApi = () => {
  vi.mocked(fetchApi).mockImplementation(async (action: string, body?: any) => {
    if (action === 'suggestRuleTargetAges') {
      return { data: { suggestions: body.rules.map((r: VaccineRule) => ({
        rule_id: r.rule_id,
        target_age_months: r.required_fields.map(f => suggestedAge[f]).find(age => age !== undefined) ?? null,
      })) } };
    }
    if (action === 'batchSaveRules') return { data: { success: true, saved_count: body.rules.length } };
    throw new Error(`unexpected ${action}`);
  });
};

const renderManager = (rules: VaccineRule[] = peers) => {
  mockApi();
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

const openNewRule = () => {
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเกณฑ์' }));
  return within(screen.getByRole('dialog'));
};
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const fillNewRule = (dialog: ReturnType<typeof within>, column: string) => {
  type(dialog.getByLabelText('ชื่อแสดงผล (Display Name)'), 'HBV เข็มใหม่');
  type(dialog.getByLabelText('กลุ่มวัคซีน (Vaccine Group)'), 'HBV');
  type(dialog.getByPlaceholderText('เช่น rv21_date'), column);
};
const targetAge = (dialog: ReturnType<typeof within>) => dialog.getByLabelText('อายุเป้าหมาย (เดือน)') as HTMLInputElement;
const pairValue = (dialog: ReturnType<typeof within>, label: string) => (dialog.getByLabelText(label) as HTMLSelectElement).value;
// The Target Age suggestion resolves outside act(); let React run the effects of that render before the
// next interaction, as it always has by the time a person clicks.
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
const submitDraft = async (dialog: ReturnType<typeof within>) => {
  fireEvent.click(dialog.getByRole('button', { name: 'ตกลง (บันทึกฉบับร่าง)' }));
  // The page stays aria-hidden while the rule dialog is open.
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};
const openReview = () => {
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขทั้งหมด (Batch Save)' }));
  return within(screen.getByText('ยืนยันการบันทึกการเปลี่ยนแปลง').closest('div')!.parentElement!);
};

afterEach(() => {
  cleanup();
  vi.mocked(fetchApi).mockReset();
});

describe('Issue #148 — adding a Vaccine Rule', () => {
  it('offers the add action only when the Age Group already has rules', () => {
    renderManager([]);
    expect(screen.queryByRole('button', { name: 'เพิ่มเกณฑ์' })).toBeNull();
    cleanup();
    renderManager();
    expect(screen.getByRole('button', { name: 'เพิ่มเกณฑ์' })).toBeTruthy();
  });

  it('prefills Target Age with the suggestion, and date checks from peer rules that follow the columns', { timeout: 15_000 }, async () => {
    renderManager();
    const dialog = openNewRule();
    fillNewRule(dialog, 'hbv4_date');
    await vi.waitFor(() => expect(targetAge(dialog).value).toBe('4'));
    // HBV 1 (0 months) is a peer: a same-day pair and an ordered pair with the new 4-month dose.
    // The ordered pair needs the new rule's Target Age, which arrives with the suggestion.
    await vi.waitFor(() => expect(pairValue(dialog, 'ลำดับวันที่ฉีด 1 เข็มที่เปรียบเทียบ')).toBe('hbv4_date'));
    expect(pairValue(dialog, 'ลำดับวันที่ฉีด 1 เข็มแรก')).toBe('hbv1_date');
    expect(pairValue(dialog, 'ห้ามบันทึกวันเดียวกัน 1 เข็มแรก')).toBe('hbv1_date');
    expect(pairValue(dialog, 'ห้ามบันทึกวันเดียวกัน 1 เข็มที่เปรียบเทียบ')).toBe('hbv4_date');

    type(dialog.getByPlaceholderText('เช่น rv21_date'), 'hbv3_date');
    await vi.waitFor(() => expect(targetAge(dialog).value).toBe('6'));
    await vi.waitFor(() => expect(pairValue(dialog, 'ห้ามบันทึกวันเดียวกัน 1 เข็มที่เปรียบเทียบ')).toBe('hbv3_date'));

    // Once the admin edits the date checks, column changes no longer overwrite them.
    await settle();
    fireEvent.click(dialog.getAllByRole('button', { name: 'ลบคู่เข็ม' })[0]);
    fireEvent.click(dialog.getByRole('button', { name: 'เพิ่มฟิลด์' }));
    type(dialog.getAllByPlaceholderText('เช่น rv21_date')[1], 'hbv4_date');
    await vi.waitFor(() => expect(fetchApi).toHaveBeenLastCalledWith('suggestRuleTargetAges', { rules: [expect.objectContaining({ required_fields: ['hbv3_date', 'hbv4_date'] })] }));
    await settle();
    // A recomputation would add same-day pairs for hbv4_date; the admin's choice stays as edited.
    expect(dialog.queryByLabelText('ห้ามบันทึกวันเดียวกัน 1 เข็มแรก')).toBeNull();
    expect(pairValue(dialog, 'ลำดับวันที่ฉีด 1 เข็มแรก')).toBe('hbv1_date');
    expect(pairValue(dialog, 'ลำดับวันที่ฉีด 1 เข็มที่เปรียบเทียบ')).toBe('hbv3_date');
    expect(dialog.queryByLabelText('ลำดับวันที่ฉีด 2 เข็มแรก')).toBeNull();
  });

  it('requires Target Age, and warns without blocking about a column no other rule uses', { timeout: 15_000 }, async () => {
    renderManager();
    const dialog = openNewRule();
    fillNewRule(dialog, 'newvac1_date');
    expect(dialog.getByText(/newvac1_date.*ไม่มีในเกณฑ์อื่น/)).toBeTruthy();
    // The column is unknown to the default map, so there is no suggestion to prefill.
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledWith('suggestRuleTargetAges', expect.anything()));
    expect(targetAge(dialog).value).toBe('');

    fireEvent.click(dialog.getByRole('button', { name: 'ตกลง (บันทึกฉบับร่าง)' }));
    expect(await dialog.findByText('กรุณาระบุอายุเป้าหมายของเกณฑ์ใหม่')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    type(targetAge(dialog), '12');
    await submitDraft(dialog);
    expect(within(screen.getByRole('table')).getByText('HBV เข็มใหม่')).toBeTruthy();
  });
});

describe('Issue #148 — an unsaved addition', () => {
  const addRule = async () => {
    const dialog = openNewRule();
    fillNewRule(dialog, 'hbv4_date');
    await vi.waitFor(() => expect(targetAge(dialog).value).toBe('4'));
    await settle();
    await submitDraft(dialog);
  };

  it('still requires Target Age when reopened before Batch Save', { timeout: 15_000 }, async () => {
    renderManager();
    await addRule();
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไขเกณฑ์ HBV เข็มใหม่' }));
    const dialog = within(screen.getByRole('dialog'));
    type(targetAge(dialog), '');
    fireEvent.click(dialog.getByRole('button', { name: 'ตกลง (บันทึกฉบับร่าง)' }));
    expect(await dialog.findByText('กรุณาระบุอายุเป้าหมายของเกณฑ์ใหม่')).toBeTruthy();
  });

  it('is marked "จะถูกลบ" and can be undone, and a marked addition is not sent', { timeout: 15_000 }, async () => {
    renderManager();
    await addRule();
    const row = () => within(screen.getByRole('table')).getByText('HBV เข็มใหม่').closest('tr')!;
    fireEvent.click(within(row()).getByRole('button', { name: 'ลบเกณฑ์ HBV เข็มใหม่' }));
    expect(within(row()).getByText('จะถูกลบ')).toBeTruthy();
    fireEvent.click(within(row()).getByRole('button', { name: 'ยกเลิกการลบ HBV เข็มใหม่' }));
    expect(within(row()).queryByText('จะถูกลบ')).toBeNull();

    // Marked again, with an edit to a stored rule so there is something to save
    fireEvent.click(within(row()).getByRole('button', { name: 'ลบเกณฑ์ HBV เข็มใหม่' }));
    fireEvent.click(screen.getByRole('button', { name: 'ลบเกณฑ์ DTP เข็ม 1' }));
    const review = openReview();
    expect(review.queryByText('เพิ่มใหม่')).toBeNull();
    fireEvent.click(review.getByRole('button', { name: 'ยืนยันการบันทึก' }));
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledWith('batchSaveRules', expect.anything()));
    const body = vi.mocked(fetchApi).mock.calls.find(([action]) => action === 'batchSaveRules')![1] as any;
    expect(body.rules.map((r: VaccineRule) => r.rule_id)).toEqual(['hbv1']);
    expect(body.deleted_rule_ids).toEqual(['dtp1']);
  });
});

describe('Issue #148 — deleting a Vaccine Rule', () => {
  it('marks a rule "จะถูกลบ" in the draft and can undo it', () => {
    renderManager();
    const row = () => within(screen.getByRole('table')).getByText('DTP เข็ม 1').closest('tr')!;
    fireEvent.click(within(row()).getByRole('button', { name: 'ลบเกณฑ์ DTP เข็ม 1' }));
    expect(within(row()).getByText('จะถูกลบ')).toBeTruthy();
    fireEvent.click(within(row()).getByRole('button', { name: 'ยกเลิกการลบ DTP เข็ม 1' }));
    expect(within(row()).queryByText('จะถูกลบ')).toBeNull();
  });

  it('disables deleting the last remaining rule of the Age Group', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'ลบเกณฑ์ HBV เข็ม 1' }));
    const last = screen.getByRole('button', { name: 'ลบเกณฑ์ DTP เข็ม 1' }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    expect(last.title).toMatch(/อย่างน้อย 1/);
  });
});

describe('Issue #148 — review and Batch Save', () => {
  it('reviews additions under "เพิ่มใหม่" and deletions under "ลบ", then sends the new rule and deleted_rule_ids', { timeout: 15_000 }, async () => {
    renderManager();
    const dialog = openNewRule();
    fillNewRule(dialog, 'hbv4_date');
    await vi.waitFor(() => expect(targetAge(dialog).value).toBe('4'));
    await vi.waitFor(() => expect(pairValue(dialog, 'ลำดับวันที่ฉีด 1 เข็มที่เปรียบเทียบ')).toBe('hbv4_date'));
    await submitDraft(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'ลบเกณฑ์ DTP เข็ม 1' }));

    const review = openReview();
    const added = within(review.getByText('เพิ่มใหม่').closest('section')!);
    expect(added.getByText('HBV เข็มใหม่')).toBeTruthy();
    expect(added.getByText('hbv4_date')).toBeTruthy();
    expect(added.getByText('4')).toBeTruthy();
    const deleted = within(review.getByText('ลบ').closest('section')!);
    expect(deleted.getByText('DTP เข็ม 1')).toBeTruthy();
    expect(deleted.getByText(/ความต่อเนื่องข้ามปี/)).toBeTruthy();
    expect(deleted.getByText(/ปิดใช้งาน/)).toBeTruthy();

    fireEvent.click(review.getByRole('button', { name: 'ยืนยันการบันทึก' }));
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledWith('batchSaveRules', expect.anything()));
    const body = vi.mocked(fetchApi).mock.calls.find(([action]) => action === 'batchSaveRules')![1] as any;
    expect(body.fiscalYear).toBe(fiscalYear);
    expect(body.ageGroup).toBe('1yr');
    expect(body.deleted_rule_ids).toEqual(['dtp1']);
    expect(body.rules.map((r: VaccineRule) => r.rule_id)).toEqual(['hbv1', expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    const newRule = body.rules[1];
    expect(newRule).toMatchObject({
      fiscal_year: fiscalYear, age_group: '1yr', display_name: 'HBV เข็มใหม่', vaccine_group: 'HBV', view_type: 1, logic_type: 'ALL',
      required_fields: ['hbv4_date'], is_active: true, is_required_for_v2: true, target_age_months: 4,
      date_checks: {
        before_birth: true, allow_on_birth: false,
        same_day_pairs: [{ field: 'hbv1_date', other_field: 'hbv4_date' }],
        ordered_pairs: [{ field: 'hbv1_date', other_field: 'hbv4_date' }],
      },
    });
    expect(newRule.metric_key).toBeUndefined();
  });
});
