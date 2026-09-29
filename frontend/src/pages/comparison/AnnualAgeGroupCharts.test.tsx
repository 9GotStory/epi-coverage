import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { DashboardSummaryRow, EpiTargetTable } from '../../shared/types/dashboardSummary';
import { buildAnnualComparisonModel } from './model';
import { AnnualAgeGroupCharts } from './AnnualAgeGroupCharts';

/**
 * Ticket #48 TDD public render seam. Synthetic aggregate data only.
 * Capture chart datapoints but assert business copy through rendered markup.
 */
const capture = vi.hoisted(() => ({
  charts: [] as Array<Array<{ fiscalYear: string; coverage: number | null; target: number | null }>>,
  bars: [] as string[],
  lines: [] as string[],
}));

vi.mock('recharts', () => {
  const stub = () => null;
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    __esModule: true,
    ResponsiveContainer: passthrough,
    ComposedChart: ({ data, children }: {
      data: Array<{ fiscalYear: string; coverage: number | null; target: number | null }>;
      children?: ReactNode;
    }) => { capture.charts.push(data); return children ?? null; },
    Bar: ({ dataKey }: { dataKey: string }) => { capture.bars.push(dataKey); return null; },
    Line: ({ dataKey }: { dataKey: string }) => { capture.lines.push(dataKey); return null; },
    XAxis: stub, YAxis: stub, Tooltip: stub, CartesianGrid: stub, Legend: stub, LabelList: stub,
  };
});

function snapshot(targetTable: EpiTargetTable, fiscalYear: number, overrides: Partial<DashboardSummaryRow['summaryData']> = {}): DashboardSummaryRow {
  return {
    id: targetTable + '_' + fiscalYear + '_all',
    targetTable,
    fiscalYear,
    updated_at: '2026-09-23T12:22:00.000Z',
    summaryData: {
      total: 100,
      view1Coverage: 80,
      view1PassedDoses: 80,
      view1TotalDoses: 100,
      view2Coverage: 70,
      view2Passed: 70,
      view2ApplicableTotal: 100,
      view2PendingCount: 0,
      ...overrides,
    },
  };
}

function renderGroup(rows: DashboardSummaryRow[], years: number[], group: EpiTargetTable = 'Epi_1_Year',
  target: (view: 1 | 2, fiscalYear: number) => number | undefined = () => undefined) {
  const model = buildAnnualComparisonModel(rows, years, target);
  const age = model.ageGroups.find(entry => entry.targetTable === group)!;
  return renderToStaticMarkup(<AnnualAgeGroupCharts group={age} />);
}

beforeEach(() => {
  capture.charts.length = 0;
  capture.bars.length = 0;
  capture.lines.length = 0;
});

