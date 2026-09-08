import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View1AgeRecords } from './View1AgeRecords';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
vi.mock('../exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }));

const rules: VaccineRule[] = ['dtp5_date', 'opv5_date'].map(field => ({ rule_id: field, fiscal_year: 2569, age_group: '5yr', view_type: 1, vaccine_group: '', display_name: field, hdc_code: '', required_fields: [field], logic_type: 'ALL', is_required_for_v2: true, is_active: true, date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] } }));
const data = [{ hoscode: '00001', hosname: 'หน่วยทดสอบ', cid: '0000000000001', pid: '1', name: 'ข้อมูล', lname: 'จำลอง', birth: '2021-01-01', bcg_date: '2021-01-01', dtp5_date: '2025-02-01', opv5_date: '2025-02-02', addr: '001/2', check_typearea: '3' }];

describe('age-specific individual view rendering', () => {
  it('renders only the 5-year criteria and displays new demographic fields', () => {
    const client = new QueryClient(); client.setQueryData(['vaccineRules', 2569, '5yr'], rules);
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={data} isLoading={false} error={null} asOfDate={null} /></QueryClientProvider>);
    expect(html).toContain('DTP 4 ปี'); expect(html).toContain('OPV 4 ปี');
    expect(html).not.toContain('BCG'); expect(html).toContain('ประเภทพื้นที่'); expect(html).toContain('ที่อยู่');
    expect(html).toContain('001/2'); expect(html).toContain('ครบตามเกณฑ์ที่ประเมิน');
  });
  it('never labels a record complete when rules are unavailable', () => {
    const client = new QueryClient(); client.setQueryData(['vaccineRules', 2569, '5yr'], []);
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={data} isLoading={false} error={null} asOfDate={null} /></QueryClientProvider>);
    expect(html).toContain('ยังไม่มีเกณฑ์ที่ตรงกับรายการนี้');
    expect(html).toContain('ข้อมูลไม่พอประเมิน');
  });
});
