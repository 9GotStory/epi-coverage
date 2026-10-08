/** @vitest-environment jsdom */
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { HdcView2DoseInsights } from './HdcView2DoseInsights';
import { getHdcAgeReport } from '../utils/hdcAnnualReference';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';

vi.mock('../lib/api',()=>({fetchApi:vi.fn()}));

const months=['10','11','12','01','02','03','04','05','06','07','08','09'];

function upstream(age:string,counts:Record<string,number>, target=20){
  const report=getHdcAgeReport(age)!;
  const obj:Record<string,unknown>={
    id:report.reportId,b_year:'2569',hospcode:'06413',areacode:'54060101',
    date_com:age==='1yr'?'20261007231223':'202610072313'
  };
  for(const month of months){
    obj['target'+month]=month==='10'?target:0;
    for(const m of report.mappings)obj[m.metric+'_'+month]=month==='10'?(counts[m.metric]??0):0;
  }
  return obj;
}
function setup(age:string,metrics:string[],excluded:string[]=[]){
  const mappings=getHdcAgeReport(age)!.mappings;
  const rules:VaccineRule[]=[];
  for(const metric of metrics){
    const m=mappings.find(x=>x.metric===metric)!;
    rules.push({
      rule_id:'r_'+metric,metric_key:'stable_'+metric,
      display_name:'วัคซีน '+metric,vaccine_group:m.vaccineGroup,
      required_fields:[...m.fields],branch_alt_fields:[...(m.branch??[])],
      logic_type:m.logic,hdc_code:m.code,fiscal_year:2569,age_group:age,
      view_type:1,is_active:true,is_required_for_v2:!excluded.includes(metric)
    });
  }
  const summary:LegacyCompatibleGroupSummary={
    total:20,view1PassedDoses:0,view1TotalDoses:0,view1Coverage:0,
    view1Breakdown:rules.map(r=>({
      name:r.display_name,metric_key:r.metric_key,passed:0,total:20,coverage:0
    })),
    facilityBreakdownV1:[],view2Passed:0,view2Coverage:0,
    view2Breakdown:[],facilityBreakdownV2:[],
  };
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}>
    <HdcView2DoseInsights fiscalYear={2569} ageGroup={age} summary={summary} rules={rules}/>
  </QueryClientProvider>);
}

afterEach(()=>{cleanup();vi.resetAllMocks()});

describe('View 2 dose insights use HDC per-vaccine report, never complete totals',()=>{
  it.each([['1yr','s_epi1','bcg'],['2yr','s_epi2','dtp4'],['3yr','s_epi3','je3'],['5yr','s_epi5','opv5']] as const)(
    'fetches %s report only on expansion',async(age,table,metric)=>{
      vi.mocked(fetchApi).mockResolvedValue({
        status:200,data:{statusCode:200,data:[upstream(age,{[metric]:17})]}
      });
      setup(age,[metric]);
      expect(fetchApi).not.toHaveBeenCalled();
      const button=screen.getByRole('button',{name:'ดูความครอบคลุมรายเข็มจาก HDC'});
      fireEvent.click(button);
      expect(await screen.findByText('85.00%')).toBeTruthy();
      expect(screen.getByText(/ได้รับ 17 \/ 20 คน/)).toBeTruthy();
      expect(screen.getByText(/ยังไม่มีผลงานในตัวชี้วัด 3 คน/)).toBeTruthy();
      expect(fetchApi).toHaveBeenCalledWith('getOpenData',{
        payload:{tableName:table,year:'2569'}
      });
      expect(screen.queryByText('HDC Fully Immunized')).toBeNull();
    }
  );

  it('shows lowest five first, expands all on demand, and excludes out-of-plan vaccines',async()=>{
    const chosen=['bcg','dtp1','dtp2','dtp_hb3','hib1','hib2','hib3','pcv1'];
    const counts={bcg:18,dtp1:13,dtp2:14,dtp_hb3:15,hib1:16,hib2:17,hib3:19,pcv1:0};
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[upstream('1yr',counts)]}});
    setup('1yr',chosen,['pcv1']);
    fireEvent.click(screen.getByRole('button',{name:'ดูความครอบคลุมรายเข็มจาก HDC'}));
    expect(await screen.findByText('65.00%')).toBeTruthy();
    expect(screen.getByRole('button',{name:'ดูรายเข็มทั้งหมด (7 รายการ)'})).toBeTruthy();
    expect(screen.queryByText('90.00%')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
    const first=screen.getAllByRole('listitem')[0];
    expect(first.textContent).toContain('dtp1');
    fireEvent.click(screen.getByRole('button',{name:'ดูรายเข็มทั้งหมด (7 รายการ)'}));
    expect(screen.getByText('90.00%')).toBeTruthy();
    expect(screen.queryByText('วัคซีน pcv1')).toBeNull();
    expect(screen.getByText(/ไม่รวม 1 รายการ/)).toBeTruthy();
  });

  it('fails closed on missing HDC report and never substitutes EPI values',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:200,data:[]}});
    setup('5yr',['dtp5']);
    fireEvent.click(screen.getByRole('button',{name:'ดูความครอบคลุมรายเข็มจาก HDC'}));
    expect(await screen.findByText('ยังไม่มีผลรายวัคซีน HDC สำหรับกลุ่มอายุและปีงบประมาณนี้')).toBeTruthy();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('shows upstream errors without losing the local EPI card',async()=>{
    vi.mocked(fetchApi).mockResolvedValue({status:200,data:{statusCode:503}});
    setup('2yr',['mmr2']);
    fireEvent.click(screen.getByRole('button',{name:'ดูความครอบคลุมรายเข็มจาก HDC'}));
    expect((await screen.findByRole('alert')).textContent).toMatch(/ไม่สามารถอ่านข้อมูลรายเข็ม HDC/);
  });
});
