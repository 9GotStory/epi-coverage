// @vitest-environment jsdom
/**
 * Issue #102 — the data-quality worklist is the list filtered to "ตรวจสอบประวัติ"; its export must
 * carry the date warnings themselves so staff can fix the source record without opening each child.
 *
 * Seam: the Excel button of each list and the rows handed to `exportToExcel` (mocked). Exports read
 * the filtered records, not the virtualized table rows, so this is observable in jsdom.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HdcRecordsView } from './HdcRecordsView';
import { View1AgeRecords } from './View1AgeRecords';
import { markSourceAware } from '../utils/vaccine/ruleEngine';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { EpiRecord } from '../types';

const exports = vi.hoisted(() => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }));
vi.mock('../exportUtils', () => exports);

const rule = (overrides: Partial<VaccineRule> & Pick<VaccineRule, 'rule_id' | 'view_type'>): VaccineRule => ({
  fiscal_year: 2569, age_group: '1yr', vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010',
  required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0, ...overrides,
});
const rules = markSourceAware([rule({ rule_id: 'v1-bcg', view_type: 1 }), rule({ rule_id: 'v2-bcg', view_type: 2 })]);
const warned: EpiRecord = {
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-1', cid: '0000000000000', name: 'เด็ก', lname: 'ทดสอบ',
  birth: '2025-01-15', bcg_date: '2025-01-14', source_columns: JSON.stringify(['birth', 'bcg_date']),
};
// Issue #130: the warning names the dose and both dates
const WARNING = 'BCG 1 เข็ม ฉีดก่อนวันเกิด (14-01-2025, เกิด 15-01-2025)';

const withRules = (ui: React.ReactNode) => {
  const client = new QueryClient();
  client.setQueryData(['vaccineRules', 2569, '1yr'], rules);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};
const exportedRow = () => exports.exportToExcel.mock.calls.at(-1)![0][0] as Record<string, string>;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Issue #102 — exports carry the date warnings of ตรวจสอบประวัติ rows', () => {
  it('View 2 list', () => {
    withRules(<HdcRecordsView age={1} fiscalYear={2569} quarter="all" data={[warned]} isLoading={false} error={null} asOfDate={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Excel พร้อมข้อมูลวัคซีน' }));
    expect(exportedRow()).toMatchObject({ 'ผลตามกฎ': 'ตรวจสอบประวัติ', 'ข้อสังเกตวันที่': WARNING, 'รายละเอียดผลตามกฎ': '' });
    fireEvent.click(screen.getByRole('button', { name: 'PDF รายชื่อ' }));
    expect(exports.exportToPdf.mock.calls.at(-1)![0][0]).toMatchObject({ 'ผลตามกฎ': 'ตรวจสอบประวัติ', 'ข้อสังเกตวันที่': WARNING });
  });

  it('View 1 list', () => {
    withRules(<View1AgeRecords age={1} fiscalYear={2569} quarter="all" data={[warned]} isLoading={false} error={null} asOfDate={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Excel พร้อมวัคซีนตามอายุ' }));
    expect(exportedRow()).toMatchObject({ 'ผลการประเมิน': 'ตรวจสอบประวัติ' });
    expect(exportedRow()['รายละเอียดผล']).toContain(WARNING);
  });
});
