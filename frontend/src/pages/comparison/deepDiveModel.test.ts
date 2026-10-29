import { describe, expect, it } from 'vitest';
import type { DashboardSummaryData, DashboardSummaryRow, EpiTargetTable, FacilityBreakdownEntry, VaccineBreakdownEntry } from '../../shared/types/dashboardSummary';
import { buildDeepDiveModel } from './deepDiveModel';

/**
 * Ticket #53: pure preparation only. All test data are synthetic yearly aggregates.
 * No individual data or production APIs are accessed.
 */
function summary(
  ageGroup: EpiTargetTable,
  fiscalYear: number,
  overrides: Partial<DashboardSummaryData> = {},
): DashboardSummaryRow {
  return {
    id: ageGroup + '_' + fiscalYear + '_all',
    targetTable: ageGroup,
    fiscalYear,
    updated_at: '2026-09-' + (fiscalYear - 2550) + 'T12:00:00.000Z',
    summaryData: {
      total: 100,
      view2Coverage: 70,
      view2Passed: 70,
      ...overrides,
    },
  };
}

const fac = (hoscode: string, hosname: string, coverage: number, passed = 8, total = 10): FacilityBreakdownEntry =>
  ({ hoscode, hosname, passed, total, coverage });
const vac = (metric_key: string | undefined, name: string, coverage: number, vaccine_group = 'dtp',
  passed = 8, total = 10): VaccineBreakdownEntry =>
  ({ metric_key, name, coverage, vaccine_group, passed, total });

type BuildOptions = Parameters<typeof buildDeepDiveModel>[0];
const prepare = (
  summaries: DashboardSummaryRow[],
  selectedYears: number[],
  options: Partial<Pick<BuildOptions, 'ageGroup' | 'view' | 'kind' | 'resolveTarget'>> = {},
) => buildDeepDiveModel({
  summaries,
  selectedYears,
  ageGroup: 'Epi_1_Year',
  view: 1,
  kind: 'facility',
  resolveTarget: () => undefined,
  ...options,
});
const series = (model: ReturnType<typeof buildDeepDiveModel>, key: string) => {
  const found = model.series.find(entry => entry.key === key);
  expect(found, 'the stored entity identity must appear').toBeDefined();
  return found!;
};

describe('Ticket #53: strict scope and fiscal years', () => {
  it('D01: selected annual FYs are ascending and unique, empty allowed; more than five rejected', () => {
    const a = prepare([], [2569, 2567, 2568, 2569]);
    expect(a.selectedYears).toEqual([2567, 2568, 2569]);
    expect(a.series).toEqual([]);
    expect(prepare([], []).selectedYears).toEqual([]);
    expect(() => prepare([], [2563,2564,2565,2566,2567,2568])).toThrow();
  });

  it('D02: facility identity is the exact hoscode string, never normalized or joined by display name', () => {
    const data = [
      summary('Epi_1_Year', 2568, {
        facilityBreakdownV1: [fac('06413', 'บ้านหนุน', 80), fac('6413', 'ชื่อซ้ำ', 65)],
      }),
      summary('Epi_1_Year', 2569, {
        facilityBreakdownV1: [fac('06413', 'บ้านหนุนชื่อใหม่', 85), fac('6413', 'ชื่อซ้ำ', 75)],
      }),
    ];
    const model = prepare(data, [2568, 2569]);
    expect(model.series.map(s => s.key)).toEqual(['6413', '06413']); // ranked from lower latest coverage
    expect(series(model, '06413').label).toBe('บ้านหนุนชื่อใหม่');
    expect(series(model, '06413').points.map(p => p.coverage)).toEqual([80,85]);
    expect(series(model, '6413').points.map(p => p.coverage)).toEqual([65,75]);
  });

  it('D03: View 1 and View 2 do not share values or compute a delta from one another', () => {
    const data = [summary('Epi_1_Year', 2569, {
      facilityBreakdownV1: [fac('06413','A', 0,0,20)],
      facilityBreakdownV2: [fac('06413','A', 90,9,10)],
    })];
    const v1 = prepare(data, [2569], { view: 1 });
    const v2 = prepare(data, [2569], { view: 2 });
    expect(series(v1,'06413').points[0]).toMatchObject({ state:'available',coverage:0,passed:0,total:20,delta:null });
    expect(series(v2,'06413').points[0]).toMatchObject({ state:'available',coverage:90,passed:9,total:10,delta:null });
    expect(v1.view).toBe(1);
    expect(v2.view).toBe(2);
  });

  it('D04: absent annual summary, missing entity, zero denominator and genuine zero are distinct', () => {
    const rows = [
      summary('Epi_1_Year',2567,{facilityBreakdownV1:[]}),
      summary('Epi_1_Year',2568,{facilityBreakdownV1:[fac('06413','A',0,0,0)]}),
      summary('Epi_1_Year',2569,{facilityBreakdownV1:[fac('06413','A',0,0,7)]}),
    ];
    const points = series(prepare(rows,[2566,2567,2568,2569]),'06413').points;
    expect(points.map(p => p.state)).toEqual(['missing-summary','missing-entry','not-evaluable','available']);
    expect(points.map(p => p.coverage)).toEqual([null,null,null,0]);
    expect(points[3].passed).toBe(0);
    expect(points[3].total).toBe(7);
  });
});

