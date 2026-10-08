/** @vitest-environment jsdom */
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { HdcFullyImmunizedComparison } from './HdcFullyImmunizedComparison';
import { HDC_COMPLETE_REPORTS } from '../utils/hdcCompleteAnnualReference';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

vi.mock('../lib/api',()=>({fetchApi:vi.fn()}));
const months=['10','11','12','01','02','03','04','05','06','07','08','09'];
type Age=keyof typeof HDC_COMPLETE_REPORTS;
function sourceRow(age:Age,target=4,result=3){
  const row:Record<string,unknown>={id:HDC_COMPLETE_REPORTS[age],
    hospcode:'06413',areacode:'54060101',b_year:'2569',
    date_com:'202610072314',target,result};
  for(const month of months){
    row['target'+month]=month==='10'?target:0;
    row['result'+month]=month==='10'?result:0;
  }
  return row;
}
function summary(target=4,passed=2,eligible=target):LegacyCompatibleGroupSummary{
  return {
    total:target,view1Coverage:0,view1PassedDoses:0,view1TotalDoses:0,
    view1Breakdown:[],facilityBreakdownV1:[],
    view2Passed:passed,view2Coverage:passed/eligible*100,
    view2ApplicableTotal:eligible,view2PendingCount:target-eligible,
    view2Breakdown:[],facilityBreakdownV2:[],
  };
}
function mount(age:Age,s:LegacyCompatibleGroupSummary=summary()){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}>
    <HdcFullyImmunizedComparison fiscalYear={2569} ageGroup={age} summary={s}/>
  </QueryClientProvider>);
}
afterEach(()=>{cleanup();vi.resetAllMocks()});

describe('View 2 HDC Fully Immunized optional reference',()=>{
  it.each(['1yr','2yr','3yr','5yr'] as const)(
    'loads no OpenData until expanded and isolates the %s report from all four ids',async age=>{
      const allRows=(['1yr','2yr','3yr','5yr'] as Age[]).map(a=>sourceRow(a));
      vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:allRows,isFromCache:true}});
      mount(age);
      expect(fetchApi).not.toHaveBeenCalled();
      const button=screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'});
      expect(button.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(await screen.findByText('75.00%')).toBeTruthy();
      expect(screen.getByText('50.00%')).toBeTruthy();
      expect(screen.getByText('+25.00 จุดร้อยละ')).toBeTruthy();
      expect(screen.getByText('3 / 4 คน')).toBeTruthy();
      expect(screen.getByText('2 / 4 คน')).toBeTruthy();
      expect(fetchApi).toHaveBeenCalledWith('getOpenData',{
        payload:{tableName:'s_epi_complete',year:'2569'},
      });
      expect(screen.getByRole('link',{name:'ดูรายงาน Fully Immunized ต้นทาง'}).getAttribute('href'))
        .toContain(HDC_COMPLETE_REPORTS[age]);
    }
  );

  it('shows numerical rates but NOT a gap if group population differs',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[sourceRow('3yr')]}});
    mount('3yr',summary(5,2,5));
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'}));
    expect(await screen.findByText('75.00%')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('ยังไม่สามารถสรุปส่วนต่าง');
    expect(screen.queryByText('+35.00 จุดร้อยละ')).toBeNull();
  });

  it('avoids a misleading gap for legacy summary without an applicable denominator',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[sourceRow('1yr')]}});
    const legacy=summary();
    delete legacy.view2ApplicableTotal;
    delete legacy.view2PendingCount;
    mount('1yr',legacy);
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'}));
    expect(await screen.findByText('75.00%')).toBeTruthy();
    expect(screen.getByText('ไม่ทราบตัวหาร')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('ยังไม่สามารถสรุปส่วนต่าง');
  });

  it('blocks a gap if EPI applicable denominator differs due to pending records',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[sourceRow('2yr')]}});
    mount('2yr',summary(4,2,3));
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'}));
    expect(await screen.findByText('75.00%')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('ยังไม่สามารถสรุปส่วนต่าง');
  });

  it('never fabricates a missing report or masks a failed HDC API',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[]}});
    mount('5yr');
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'}));
    expect((await screen.findByRole('status')).textContent).toContain('ยังไม่มีรายงาน HDC');
    expect(screen.queryByText('75.00%')).toBeNull();
  });

  it('shows API errors without modifying the EPI score',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:503,error:'upstream'}});
    mount('1yr');
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC Fully Immunized'}));
    expect((await screen.findByRole('alert')).textContent).toContain('ไม่สามารถเปรียบเทียบกับ HDC ได้');
    expect(screen.queryByText('75.00%')).toBeNull();
  });
});
