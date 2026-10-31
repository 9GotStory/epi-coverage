// @vitest-environment jsdom
/**
 * Ticket #55 RED — public-route deep-dive UX contracts.
 * Synthetic, aggregate annual summaries only. No mocking of route internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type {
  DashboardSummaryRow, EpiTargetTable, FacilityBreakdownEntry, VaccineBreakdownEntry,
} from '../shared/types/dashboardSummary';
import { YearComparison } from './YearComparison';

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
const charts = vi.hoisted(() => ({
  rendered: [] as Array<Array<{ fiscalYear: string; coverage: number | null; target: number | null }>>,
}));
vi.mock('../shared/lib/api', () => ({ fetchApi: api.fetchApi }));
vi.mock('recharts', () => {
  const stub = () => null;
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    __esModule: true,
    ResponsiveContainer: passthrough,
    ComposedChart: ({ data, children }: {
      data: Array<{ fiscalYear: string; coverage: number | null; target: number | null }>;
      children?: ReactNode;
    }) => { charts.rendered.push(data); return children ?? null; },
    LineChart: stub, BarChart: stub, Line: stub, Bar: stub, XAxis: stub, YAxis: stub,
    CartesianGrid: stub, Tooltip: stub, Legend: stub, ReferenceLine: stub,
    ReferenceDot: stub, AreaChart: stub, Area: stub, Cell: stub, LabelList: stub,
    PieChart: stub, Pie: stub, ScatterChart: stub, Scatter: stub,
  };
});
const facility = (
  hoscode: string, hosname: string, coverage: number, passed: number, total: number,
): FacilityBreakdownEntry => ({ hoscode, hosname, coverage, passed, total });
const vaccine = (
  metric_key: string | undefined, name: string, coverage: number,
  passed: number, total: number, vaccine_group = 'dtp',
): VaccineBreakdownEntry => ({ metric_key, name, coverage, passed, total, vaccine_group });
/** Issue #97 writer contract: HDC-verdict bucket — keyless by design, labelled by the writer. */
const verdictBucket = (passed: number, total: number): VaccineBreakdownEntry =>
  ({ name: 'ไม่ผ่านเกณฑ์ HDC (ตรวจสอบรายละเอียดในระบบ)', passed, total, coverage: 0, category: 'hdc_verdict' });
