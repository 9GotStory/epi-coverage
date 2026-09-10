import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View1AgeRecords } from './View1AgeRecords';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
vi.mock('../exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }));

const rules: VaccineRule[] = [
  { rule_id: 'dtp5', fiscal_year: 2569, age_group: '5yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 5', hdc_code: '035', required_fields: ['dtp5_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 48, date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] } },
  { rule_id: 'opv5', fiscal_year: 2569, age_group: '5yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 5', hdc_code: '085', required_fields: ['opv5_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 48, date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] } },
  { rule_id: 'pcv1', fiscal_year: 2569, age_group: '5yr', view_type: 1, vaccine_group: 'PCV', display_name: 'PCV เข็ม 1', hdc_code: 'P11', required_fields: ['pcv1_date'], logic_type: 'ALL', is_required_for_v2: false, is_active: true, target_age_months: 2 },
];
const data = [{ hoscode: '00001', hosname: 'หน่วยทดสอบ', cid: '0000000000001', pid: '1', name: 'ข้อมูล', lname: 'จำลอง', birth: '2021-01-01', bcg_date: '2021-01-01', dtp5_date: '2025-02-01', opv5_date: '2025-02-02', addr: '001/2', check_typearea: '3' }];

const render = (queryData: VaccineRule[]) => {
  const client = new QueryClient();
  client.setQueryData(['vaccineRules', 2569, '5yr'], queryData);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={data} isLoading={false} error={null} asOfDate={null} />
    </QueryClientProvider>,
  );
};

describe('age-specific individual view rendering (rules-driven)', () => {
  it('renders the guide from vaccine_rules display names with demographic fields', () => {
    const html = render(rules);
    expect(html).toContain('DTP เข็ม 5');
    expect(html).toContain('OPV เข็ม 5');
    expect(html).toContain('HDC: 035');
    expect(html).toContain('อายุเป้าหมาย 48 เดือน');
    // ไม่มีรายการ hardcode ของกลุ่มอายุอื่น/ป้ายเดิม
    expect(html).not.toContain('DTP 4 ปี');
    expect(html).toContain('ประเภทพื้นที่');
    expect(html).toContain('ที่อยู่');
    expect(html).toContain('001/2');
  });

  it('marks a complete record as ครบ and an incomplete one as ไม่ครบ with tooltip reasons', () => {
    const html = render(rules);
    expect(html).toContain('bg-emerald-100'); // badge ครบ
    const incomplete = [{ ...data[0], opv5_date: '' }];
    const client = new QueryClient();
    client.setQueryData(['vaccineRules', 2569, '5yr'], rules);
    const incompleteHtml = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={incomplete} isLoading={false} error={null} asOfDate={null} />
      </QueryClientProvider>,
    );
    expect(incompleteHtml).toContain('bg-red-100'); // badge ไม่ครบ
    expect(incompleteHtml).toContain('title="OPV เข็ม 5"');
  });

  it('marks a record with a date warning as ไม่ครบ with the warning in the tooltip', () => {
    // dtp5 ลงเป็นวันเกิด = date warning → rule ไม่ผ่าน → ต้องเป็น ไม่ครบ ไม่ใช่ ครบ
    const warned = [{ ...data[0], dtp5_date: '2021-01-01' }];
    const client = new QueryClient();
    client.setQueryData(['vaccineRules', 2569, '5yr'], rules);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={warned} isLoading={false} error={null} asOfDate={null} />
      </QueryClientProvider>,
    );
    expect(html).toContain('bg-red-100');
    expect(html).toContain('ตรวจสอบวันที่: DTP เข็ม 5: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต');
  });

  it('labels out-of-plan rules in the guide and header', () => {
    const html = render(rules);
    expect(html).toContain('นอกแผน');
    expect(html).toContain('รายการนอกแผนแสดงประกอบและไม่นับในความครบถ้วน');
  });

  it('never labels a record complete when rules are unavailable', () => {
    const html = render([]);
    expect(html).toContain('ไม่มีเกณฑ์วัคซีนที่เปิดใช้งานสำหรับปีและกลุ่มอายุนี้');
    expect(html).toContain('ข้อมูลไม่พอประเมิน');
    expect(html).not.toContain('bg-emerald-100'); // ไม่มี badge ครบ
  });
});
