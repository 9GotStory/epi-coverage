// @vitest-environment jsdom
/**
 * Issue #102 (carried over from #101) — the vaccine-history window shows the View 2 rule result next
 * to "ผลจาก HDC", with the "ผลไม่ตรงกับ HDC" badge, and its date-warning copy says what a warning
 * does to the rule result.
 *
 * Seam: `VaccineHistoryModal` rendered directly — the list tables are virtualized and render no rows
 * in jsdom, so opening the window through a row click is not observable here.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { VaccineHistoryModal } from './VaccineHistoryModal';
import { getRecordDateWarningDetails } from '../utils/vaccine/dateWarnings';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { EpiRecord } from '../types';

const record: EpiRecord = {
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-1', cid: '0000000000000',
  name: 'เด็ก', lname: 'ทดสอบ', birth: '2025-01-15', bcg_date: '2025-01-14', result: 'ผ่าน',
};
const open = (props: Partial<Parameters<typeof VaccineHistoryModal>[0]>) => {
  render(<VaccineHistoryModal isOpen onClose={() => undefined} record={record} {...props} />);
  return within(screen.getByRole('dialog'));
};
const noChecks = { before_birth: true, allow_on_birth: true, same_day_pairs: [], ordered_pairs: [] };
const dose = (field: string, display_name: string, date_checks: VaccineRule['date_checks'] = noChecks): VaccineRule => ({
  rule_id: field, fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'X', display_name, hdc_code: '',
  required_fields: [field], logic_type: 'ALL', is_required_for_v2: true, is_active: true, date_checks,
});
const ruleResult = (dialog: ReturnType<typeof within>) => dialog.getByText('ผลตามกฎ').nextElementSibling;

afterEach(cleanup);

describe('Issue #102 — history window shows the View 2 rule result next to the HDC result', () => {
  it('shows the rule result with the mismatch badge when it disagrees with HDC', () => {
    const dialog = open({ ruleResult: { label: 'ไม่ผ่าน', hdcMismatch: true } });
    expect(dialog.getByText('ผลจาก HDC')).toBeTruthy();
    expect(ruleResult(dialog)?.textContent).toBe('ไม่ผ่านผลไม่ตรงกับ HDC');
  });

  it('shows the rule result without a badge when there is no mismatch', () => {
    const dialog = open({ ruleResult: { label: 'ตรวจสอบประวัติ', hdcMismatch: false } });
    expect(ruleResult(dialog)?.textContent).toBe('ตรวจสอบประวัติ');
  });

  it('shows no rule result in View 1, which has no View 2 verdict', () => {
    const dialog = open({ showHdcResult: false });
    expect(dialog.queryByText('ผลตามกฎ')).toBeNull();
  });

  it('says a date warning is not a missing dose but ตรวจสอบประวัติ', () => {
    const dialog = open({ warnings: getRecordDateWarningDetails(record, [dose('bcg_date', 'BCG')]) });
    expect(dialog.getByText(/ไม่นับเป็นวัคซีนขาด/).textContent).toContain('ตรวจสอบประวัติ');
    expect(dialog.queryByText(/ไม่แก้ค่าผลจาก HDC/)).toBeNull();
  });
});

describe('Issue #130 — history window highlights the rows a warning concerns', () => {
  const dtp: EpiRecord = {
    ...record, bcg_date: '2025-01-15',
    dtp2_date: '2025-05-03', dtp2_hospcode: '01234', dtp2_input_hosp: '05678',
    dtp3_date: '2025-05-03', dtp3_hospcode: '01234', dtp3_input_hosp: '05678',
  };
  const pairs = (key: 'same_day_pairs' | 'ordered_pairs') => [dose('dtp2_date', 'DTP เข็ม 2', { ...noChecks, [key]: [{ field: 'dtp2_date', other_field: 'dtp3_date' }] }), dose('dtp3_date', 'DTP เข็ม 3')];
  const rowOf = (dialog: ReturnType<typeof within>, field: string) => dialog.getByText(field, { selector: 'div' }).closest('tr') as HTMLElement;
  const highlighted = (row: HTMLElement) => row.className.includes('bg-amber-50');

  it('highlights both rows of a Same-Day Pair, each naming the other dose, and keeps their facility codes', () => {
    const dialog = open({ record: dtp, warnings: getRecordDateWarningDetails(dtp, pairs('same_day_pairs')) });
    const [second, third] = [rowOf(dialog, 'dtp2_date'), rowOf(dialog, 'dtp3_date')];
    expect([highlighted(second), highlighted(third)]).toEqual([true, true]);
    expect(second.textContent).toContain('วันเดียวกับ DTP เข็ม 3');
    expect(third.textContent).toContain('วันเดียวกับ DTP เข็ม 2');
    expect(second.textContent).toContain('01234');
    expect(second.textContent).toContain('05678');
    expect(highlighted(rowOf(dialog, 'bcg_date'))).toBe(false);
    // the top panel keeps the full message
    expect(dialog.getByText('DTP เข็ม 2 และ DTP เข็ม 3 ฉีดวันเดียวกัน (03-05-2025)')).toBeTruthy();
  });

  it('notes a reversed Ordered Pair on both rows', () => {
    const reversed = { ...dtp, dtp2_date: '2025-06-10' };
    const dialog = open({ record: reversed, warnings: getRecordDateWarningDetails(reversed, pairs('ordered_pairs')) });
    expect(rowOf(dialog, 'dtp3_date').textContent).toContain('ฉีดก่อน DTP เข็ม 2');
    expect(rowOf(dialog, 'dtp2_date').textContent).toContain('ฉีดหลัง DTP เข็ม 3');
  });

  it('highlights a before-birth row', () => {
    const dialog = open({ warnings: getRecordDateWarningDetails(record, [dose('bcg_date', 'BCG')]) });
    const row = rowOf(dialog, 'bcg_date');
    expect(highlighted(row)).toBe(true);
    expect(row.textContent).toContain('ฉีดก่อนวันเกิด');
  });

  it('in View 1, adds no row for a counterpart outside the age group and keeps the message in the panel', () => {
    const ageRules = [pairs('same_day_pairs')[0]];
    const dialog = open({ record: dtp, rules: ageRules, showHdcResult: false, warnings: getRecordDateWarningDetails(dtp, pairs('same_day_pairs')) });
    expect(dialog.queryByText('dtp3_date', { selector: 'div' })).toBeNull();
    expect(rowOf(dialog, 'dtp2_date').textContent).toContain('วันเดียวกับ DTP เข็ม 3');
    expect(dialog.getByText('DTP เข็ม 2 และ DTP เข็ม 3 ฉีดวันเดียวกัน (03-05-2025)')).toBeTruthy();
  });
});
