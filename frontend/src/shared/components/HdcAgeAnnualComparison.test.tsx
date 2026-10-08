/** @vitest-environment jsdom */
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { HdcAgeAnnualComparison } from './HdcAgeAnnualComparison';
import { getHdcAgeReport } from '../utils/hdcAnnualReference';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

vi.mock('../lib/api',()=>({fetchApi:vi.fn()}));
const months=['10','11','12','01','02','03','04','05','06','07','08','09'];
function makeSource(age:string,metric:string){
  const config=getHdcAgeReport(age)!;
  const row:Record<string,unknown>={id:config.reportId,b_year:'2569',
    hospcode:'06413',areacode:'54060101',
    date_com:age==='1yr'?'20261007231223':'202610072313'};
  for(const month of months){
    row['target'+month]=0;
    for(const m of config.mappings)row[m.metric+'_'+month]=0;
  }
  return {...row,target10:4,[metric+'_10']:3};
}
function fixture(age:string,metric:string,denominator=4){
  const entry=getHdcAgeReport(age)!.mappings.find(m=>m.metric===metric)!;
  const rule:VaccineRule={rule_id:'synthetic-rule',fiscal_year:2569,age_group:age,view_type:1,
    vaccine_group:entry.vaccineGroup,display_name:'วัคซีนตัวอย่าง',hdc_code:entry.code,
    required_fields:[...entry.fields],branch_alt_fields:[...(entry.branch??[])],
    logic_type:entry.logic,is_active:true,is_required_for_v2:true};
  const summary:LegacyCompatibleGroupSummary={
    total:denominator,view1Coverage:50,view1PassedDoses:2,view1TotalDoses:4,
    view1Breakdown:[{name:rule.display_name,metric_key:rule.rule_id,passed:2,total:denominator,coverage:50}],
    facilityBreakdownV1:[],view2Passed:0,view2Coverage:0,view2Breakdown:[],facilityBreakdownV2:[],
  };
  const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={queryClient}>
    <HdcAgeAnnualComparison ageGroup={age} fiscalYear={2569} summary={summary} rules={[rule]}/>
  </QueryClientProvider>);
}
afterEach(()=>{cleanup();vi.resetAllMocks()});
describe('HDC read-only comparison for all 4 age groups',()=>{
  it.each([['1yr','s_epi1','bcg'],['2yr','s_epi2','dtp4'],['3yr','s_epi3','je3'],['5yr','s_epi5','opv5']] as const)(
    'is lazy and shows signed HDC − EPI for %s',
    async(age,table,metric)=>{
      vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[makeSource(age,metric)]}});
      fixture(age,metric);
      expect(fetchApi).not.toHaveBeenCalled();
      const toggle=screen.getByRole('button',{name:'เปรียบเทียบกับ HDC OpenData'});
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(await screen.findByText('75.00%')).toBeTruthy();
      expect(screen.getByText('50.00%')).toBeTruthy();
      expect(screen.getByText('+25.00 จุด')).toBeTruthy();
      expect(fetchApi).toHaveBeenCalledWith('getOpenData',{payload:{tableName:table,year:'2569'}});
    }
  );
  it('withholds the percentage point gap when HDC and EPI target differ',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[makeSource('5yr','dtp5')]}});
    fixture('5yr','dtp5',5);
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC OpenData'}));
    expect(await screen.findByText('75.00%')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('ประชากรเป้าหมายไม่ตรงกัน');
    expect(screen.getByText('เทียบไม่ได้')).toBeTruthy();
  });
  it('never substitutes a fabricated HDC percentage on an upstream error',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:503}});
    fixture('2yr','mmr1');
    fireEvent.click(screen.getByRole('button',{name:'เปรียบเทียบกับ HDC OpenData'}));
    expect((await screen.findByRole('alert')).textContent).toContain('ไม่สามารถเปรียบเทียบกับ HDC ได้');
    expect(screen.queryByText('75.00%')).toBeNull();
  });
});
