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

  const renderRecords = (records: typeof data) => {
    const client = new QueryClient();
    client.setQueryData(['vaccineRules', 2569, '5yr'], rules);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={records} isLoading={false} error={null} asOfDate={null} />
      </QueryClientProvider>,
    );
    return html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  };

  it('Issue #102: marks a record whose only problem is a date warning as ตรวจสอบประวัติ, not ไม่ครบ', () => {
    // dtp5 ลงเป็นวันเกิด = คำเตือนวันที่ → ตรวจสอบประวัติ ไม่ใช่เข็มขาด
    const html = renderRecords([{ ...data[0], dtp5_date: '2021-01-01' }]);
    expect(html).toContain('>ตรวจสอบประวัติ<');
    expect(html).not.toContain('>ไม่ครบ<');
    expect(html).toContain('title="ตรวจสอบวันที่: DTP เข็ม 5 ฉีดตรงวันเกิด (01-01-2021) ซึ่งเกณฑ์ไม่อนุญาต"');
  });

  it('Issue #130: shows the date warnings under the badge, not only in the tooltip', () => {
    const html = renderRecords([{ ...data[0], dtp5_date: '2021-01-01', opv5_date: '2021-01-01' }]);
    expect(html).toContain('>DTP เข็ม 5 ฉีดตรงวันเกิด (01-01-2021) ซึ่งเกณฑ์ไม่อนุญาต<');
    expect(html).toContain('>OPV เข็ม 5 ฉีดตรงวันเกิด (01-01-2021) ซึ่งเกณฑ์ไม่อนุญาต<');
  });

  it('Issue #130: names a counterpart dose outside the age group as View 2 and the Rules Engine do', () => {
    // dtp4 has a single-column rule only in View 2; the View 1 pair still names it by that rule
    const paired = rules.map(rule => rule.rule_id === 'dtp5' ? { ...rule, date_checks: { ...rule.date_checks!, ordered_pairs: [{ field: 'dtp4_date', other_field: 'dtp5_date' }] } } : rule);
    const withView2 = [...paired, { ...rules[0], rule_id: 'v2-dtp4', view_type: 2 as const, display_name: 'DTP เข็ม 4 (18 เดือน)', required_fields: ['dtp4_date'] }];
    const client = new QueryClient();
    client.setQueryData(['vaccineRules', 2569, '5yr'], withView2);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <View1AgeRecords age={5} fiscalYear={2569} quarter="all" data={[{ ...data[0], dtp4_date: '2025-03-01' }]} isLoading={false} error={null} asOfDate={null} />
      </QueryClientProvider>,
    );
    expect(html).toContain('>DTP เข็ม 5 (01-02-2025) ฉีดก่อน DTP เข็ม 4 (18 เดือน) (01-03-2025)<');
  });

  it('Issue #102: a really missing dose still makes the record ไม่ครบ alongside a date warning', () => {
    const html = renderRecords([{ ...data[0], dtp5_date: '2021-01-01', opv5_date: '' }]);
    expect(html).toContain('>ไม่ครบ<');
    expect(html).toContain('title="OPV เข็ม 5 · ตรวจสอบวันที่: DTP เข็ม 5');
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