describe('Ticket #53: vaccine identity, gaps and targets', () => {
  it('D05: vaccine identity uses metric_key only, across renames; equal names with different keys stay separate', () => {
    const rows = [
      summary('Epi_1_Year',2568,{ view1Breakdown:[vac('metric-a','ชื่อเก่า',70), vac(undefined,'Legacy',66)] }),
      summary('Epi_1_Year',2569,{ view1Breakdown:[vac('metric-a','ชื่อใหม่',90),vac('metric-b','ชื่อใหม่',80)] }),
      summary('Epi_2_Year',2569,{ view1Breakdown:[vac('metric-a','อื่น',99)] }),
    ];
    const model = prepare(rows,[2568,2569],{kind:'vaccine'});
    expect(model.series).toHaveLength(2);
    expect(series(model,'metric-a').label).toBe('ชื่อใหม่');
    expect(series(model,'metric-a').points.map(p=>p.coverage)).toEqual([70,90]);
    expect(series(model,'metric-b').points.map(p=>p.coverage)).toEqual([null,80]);
    expect(model.legacyUnjoinableYears).toEqual([2568]);
    expect(model.series.every(s=>s.label!=='อื่น'&&s.label!=='Legacy')).toBe(true);
  });

  it('D06: changes use previous actual selected FY of this exact entity + View (not a guessed adjacent year)', () => {
    const rows = [
      summary('Epi_1_Year',2567,{facilityBreakdownV2:[fac('06413','A',80)]}),
      summary('Epi_1_Year',2568,{facilityBreakdownV2:[]}),
      summary('Epi_1_Year',2569,{facilityBreakdownV2:[fac('06413','A',75)]}),
    ];
    const model = prepare(rows,[2569,2567,2568],{view:2});
    expect(series(model,'06413').points[0].delta).toBeNull();
    expect(series(model,'06413').points[1].delta).toBeNull();
    expect(series(model,'06413').points[2].delta).toEqual({previousFiscalYear:2567,points:-5});
  });

  it('D07: vaccine target uses each fiscal year snapshot vaccine_group and selected View; absent target stays null', () => {
    const rows = [
      summary('Epi_1_Year',2568,{view2Breakdown:[vac('metric-a','MMR',80,'mmr')]}),
      summary('Epi_1_Year',2569,{view2Breakdown:[vac('metric-a','MMR',85,'dtp')]}),
    ];
    const calls: Array<[number,number,string|undefined]> = [];
    const model = prepare(rows,[2568,2569],{
      view:2, kind:'vaccine',
      resolveTarget:(view,fy,group)=>{calls.push([view,fy,group]);return fy===2568 ? 0 : undefined;},
    });
    expect(calls).toEqual([[2,2568,'mmr'],[2,2569,'dtp']]);
    expect(series(model,'metric-a').points.map(p=>p.target)).toEqual([0,null]);
    expect(series(model,'metric-a').points[0].updatedAt).toBe(rows[0].updated_at);
    expect(series(model,'metric-a').points[1].updatedAt).toBe(rows[1].updated_at);
  });

  it('D08: ranking uses latest selected FY real coverage ascending; missing latest entity goes last', () => {
    const rows = [
      summary('Epi_1_Year',2568,{facilityBreakdownV1:[fac('AAA','A',10),fac('BBB','B',40)]}),
      summary('Epi_1_Year',2569,{facilityBreakdownV1:[fac('AAA','A',75),fac('CCC','C',0,0,10)]}),
    ];
    const result=prepare(rows,[2568,2569]);
    expect(result.series.map(s=>s.key)).toEqual(['CCC','AAA','BBB']);
    expect(series(result,'CCC').points[1].state).toBe('available');
  });
});

