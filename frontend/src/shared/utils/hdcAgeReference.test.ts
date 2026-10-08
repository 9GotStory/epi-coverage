import { describe,expect,it } from 'vitest';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { VaccineBreakdownEntry } from '../types/dashboardSummary';
import {getHdcAgeReport,summarizeHdcAgeAnnual,findHdcAgeMetric,HDC_AGE_REPORTS} from './hdcAnnualReference';

const months=['10','11','12','01','02','03','04','05','06','07','08','09'];
function example(age:'1yr'|'2yr'|'3yr'|'5yr',overrides:Record<string,unknown>={}){
  const config=HDC_AGE_REPORTS[age];
  const row:Record<string,unknown>={
    id:config.reportId,b_year:'2569',hospcode:'06413',areacode:'54060101',
    date_com:age==='1yr'?'20261007231223':'202610072313',
  };
  for(const m of months){
    row['target'+m]=0;
    for(const mapping of config.mappings)row[mapping.metric+'_'+m]=0;
  }
  return {...row,target10:4,...overrides};
}
function rule(age:string,metric:string,overrides:Partial<VaccineRule>={}):VaccineRule{
  const map=getHdcAgeReport(age)!.mappings.find(m=>m.metric===metric)!;
  return {
    rule_id:`rule-${age}-${metric}`,fiscal_year:2569,age_group:age,view_type:1,
    vaccine_group:map.vaccineGroup,display_name:`name-${metric}`,
    hdc_code:map.code,required_fields:[...map.fields],logic_type:map.logic,
    branch_alt_fields:[...(map.branch??[])],is_required_for_v2:true,is_active:true,
    ...overrides,
  };
}
function item(r:VaccineRule):VaccineBreakdownEntry{
  return {name:r.display_name,metric_key:r.rule_id,passed:3,total:4,coverage:75};
}

describe('HDC age-specific annual references',()=>{
  it.each([
    ['1yr','s_epi1','bcg','20261007231223'],
    ['2yr','s_epi2','dtp4','202610072313'],
    ['3yr','s_epi3','je3','202610072313'],
    ['5yr','s_epi5','opv5','202610072313'],
  ] as const)('supports HDC age %s from correct report with %s and %s', (age,table,metric,date)=>{
    const ref=summarizeHdcAgeAnnual([example(age,{[metric+'_10']:3})],2569,age);
    expect(ref?.table).toBe(table);
    expect(ref?.target).toBe(4);
    expect(ref?.numerators[metric]).toBe(3);
    expect(ref?.dateCom).toBe(date);
    expect(ref?.rowCount).toBe(1);
  });

  it('sums monthly counters across rows; ignores different report/year/district rows',()=>{
    const rows=[
      example('2yr',{dtp4_10:3}),
      example('2yr',{hospcode:'06414',areacode:'54060102',target10:2,dtp4_10:2}),
      example('2yr',{areacode:'54070101',target10:500,dtp4_10:500}),
      example('2yr',{b_year:'2568',target10:500,dtp4_10:500}),
      example('2yr',{id:'other-report',target10:500,dtp4_10:500}),
    ];
    const out=summarizeHdcAgeAnnual(rows,2569,'2yr');
    expect(out?.target).toBe(6);
    expect(out?.numerators.dtp4).toBe(5);
    expect(out?.rowCount).toBe(2);
    expect(summarizeHdcAgeAnnual([example('2yr',{b_year:'2570'})],2569,'2yr')).toBeNull();
    expect(summarizeHdcAgeAnnual([example('2yr')],2569,'unexpected')).toBeNull();
  });

  it('fails closed on incomplete count, malformed source row, duplicate, mixed upstream cycle, impossible numerator',()=>{
    const incomplete:Record<string,unknown>=example('3yr');delete incomplete['je3_09'];
    expect(()=>summarizeHdcAgeAnnual([incomplete],2569,'3yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr',{mmr1_10:null})],2569,'2yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr',{dtp4_10:-1})],2569,'2yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr',{dtp4_10:5})],2569,'2yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr',{date_com:'invalid'})],2569,'2yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr'),example('2yr')],2569,'2yr')).toThrow();
    expect(()=>summarizeHdcAgeAnnual([example('2yr'),example('2yr',{areacode:'54060102',date_com:'202610082313'})],2569,'2yr')).toThrow();
    const zero=example('5yr',{target10:0});
    expect(()=>summarizeHdcAgeAnnual([zero],2569,'5yr')).toThrow();
  });
});

