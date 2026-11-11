/**
 * Issue #101 — View 2 per-record list: the configured rules decide each child's
 * result; the imported HDC `result` is shown alongside, with "ผลไม่ตรงกับ HDC"
 * when the two verdicts disagree.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HdcRecordsView } from './HdcRecordsView';
import { markSourceAware } from '../utils/vaccine/ruleEngine';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { EpiRecord } from '../types';
vi.mock('../exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn() }));

const v2Rule = (overrides: Partial<VaccineRule> & Pick<VaccineRule, 'rule_id' | 'display_name' | 'required_fields'>): VaccineRule => ({
  fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'X', hdc_code: '',
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, ...overrides,
});
const rules = markSourceAware([
  v2Rule({ rule_id: 'v2-bcg', display_name: 'BCG 1 เข็ม', required_fields: ['bcg_date'], target_age_months: 0 }),
  v2Rule({ rule_id: 'v2-mmr', display_name: 'MMR เข็ม 1', required_fields: ['mmr1_date'], target_age_months: 9 }),
]);

// เกิดในช่วงกลุ่มอายุ 1 ปีของปีงบ 2569 และพ้นอายุเป้าหมายทุกกฎแล้ว
const child = (id: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth: '2025-01-15',
  source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date']),
  ...extra,
});

/** ตารางรายชื่อเท่านั้น — ตัวเลือกในตัวกรองใช้ป้ายเดียวกัน จึงไม่นับรวม */
const renderRows = (data: EpiRecord[], cachedRules: VaccineRule[] = rules) => {
  const client = new QueryClient();
  client.setQueryData(['vaccineRules', 2569, '1yr'], cachedRules);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HdcRecordsView age={1} fiscalYear={2569} quarter="all" data={data} isLoading={false} error={null} asOfDate={null} />
    </QueryClientProvider>,
  );
  return html.slice(html.indexOf('<thead'), html.indexOf('</tbody>'));
};

const MISMATCH_BADGE = '>ผลไม่ตรงกับ HDC<';

describe('Issue #101 — View 2 list: rule result first, HDC result alongside', () => {
  it('shows a child the rules find missing as ไม่ผ่าน even when HDC says ผ่าน, and flags the mismatch', () => {
    const html = renderRows([child('HDC-PASS-MISSING', { bcg_date: '2025-01-15', mmr1_date: '', result: 'ผ่าน' })]);
    expect(html).toContain('ผลตามกฎ');
    expect(html).toContain('>ไม่ผ่าน<');
    expect(html).toContain('ขาด: MMR เข็ม 1');
    expect(html).toContain('>ผ่าน<'); // ผลจาก HDC ยังแสดงประกอบ
    expect(html).toContain(MISMATCH_BADGE);
  });

  it('does not flag a child when the rules and HDC agree', () => {
    const html = renderRows([child('AGREE', { bcg_date: '2025-01-15', mmr1_date: '2025-10-20', result: 'ผ่าน' })]);
    expect(html).not.toContain('>ไม่ผ่าน<');
    expect(html).not.toContain(MISMATCH_BADGE);
  });

  it('does not flag a not-evaluable child, whatever HDC says', () => {
    const html = renderRows([child('NO-MMR-COLUMN', {
      bcg_date: '2025-01-15', result: 'ไม่ผ่าน', source_columns: JSON.stringify(['birth', 'bcg_date']),
    })]);
    expect(html).toContain('>ประเมินไม่ได้<');
    expect(html).not.toContain(MISMATCH_BADGE);
  });

  it('fails closed without View 2 rules — no child is shown as ผ่าน by the rules', () => {
    const html = renderRows([child('NO-RULES', { bcg_date: '', mmr1_date: '', result: 'ไม่ผ่าน' })], []);
    expect(html).toContain('>ยังไม่มีเกณฑ์<');
    expect(html).not.toContain('>ผ่าน<');
    expect(html).not.toContain(MISMATCH_BADGE);
  });
});