describe('Ticket #53: historical integrity and invalid data', () => {
  it('D09: caller snapshots and selected years are not mutated; duplicate authoritative identities fail closed', () => {
    const rows=[summary('Epi_1_Year',2569,{facilityBreakdownV1:[fac('06413','A',80)]})];
    const years=[2569,2568];const before=structuredClone(rows);
    prepare(rows,years);
    expect(rows).toEqual(before);expect(years).toEqual([2569,2568]);
    expect(()=>prepare([...rows,{...rows[0],id:'legacy'}],[2569])).toThrow();
    expect(()=>prepare([summary('Epi_1_Year',2569,{
      facilityBreakdownV1:[fac('06413','A',80),fac('06413','A duplicate',90)],
    })],[2569])).toThrow();
  });

  it('D10: invalid counts and non-finite coverage never become chart values; missing entire breakdown is explicit', () => {
    const invalid=summary('Epi_1_Year',2569,{
      facilityBreakdownV1:[fac('06413','A',Number.NaN,11,10)],
    });
    const missing=summary('Epi_1_Year',2568);
    const model=prepare([missing,invalid],[2568,2569]);
    expect(model.missingBreakdownYears).toEqual([2568]);
    const points=series(model,'06413').points;
    expect(points[0]).toMatchObject({state:'missing-entry',coverage:null});
    expect(points[1]).toMatchObject({state:'invalid-entry',coverage:null});
  });

  it('D11: View 2 uses stored person counts, View 1 stored doses; never cohort-total fallbacks', () => {
    const rows=[summary('Epi_1_Year',2569,{
      total:500,
      view1Breakdown:[vac('v1','V1',30,'dtp',3,10)],
      view2Breakdown:[vac('v2','V2',60,'dtp',6,10)],
    })];
    const v1=prepare(rows,[2569],{kind:'vaccine',view:1});
    const v2=prepare(rows,[2569],{kind:'vaccine',view:2});
    expect(series(v1,'v1').points[0]).toMatchObject({passed:3,total:10,coverage:30});
    expect(series(v2,'v2').points[0]).toMatchObject({passed:6,total:10,coverage:60});
    expect(v2.series.some(s=>s.key==='v1')).toBe(false);
  });

  it('D12: other ages and unselected years never influence selected entity labels or values', () => {
    const rows=[
      summary('Epi_1_Year',2568,{view1Breakdown:[vac('one','Selected',80)]}),
      summary('Epi_1_Year',2569,{view1Breakdown:[vac('one','Unselected',99)]}),
      summary('Epi_2_Year',2568,{view1Breakdown:[vac('one','OtherAge',1),vac('two','Other',30)]}),
    ];
    const model=prepare(rows,[2568],{kind:'vaccine'});
    expect(model.series).toHaveLength(1);
    expect(series(model,'one').label).toBe('Selected');
    expect(series(model,'one').points[0].coverage).toBe(80);
  });
});