const row = (
  targetTable: EpiTargetTable, fiscalYear: number,
  extra: Partial<DashboardSummaryRow['summaryData']> = {},
): DashboardSummaryRow => ({
  id: `${targetTable}_${fiscalYear}_all`, targetTable, fiscalYear,
  updated_at: fiscalYear === 2568 ? '2026-06-01T09:00:00.000Z' : '2026-09-21T09:00:00.000Z',
  summaryData: {
    total: 100, view1Coverage: 75, view1PassedDoses: 75, view1TotalDoses: 100,
    view2Coverage: 70, view2Passed: 70, view2ApplicableTotal: 100, view2PendingCount: 0,
    facilityBreakdownV1: [], facilityBreakdownV2: [],
    view1Breakdown: [], view2Breakdown: [],
    ...extra,
  },
});
const groups: EpiTargetTable[] = ['Epi_1_Year','Epi_2_Year','Epi_3_Year','Epi_5_Year'];
const annualRows: DashboardSummaryRow[] = [
  row('Epi_1_Year', 2568, {
    facilityBreakdownV1: [
      facility('06413','บ้านหนุน',80,8,10), facility('6413','หน่วยชื่อซ้ำ',65,13,20),
    ],
    facilityBreakdownV2: [
      facility('06413','บ้านหนุน',70,7,10), facility('6413','หน่วยชื่อซ้ำ',60,6,10),
    ],
    view1Breakdown: [
      vaccine('DTP','DTP ชื่อเก่า',80,8,10),
      vaccine(undefined,'วัคซีนรุ่นเก่า',66,6,9),
    ],
  }),
  row('Epi_1_Year', 2569, {
    facilityBreakdownV1: [
      facility('06413','บ้านหนุนชื่อใหม่',90,9,10),
      facility('6413','หน่วยชื่อซ้ำ',75,15,20),
      facility('ZERO','หน่วยศูนย์จริง',0,0,10),
      facility('DEN0','หน่วยไม่มีตัวหาร',0,0,0),
    ],
    facilityBreakdownV2: [
      facility('06413','บ้านหนุนชื่อใหม่',82,82,100),
      facility('6413','หน่วยชื่อซ้ำ',64,16,25),
    ],
    view1Breakdown: [
      vaccine('DTP','DTP ชื่อใหม่',92,23,25),
      vaccine('DIFF','DTP ชื่อใหม่',66,33,50),
    ],
    // #97 production shape (3yr/View 2): keyed vaccine + HDC-verdict bucket that owns no key by design
    view2Breakdown: [vaccine('MMR','MMR',80,8,10,'mmr'), verdictBucket(1, 23)],
  }),
  row('Epi_2_Year', 2569, {
    facilityBreakdownV1: [facility('99999','กลุ่มอายุ 2 ปี',88,22,25)],
    facilityBreakdownV2: [facility('99999','กลุ่มอายุ 2 ปี',93,93,100)],
  }),
  row('Epi_3_Year', 2567),
  row('Epi_3_Year', 2569),
  row('Epi_5_Year', 2569),
];
const yearsByTable = {
  Epi_1_Year:[2568,2569], Epi_2_Year:[2569], Epi_3_Year:[2567,2569], Epi_5_Year:[2569],
};
function mount({
  summaries=annualRows,
  years=yearsByTable,
}: {
  summaries?:DashboardSummaryRow[];
  years?:Record<string, number[]>;
}={}) {
  api.fetchApi.mockImplementation(async (action: string, payload?:{fiscalYears?:number[]}) => {
    if(action==='getDashboardSummaryYears') return {data:{success:true,tables:years}};
    if(action==='getDashboardSummariesMultiYear')
      return {data:{success:true,summaries:summaries.filter(r => (payload?.fiscalYears??[]).includes(r.fiscalYear))}};
    if(action==='getTargetConfig') return {data:{
      target_view1_q4_2568:85,
      target_view1_q4_2569:95,
      target_view2_q4_2569:90,
      target_dtp_q4_2569:93,
    }};
    return {data:{}};
  });
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter><YearComparison/></MemoryRouter></QueryClientProvider>);
}
async function expand() {
  const trigger=await screen.findByRole('button',{name:'เจาะลึกผลการดำเนินงานรายปีงบประมาณ'});
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  await waitFor(()=>expect(trigger.getAttribute('aria-expanded')).toBe('true'));
  return screen.getByRole('region',{name:'ส่วนเจาะลึกผลการดำเนินงาน'});
}
const clickWithin = (region:HTMLElement,name:string) =>
  fireEvent.click(within(region).getByRole('button',{name}));
const requestYears=()=>api.fetchApi.mock.calls.filter(x=>x[0]==='getDashboardSummariesMultiYear')
  .map(x=>(x[1] as {fiscalYears:number[]}).fiscalYears);

beforeEach(()=>{api.fetchApi.mockReset();charts.rendered.length=0;});
afterEach(()=>cleanup());

