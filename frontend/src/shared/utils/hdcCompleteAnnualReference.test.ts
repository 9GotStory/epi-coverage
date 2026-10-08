import { describe,expect,it } from 'vitest';
import { HDC_COMPLETE_REPORTS, summarizeHdcCompleteAnnual } from './hdcCompleteAnnualReference';

const months = ['10','11','12','01','02','03','04','05','06','07','08','09'];
type Age = keyof typeof HDC_COMPLETE_REPORTS;

function makeRow(age:Age,overrides:Record<string,unknown>={}):Record<string,unknown>{
  const row:Record<string,unknown> = {
    id:HDC_COMPLETE_REPORTS[age],hospcode:'06413',areacode:'54060101',
    b_year:'2569',date_com:'202610072314',target:4,result:3,
  };
  for(const month of months){
    row['target'+month]=month==='10'?4:0;
    row['result'+month]=month==='10'?3:0;
  }
  return {...row,...overrides};
}

describe('HDC Fully Immunized annual report',()=>{
  it.each([
    ['1yr','28dd2c7955ce926456240b2ff0100bde'],
    ['2yr','35f4a8d465e6e1edc05f3d8ab658c551'],
    ['3yr','d1fe173d08e959397adf34b1d77e88d7'],
    ['5yr','f033ab37c30201f73f142449d037028d'],
  ] as const)('binds age %s to exactly the right report identity',(age,id)=>{
    const ref=summarizeHdcCompleteAnnual(
      [makeRow('1yr'),makeRow('2yr'),makeRow('3yr'),makeRow('5yr')],2569,age);
    expect(ref?.reportId).toBe(id);
    expect(ref?.target).toBe(4);
    expect(ref?.result).toBe(3);
    expect(ref?.rowCount).toBe(1);
    expect(ref?.table).toBe('s_epi_complete');
  });

  it('sums district rows with matching report/year and their annual counts',()=>{
    const ref=summarizeHdcCompleteAnnual([
      makeRow('2yr'),
      makeRow('2yr',{hospcode:'06414',areacode:'54060102',target:2,result:1,target10:2,result10:1}),
      makeRow('2yr',{areacode:'54070101',target:40,result:35,target10:40,result10:35}),
      makeRow('2yr',{b_year:'2568'}),
      makeRow('1yr'),
    ],2569,'2yr');
    expect(ref?.target).toBe(6);
    expect(ref?.result).toBe(4);
    expect(ref?.rowCount).toBe(2);
    expect(summarizeHdcCompleteAnnual([makeRow('2yr',{b_year:'2570'})],2569,'2yr')).toBeNull();
    expect(summarizeHdcCompleteAnnual([makeRow('2yr')],2569,'7yr')).toBeNull();
  });

  it('rejects duplicates, malformed columns, mixed snapshot dates and impossible counts',()=>{
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr'),makeRow('1yr')],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr'),makeRow('1yr',{areacode:'54060102',date_com:'202610082314'})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{result:5})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{result10:5})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{result:-1})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{target:'no-data'})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{date_com:'invalid'})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{hospcode:'6413'})],2569,'1yr')).toThrow();
    const incomplete=makeRow('1yr');
    delete incomplete.result09;
    expect(()=>summarizeHdcCompleteAnnual([incomplete],2569,'1yr')).toThrow();
  });

  it('verifies annual target/result match 12 monthly counts for EACH row',()=>{
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{target:5})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{result:2})],2569,'1yr')).toThrow();
    expect(()=>summarizeHdcCompleteAnnual([makeRow('1yr',{target:0,result:0,target10:0,result10:0})],2569,'1yr')).toThrow();
    expect(summarizeHdcCompleteAnnual([],2569,'1yr')).toBeNull();
  });

  it('accepts checked report count fields from the October 2026 FY2569 baseline',()=>{
    const baselines:[Age,number,number][]=[
      ['1yr',181,142],['2yr',203,72],['3yr',231,28],['5yr',264,26],
    ];
    for(const [age,target,result] of baselines){
      const row=makeRow(age,{target,result,target10:target,result10:result});
      const out=summarizeHdcCompleteAnnual([row],2569,age);
      expect(out?.target).toBe(target);
      expect(out?.result).toBe(result);
    }
  });
});