describe('Ticket #48 — chart-first comparison rendering', () => {
  it('C01: View 1 and View 2 are two independent charts of selected FY values in ascending order', () => {
    const html = renderGroup([
      snapshot('Epi_1_Year', 2568, { view1Coverage: 81, view2Coverage: 71 }),
      snapshot('Epi_1_Year', 2569, { view1Coverage: 83, view2Coverage: 76 }),
    ], [2569, 2568], 'Epi_1_Year', (view, year) => view === 1 ? (year === 2568 ? 87 : 92) : (year === 2568 ? 89 : 90));
    expect(html).toContain('เด็กอายุ 1 ปี');
    expect(html).toContain('มุมมองที่ 1');
    expect(html).toContain('มุมมองที่ 2');
    expect(capture.charts).toHaveLength(2);
    expect(capture.charts[0]).toEqual([
      { fiscalYear: '2568', coverage: 81, target: 87 },
      { fiscalYear: '2569', coverage: 83, target: 92 },
    ]);
    expect(capture.charts[1]).toEqual([
      { fiscalYear: '2568', coverage: 71, target: 89 },
      { fiscalYear: '2569', coverage: 76, target: 90 },
    ]);
    expect(capture.bars).toEqual(['coverage','coverage']);
    expect(capture.lines).toEqual(['target','target']);
  });

  it('C02: composing the complete model renders all four age groups and exactly eight separate charts', () => {
    const rows: DashboardSummaryRow[] = [
      snapshot('Epi_1_Year', 2569), snapshot('Epi_2_Year', 2569),
      snapshot('Epi_3_Year', 2569), snapshot('Epi_5_Year', 2569),
    ];
    const model = buildAnnualComparisonModel(rows, [2569], () => undefined);
    const html = renderToStaticMarkup(<>{model.ageGroups.map(group => <AnnualAgeGroupCharts key={group.targetTable} group={group} />)}</>);
    for (const label of ['เด็กอายุ 1 ปี', 'เด็กอายุ 2 ปี', 'เด็กอายุ 3 ปี', 'เด็กอายุ 5 ปี']) {
      expect(html).toContain(label);
    }
    expect(capture.charts).toHaveLength(8);
    expect(capture.charts.every(chart => chart.length === 1)).toBe(true);
  });

  it('C03: numerator, denominator, percent, and annual target are visible without hovering; dose/person units remain distinct', () => {
    const html = renderGroup([
      snapshot('Epi_1_Year', 2569, {
        view1Coverage: 72.5, view1PassedDoses: 145, view1TotalDoses: 200,
        view2Coverage: 60, view2Passed: 30, view2ApplicableTotal: 50, view2PendingCount: 50,
      }),
    ], [2569], 'Epi_1_Year', v => v === 1 ? 95 : 90);
    expect(html).toContain('72.50%');
    expect(html).toContain('145 / 200 โดส');
    expect(html).toContain('60.00%');
    expect(html).toContain('30 / 50 คน');
    expect(html).toContain('เป้าหมาย 95.00%');
    expect(html).toContain('เป้าหมาย 90.00%');
  });

  it('C04: absent, not-evaluable and true zero states never collapse into one fake 0% bar', () => {
    const html = renderGroup([
      snapshot('Epi_1_Year', 2568, {
        view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 0,
        view2Coverage: 0, view2Passed: 0, view2ApplicableTotal: 10, view2PendingCount: 90,
      }),
    ], [2568, 2569]);
    expect(capture.charts[0]).toEqual([
      { fiscalYear: '2568', coverage: null, target: null },
      { fiscalYear: '2569', coverage: null, target: null },
    ]);
    expect(capture.charts[1]).toEqual([
      { fiscalYear: '2568', coverage: 0, target: null },
      { fiscalYear: '2569', coverage: null, target: null },
    ]);
    expect(html).toContain('ยังประเมินไม่ได้');
    expect(html).toContain('ไม่มีข้อมูลสรุป');
    expect(html).toContain('0.00%');
  });

  it('C05: legacy View 2 shows the stored coverage while saying its denominator is unavailable', () => {
    const html = renderGroup([
      snapshot('Epi_1_Year', 2568, {
        view2Coverage: 80, view2Passed: 8,
        view2ApplicableTotal: undefined, view2PendingCount: undefined,
      }),
    ], [2568]);
    expect(capture.charts[1][0].coverage).toBe(80);
    expect(html).toContain('80.00%');
    expect(html).toContain('ไม่ทราบจำนวนเข้าเกณฑ์');
    expect(html).not.toContain('8 / 100 คน');
  });

  it('C06: exactly one selected year shows an actual single-year result but no cross-year comparison', () => {
    const html = renderGroup([snapshot('Epi_1_Year', 2569)], [2569]);
    expect(html).toContain('ยังไม่มีปีงบประมาณอื่นสำหรับเปรียบเทียบ');
    expect(capture.charts[0]).toHaveLength(1);
    expect(capture.charts[1]).toHaveLength(1);
    expect(html).not.toContain('สูงกว่าปี');
    expect(html).not.toContain('ลดลงจากปี');
    expect(html).not.toContain('จุดร้อยละ');
  });

  it('C07: compared years and signed changes use plain Thai, not a primary pp abbreviation', () => {
    const html = renderGroup([
      snapshot('Epi_1_Year', 2567, { view1Coverage: 80, view2Coverage: 70 }),
      snapshot('Epi_1_Year', 2569, { view1Coverage: 80, view2Coverage: 65 }),
    ], [2569, 2568, 2567]);
    expect(html).toContain('ปี 2569 เท่ากับปี 2567');
    expect(html).toContain('ปี 2569 ลดลงจากปี 2567 อยู่ 5.00 จุดร้อยละ');
    expect(html).not.toMatch(/\bpp\b/);
  });

  it('C08: an increasing outcome reports its actual prior selected FY explicitly', () => {
    const html = renderGroup([
      snapshot('Epi_3_Year', 2567, { view1Coverage: 80 }),
      snapshot('Epi_3_Year', 2569, { view1Coverage: 85 }),
    ], [2567, 2568, 2569], 'Epi_3_Year');
    expect(html).toContain('ปี 2569 สูงกว่าปี 2567 อยู่ 5.00 จุดร้อยละ');
    expect(html).not.toContain('ปี 2569 สูงกว่าปี 2568');
  });

  it('C09: absent target explicitly states not configured; snapshot time is labeled computation time', () => {
    const html = renderGroup([snapshot('Epi_1_Year', 2569)], [2569], 'Epi_1_Year', () => undefined);
    expect(html).toContain('ไม่ได้กำหนดเป้าหมาย');
    expect(html).toContain('ข้อมูลสรุป ณ วันที่');
    expect(html).not.toContain('ข้อมูลอัปโหลดล่าสุด');
  });

  it('C10: charts have non-colour accessible labels and use responsive composition', () => {
    const html = renderGroup([snapshot('Epi_1_Year', 2569)], [2569]);
    expect(html).toContain('aria-label=');
    expect(html).toContain('ความครอบคลุม');
    expect(html).toContain('ปีงบประมาณ 2569');
    expect(html).toContain('grid-cols-1');
  });

  it('C11: no fiscal year selected shows prompt without any invented chart values', () => {
    const html = renderGroup([], []);
    expect(html).toContain('กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี');
    expect(capture.charts).toHaveLength(0);
  });
});