describe('mapping source is vaccine_rules and is evidence-gated',()=>{
  it('maps HBV dose 3/4 with the documented HOSxP field swap, not by suffix inference',()=>{
    const third=rule('1yr','hbv3');
    const fourth=rule('1yr','hbv4');
    expect(third.required_fields).toEqual(['hbv4_date']);
    expect(fourth.required_fields).toEqual(['hbv3_date']);
    expect(findHdcAgeMetric(item(third),[third],2569,'1yr')).toBe('hbv3');
    expect(findHdcAgeMetric(item(fourth),[fourth],2569,'1yr')).toBe('hbv4');
    expect(findHdcAgeMetric(item(third),[{...third,required_fields:['hbv3_date']}],2569,'1yr')).toBeNull();
  });

  it('matches single active rule by fiscal year, age, code, group, branch, and persisted metric key',()=>{
    const r=rule('2yr','je2');
    expect(findHdcAgeMetric(item(r),[r],2569,'2yr')).toBe('je2');
    expect(findHdcAgeMetric(item(r),[{...r,branch_alt_fields:[]}],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[r],2570,'2yr')).toBeNull();
    expect(findHdcAgeMetric({...item(r),metric_key:undefined},[r],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[r,{...r,rule_id:'other'}],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[{...r,is_active:false}],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[{...r,hdc_code:'unknown'}],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[{...r,metric_key:'new-key'}],2569,'2yr')).toBeNull();
    expect(findHdcAgeMetric(item(r),[r],2569,'3yr')).toBeNull();
  });

  it('supports source-backed 3yr JE, 5yr DTP5 and verified HDC reporting names for all 1yr vaccine rows',()=>{
    const r3=rule('3yr','je3'),r5=rule('5yr','dtp5');
    expect(findHdcAgeMetric(item(r3),[r3],2569,'3yr')).toBe('je3');
    expect(findHdcAgeMetric(item(r5),[r5],2569,'5yr')).toBe('dtp5');
    // FY2569 HDC vs imported child birth-cohort parity: exact in all 12 months.
    const dtp3=rule('1yr','dtp_hb3');
    const ipv2=rule('1yr','ipv');
    const opv3=rule('1yr','opv3');
    expect(findHdcAgeMetric(item(dtp3),[dtp3],2569,'1yr')).toBe('dtp_hb3');
    expect(findHdcAgeMetric(item(ipv2),[ipv2],2569,'1yr')).toBe('ipv');
    expect(findHdcAgeMetric(item(opv3),[opv3],2569,'1yr')).toBe('opv3');
    // Wrong vaccine code or wrong physical input column must remain rejected.
    expect(findHdcAgeMetric(item(dtp3),[{...dtp3,hdc_code:'032'}],2569,'1yr')).toBeNull();
    expect(findHdcAgeMetric(item(ipv2),[{...ipv2,required_fields:['ipv1_date']}],2569,'1yr')).toBeNull();
    expect(findHdcAgeMetric(item(opv3),[{...opv3,required_fields:['opv1_date']}],2569,'1yr')).toBeNull();
  });

  it('allows future fiscal years only when they own an explicitly matching active rule',()=>{
    const r=rule('5yr','opv5',{fiscal_year:2570,rule_id:'new-year-id'});
    expect(findHdcAgeMetric(item(r),[r],2570,'5yr')).toBe('opv5');
    expect(findHdcAgeMetric(item(r),[r],2569,'5yr')).toBeNull();
  });
});
