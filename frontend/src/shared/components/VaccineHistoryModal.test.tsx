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
import type { EpiRecord } from '../types';

const record: EpiRecord = {
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-1', cid: '0000000000000',
  name: 'เด็ก', lname: 'ทดสอบ', birth: '2025-01-15', bcg_date: '2025-01-14', result: 'ผ่าน',
};
const open = (props: Partial<Parameters<typeof VaccineHistoryModal>[0]>) => {
  render(<VaccineHistoryModal isOpen onClose={() => undefined} record={record} {...props} />);
  return within(screen.getByRole('dialog'));
};
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
    const dialog = open({ warnings: ['BCG: วันที่ฉีดก่อนวันเกิด'] });
    expect(dialog.getByText(/ไม่นับเป็นวัคซีนขาด/).textContent).toContain('ตรวจสอบประวัติ');
    expect(dialog.queryByText(/ไม่แก้ค่าผลจาก HDC/)).toBeNull();
  });
});