describe('Ticket #55: redesigned second card on the real comparison route',()=>{
  it('U01: main four-age charts persist; second card expands three accessible selection axes',async()=>{
    mount();
    await screen.findByRole('heading',{name:'เด็กอายุ 5 ปี'});
    expect(charts.rendered.length).toBeGreaterThanOrEqual(8);
    const panel=await expand();
    expect(within(panel).getByRole('group',{name:'เลือกกลุ่มอายุสำหรับเจาะลึก'})).toBeTruthy();
    expect(within(panel).getByRole('group',{name:'เลือกมุมมองสำหรับเจาะลึก'})).toBeTruthy();
    expect(within(panel).getByRole('group',{name:'เลือกหัวข้อวิเคราะห์'})).toBeTruthy();
    expect(within(panel).getByRole('button',{name:'เด็กอายุ 1 ปี'}).getAttribute('aria-pressed')).toBe('true');
    expect(within(panel).getByRole('button',{name:'View 1 — รายโดส'}).getAttribute('aria-pressed')).toBe('true');
    expect(within(panel).getByRole('button',{name:'รายหน่วยบริการ'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('region',{name:/เด็กอายุ [1235] ปี/})).toHaveLength(4);
  });

  it('U02: exact facility identities remain separate; each View shows only its own stored results and deltas',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(panel).getByText('90.00%')).toBeTruthy();
    expect(within(panel).getByText('9 / 10 โดส')).toBeTruthy();
    expect(within(panel).getByText('ปี 2569 สูงกว่าปี 2568 อยู่ 10.00 จุดร้อยละ')).toBeTruthy();
    clickWithin(panel,'View 2 — รายคน');
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(panel).getByText('82.00%')).toBeTruthy();
    expect(within(panel).getByText('82 / 100 คน')).toBeTruthy();
    expect(within(panel).getByText('ปี 2569 สูงกว่าปี 2568 อยู่ 12.00 จุดร้อยละ')).toBeTruthy();
    expect(within(panel).queryByText('9 / 10 โดส')).toBeNull();
    expect(requestYears()).toContainEqual([2568,2569]);
  });

  it('U03: selecting an age never leaks facilities from another age, global FY chips are preserved',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'เด็กอายุ 2 ปี');
    expect(within(panel).getByRole('button',{name:'เลือกหน่วยบริการ 99999 กลุ่มอายุ 2 ปี'})).toBeTruthy();
    expect(within(panel).queryByRole('button',{name:/เลือกหน่วยบริการ 06413/})).toBeNull();
    expect(screen.getByRole('button',{name:'ปี 2568'}).getAttribute('aria-pressed')).toBe('true');
    expect(requestYears()).toContainEqual([2568,2569]);
  });

  it('U04: per-View vaccine metric_key preserves renames, excludes legacy missing-key years and keeps equal names distinct',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'รายวัคซีน');
    expect(within(panel).getByRole('button',{name:'เลือกวัคซีน DTP ชื่อใหม่ รหัส DTP'})).toBeTruthy();
    expect(within(panel).getByRole('button',{name:'เลือกวัคซีน DTP ชื่อใหม่ รหัส DIFF'})).toBeTruthy();
    // #58 Phase 1 copy (#97): measured counts for the SELECTED age+view+FY — 2 vaccine entries, 1 unkeyed
    expect(within(panel).getByText('ปี 2568 · View 1: ข้อมูลสรุปมีวัคซีน 2 รายการ โดย 1 รายการยังไม่มีรหัสเชื่อมโยงสำหรับการเปรียบเทียบข้ามปี (อีก 1 รายการเปรียบเทียบได้)')).toBeTruthy();
    clickWithin(panel,'เลือกวัคซีน DTP ชื่อใหม่ รหัส DTP');
    expect(within(panel).getByText('ปี 2569 สูงกว่าปี 2568 อยู่ 12.00 จุดร้อยละ')).toBeTruthy();
    clickWithin(panel,'View 2 — รายคน');
    expect(within(panel).queryByRole('button',{name:'เลือกวัคซีน DTP ชื่อใหม่ รหัส DTP'})).toBeNull();
    expect(within(panel).getByRole('button',{name:'เลือกวัคซีน MMR รหัส MMR'})).toBeTruthy();
  });

  it('U04b: an HDC-verdict bucket owning no key by design never raises the cross-year join warning (#97)',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'รายวัคซีน');
    clickWithin(panel,'View 2 — รายคน');
    // FY2569 View 2 = MMR (keyed) + HDC-verdict bucket (keyless by design) → keyed series stays, no warning
    expect(within(panel).getByRole('button',{name:'เลือกวัคซีน MMR รหัส MMR'})).toBeTruthy();
    expect(within(panel).queryByText(/ยังไม่มีรหัสเชื่อมโยง/)).toBeNull();
    expect(within(panel).queryByText(/ไม่มีรหัสเชื่อมโยงวัคซีน/)).toBeNull();
  });

  it('U05: ranking is latest-year real coverage ascending, with true zero before non-evaluable and never a fake 0%',async()=>{
    mount();const panel=await expand();
    const chooser=within(panel).getByRole('group',{name:'เลือกหน่วยบริการจากผลปี 2569'});
    const buttons=within(chooser).getAllByRole('button');
    expect(buttons.map(b=>b.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('ZERO'),expect.stringContaining('DEN0'),
    ]));
    const ordered=buttons.map(b=>b.getAttribute('aria-label')??'');
    expect(ordered.findIndex(s=>s.includes('ZERO'))).toBeLessThan(ordered.findIndex(s=>s.includes('6413')));
    expect(ordered.findIndex(s=>s.includes('DEN0'))).toBeGreaterThan(ordered.findIndex(s=>s.includes('06413')));
    clickWithin(panel,'เลือกหน่วยบริการ ZERO หน่วยศูนย์จริง');
    expect(within(panel).getByText('0.00%')).toBeTruthy();
    clickWithin(panel,'เลือกหน่วยบริการ DEN0 หน่วยไม่มีตัวหาร');
    expect(within(panel).getAllByText('ยังประเมินไม่ได้').length).toBeGreaterThan(0);
    expect(within(panel).queryByText('0 / 0 โดส')).toBeNull();
  });

  it('U06: explicit annual target gap differs from year-over-year change and references selected View',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(panel).getByText('เป้าหมายปี 2569: 95.00%')).toBeTruthy();
    expect(within(panel).getByText('ส่วนต่างจากเป้าหมายปี 2569: -5.00 จุดร้อยละ')).toBeTruthy();
    clickWithin(panel,'รายวัคซีน');
    clickWithin(panel,'เลือกวัคซีน DTP ชื่อใหม่ รหัส DTP');
    expect(within(panel).getByText('เป้าหมายปี 2569: 93.00%')).toBeTruthy();
    expect(within(panel).getByText('ส่วนต่างจากเป้าหมายปี 2569: -1.00 จุดร้อยละ')).toBeTruthy();
    expect(within(panel).getAllByText(/ข้อมูลสรุป ณ วันที่/).length).toBeGreaterThanOrEqual(2);
  });

  it('U07: year detail table stays collapsed by default and reveals exact stored counts/years on demand',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    const tableButton=within(panel).getByRole('button',{name:'แสดงตารางข้อมูลรายปี'});
    expect(tableButton.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByRole('table')).toBeNull();
    fireEvent.click(tableButton);
    expect(tableButton.getAttribute('aria-expanded')).toBe('true');
    // A FY2569 delta cell also says "2568", so search the year-identity column
    // instead of matching the entire accessible row name.
    const yearRows = [...within(panel).getByRole('table').querySelectorAll('tbody tr')];
    expect(yearRows.map(row => row.querySelector('td')?.textContent)).toEqual(['2568','2569']);
    expect(within(panel).getByRole('table').textContent).toContain('9 / 10');
  });

  it('U08: one selected FY has real data but no invented preceding-year delta',async()=>{
    mount({years:Object.fromEntries(groups.map(x=>[x,[2569]])),
      summaries:annualRows.filter(r=>r.fiscalYear===2569)});
    const panel=await expand();
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(panel).getByText('90.00%')).toBeTruthy();
    expect(within(panel).getByText('ยังไม่มีปีงบประมาณอื่นสำหรับเปรียบเทียบ')).toBeTruthy();
    expect(within(panel).queryByText(/สูงกว่าปี 2568/)).toBeNull();
    expect(requestYears()).toContainEqual([2569]);
  });

  it('U09: selecting an FY only present in another age shows unavailable summary, not 0% for active entity',async()=>{
    mount();const panel=await expand();
    fireEvent.click(screen.getByRole('button',{name:'ปี 2567'}));
    await waitFor(()=>expect(requestYears()).toContainEqual([2567,2568,2569]));
    const refreshed = await screen.findByRole('region',{name:'ส่วนเจาะลึกผลการดำเนินงาน'});
    clickWithin(refreshed,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(refreshed).getByText('ปี 2567: ไม่มีข้อมูลสรุป')).toBeTruthy();
    expect(within(panel).queryByText('ปี 2567: 0.00%')).toBeNull();
  });

  it('U10: scope is accessible in compact layout; every result is readable without tooltip',async()=>{
    mount();const panel=await expand();
    clickWithin(panel,'เลือกหน่วยบริการ 06413 บ้านหนุนชื่อใหม่');
    expect(within(panel).getByRole('img',{name:/ผลรายปี/})).toBeTruthy();
    expect(within(panel).getByText('ความครอบคลุมรายปี')).toBeTruthy();
    expect(within(panel).getAllByText(/ข้อมูลสรุป ณ วันที่/).length).toBeGreaterThanOrEqual(2);
    expect(charts.rendered.some(c=>c.some(d=>d.fiscalYear==='2569'&&d.coverage===90))).toBe(true);
  });
});
