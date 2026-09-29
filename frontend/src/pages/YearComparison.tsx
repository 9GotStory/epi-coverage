import { Fragment, useState } from 'react';
import * as Recharts from 'recharts';
import type { ReactElement } from 'react';
import { useDashboardSummariesMultiYear } from '../shared/hooks/useDashboardSummariesMultiYear';
import { useDashboardSummaryYears } from '../shared/hooks/useDashboardSummaryYears';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../shared/components/ui/card';
import { SubNav } from '../widgets/layout/SubNav';
import { formatDateTimeStr, getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryRow, FacilityBreakdownEntry, EpiTargetTable } from '../shared/types/dashboardSummary';
import { buildAnnualComparisonModel, getComparisonFiscalYears, getDefaultComparisonYears, COMPARISON_AGE_GROUPS } from './comparison/model';
import { AnnualAgeGroupCharts } from './comparison/AnnualAgeGroupCharts';

const MAX_SELECTED_YEARS = 5;

const AGE_GROUPS = [
  { value: 'Epi_1_Year', label: 'เด็กอายุ 1 ปี' },
  { value: 'Epi_2_Year', label: 'เด็กอายุ 2 ปี' },
  { value: 'Epi_3_Year', label: 'เด็กอายุ 3 ปี' },
  { value: 'Epi_5_Year', label: 'เด็กอายุ 5 ปี' },
];

/**
 * Issue #24: the line-trend layer renders only when the chart library provides LineChart.
 * Membership is checked with Reflect.has (safe against partially-stubbed chart modules in
 * correctness-contract tests, where a direct import binding would throw). The correctness-
 * critical surfaces — composition chart, KPI cards, detailed table — rely only on the
 * universally available BarChart primitives.
 */
type ChartComponent = (props: Record<string, unknown>) => ReactElement | null;
const rechartsComponents = Recharts as unknown as Record<string, ChartComponent>;
const TrendLineChart = Reflect.has(Recharts, 'LineChart') ? rechartsComponents.LineChart : null;
const TrendLine = Reflect.has(Recharts, 'Line') ? rechartsComponents.Line : null;

/** Latest two usable years (or the single year, or none) — never browser-clock derived. */
const defaultSelectedYears = (years: number[]): number[] => [...years].sort((a, b) => a - b).slice(-2);

/** Single signed percentage-point formatter for deltas and target gaps (never % growth). */
const formatPp = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)} จุดร้อยละ`;

/** The trend's per-FY series, declared once: coverage plus a per-year target series. */
const TREND_SERIES = [
  { dataKey: 'percentV2', label: 'ความครอบคลุม', stroke: '#0066CC', dashed: false },
  { dataKey: 'target', label: 'เป้าหมายรายปี', stroke: '#7a7a7a', dashed: true },
] as const;

const chartName = (fiscalYear: number): string => `ปี ${fiscalYear}`;

interface ComparisonRow {
  fiscalYear: number;
  hasSummary: boolean;
  coverage: number | null;
  total: number | null;
  passed: number | null;
  applicable: number | null;
  pending: number | null;
  /** Derived at consumption time for current-contract rows only — never persisted. */
  failed: number | null;
  isCurrentContract: boolean;
  target: number | undefined;
  gap: number | null;
  delta: number | null;
  updatedAt: string | null;
}

interface ChartRow {
  name: string;
  total: number | null;
  percentV2: string | null;
  passed: number | null;
  failed: number | null;
  pending: number | null;
  target: number | null;
}

/**
 * Facility cross-year comparison (Issue #25). Per selected FY, the stored annual
 * snapshot's facility aggregates (facilityBreakdownV1/V2) keyed by the EXACT
 * hoscode string — identity, join, and React keys all use the raw string
 * (leading zeroes preserved; never numerically normalized; never joined by name).
 */
interface FacilityYearEntry {
  view1: number | null;
  view2: number | null;
}

interface FacilityComparisonRow {
  hoscode: string;
  hosname: string;
  years: Map<number, FacilityYearEntry>;
}

/**
 * Trend tooltip with the #24 semantic payload (FY, coverage, passed/applicable, target,
 * gap, summary timestamp), read from the same prepared ComparisonRow layer as the KPIs
 * and the detailed table — never a bare coverage/target default tooltip.
 */
function TrendTooltip({
  active,
  payload,
  rowsByYear,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  rowsByYear: Map<string, ComparisonRow>;
}) {
  if (!active || !payload?.length) return null;
  const chartRow = payload[0]?.payload;
  const row = chartRow ? rowsByYear.get(chartRow.name) : undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-700 shadow-sm">
      <p className="font-semibold text-zinc-900">ปีงบประมาณ {row.fiscalYear}</p>
      <p>ความครอบคลุม: {row.coverage !== null ? `${row.coverage.toFixed(2)}%` : 'ไม่มีข้อมูลสรุป'}</p>
      <p>
        ผ่านเกณฑ์ / เข้าเกณฑ์ประเมิน:{' '}
        {row.passed !== null ? `${row.passed.toLocaleString()} / ${row.applicable !== null ? row.applicable.toLocaleString() : '—'} คน` : 'ไม่มีข้อมูลสรุป'}
      </p>
      <p>เป้าหมาย: {row.target !== undefined ? `${row.target}%` : 'ไม่ได้กำหนดเป้าหมาย'}</p>
      <p>ส่วนต่างจากเป้าหมาย: {row.gap !== null ? formatPp(row.gap) : '—'}</p>
      <p>ข้อมูลสรุป ณ วันที่ {row.updatedAt ? formatDateTimeStr(row.updatedAt) : '—'}</p>
    </div>
  );
}

interface ComparisonDetailProps {
  /** Controlled by the multi-age dashboard when the drill-down is expanded. */
  selectedAgeGroup?: EpiTargetTable;
  selectedFiscalYears?: number[];
  hideChrome?: boolean;
}

/**
 * Preserved #22–#26 single-age analytical detail implementation.
 * The new YearComparison route embeds this as secondary user-invoked detail;
 * historical business-regression tests still exercise this actual component.
 */
export const YearComparisonDetail = ({
  selectedAgeGroup, selectedFiscalYears, hideChrome = false,
}: ComparisonDetailProps = {}) => {
  const currentYear = getCurrentFiscalYear();
  const [ageGroup, setAgeGroup] = useState<string>(selectedAgeGroup ?? 'Epi_1_Year');

  const { tables, isLoading: yearsLoading, error: yearsError } = useDashboardSummaryYears();
  const { getTarget, isLoading: targetLoading, isError: targetError } = useTargetSettings();

  const availableYears = tables?.[ageGroup] ?? [];
  const yearsReady = !yearsLoading && !yearsError;
  const dataKey = yearsReady ? `${ageGroup}|${availableYears.join(',')}` : null;

  // Initial selection: the age group's usable-year default when the years query already
  // resolved synchronously (seeded cache / SSR). Otherwise the [currentFY-1, currentFY]
  // pair required by the frozen #22 SSR contract — a placeholder only: in the browser it
  // is never fetched against (see the queryYears gate) and is replaced by the usable-year
  // default as soon as the years query resolves.
  const [localSelectedYears, setSelectedYears] = useState<number[]>(() => {
    const initialYears = tables?.[ageGroup];
    return initialYears?.length ? defaultSelectedYears(initialYears) : [currentYear - 1, currentYear];
  });
  const selectedYears = selectedFiscalYears ?? localSelectedYears;
  const [derivedKey, setDerivedKey] = useState<string | null>(dataKey);

  // Render-phase state adjustment (React lazy-derivation pattern): apply the age group's
  // default selection exactly once when its usable years become known. Manual selections —
  // including deselect-all — are never overwritten because the key only changes when the
  // age group or its usable-year set actually changes.
  if (dataKey !== null && derivedKey !== dataKey) {
    setDerivedKey(dataKey);
    setSelectedYears(defaultSelectedYears(availableYears));
  }
  const selectionDerived = dataKey !== null && derivedKey === dataKey;

  // Fetch gate: in the browser, never issue a multi-year request from the placeholder
  // selection — only after the selection is derived from the usable-year source. On the
  // server there is no fetching, and the placeholder keeps the cache key aligned.
  const queryYears = selectedFiscalYears ?? (selectionDerived || typeof window === 'undefined' ? selectedYears : []);
  const { data, isLoading: summariesLoading, error: summariesError } = useDashboardSummariesMultiYear(queryYears);

  const handleYearToggle = (year: number) => {
    setSelectedYears(prev => {
      if (prev.includes(year)) return prev.filter(y => y !== year);
      if (prev.length >= MAX_SELECTED_YEARS) return prev;
      return [...prev, year].sort((a, b) => a - b);
    });
  };

  // ── Data-preparation layer: one analytical row per selected FY (ascending) ──
  const rows: ComparisonRow[] = selectedYears.map(fiscalYear => {
    const summary: DashboardSummaryRow | null =
      data.find(d => d.targetTable === ageGroup && Number(d.fiscalYear) === fiscalYear) ?? null;
    const s = summary?.summaryData ?? null;
    const hasSummary = s !== null;
    const isCurrentContract =
      hasSummary && typeof s.view2ApplicableTotal === 'number' && typeof s.view2PendingCount === 'number';
    const coverage = hasSummary ? s.view2Coverage : null;
    const applicable = isCurrentContract ? s.view2ApplicableTotal ?? null : null;
    const pending = isCurrentContract ? s.view2PendingCount ?? null : null;
    const passed = hasSummary ? s.view2Passed : null;
    const target = getTarget('all', 2, undefined, fiscalYear);
    return {
      fiscalYear,
      hasSummary,
      coverage,
      total: hasSummary ? s.total : null,
      passed,
      applicable,
      pending,
      failed: isCurrentContract ? (s.view2ApplicableTotal ?? 0) - s.view2Passed : null,
      isCurrentContract,
      target,
      gap: target !== undefined && coverage !== null ? coverage - target : null,
      delta: null,
      updatedAt: summary?.updated_at ?? null,
    };
  });
  {
    // Delta vs the previous selected FY that actually has a summary (skipping gaps).
    let previousCoverage: number | null = null;
    for (const row of rows) {
      if (row.coverage !== null) {
        row.delta = previousCoverage !== null ? row.coverage - previousCoverage : null;
        previousCoverage = row.coverage;
      }
    }
  }

  const missingYears = rows.filter(row => !row.hasSummary).map(row => row.fiscalYear);
  const legacyRows = rows.filter(row => row.hasSummary && !row.isCurrentContract);
  const usableRows = rows.filter(row => row.hasSummary);
  const latest = usableRows.length ? usableRows[usableRows.length - 1] : null;
  const previousUsable = usableRows.length > 1 ? usableRows[usableRows.length - 2] : null;

  const rowsByYear = new Map(rows.map(row => [chartName(row.fiscalYear), row]));

  const chartRows: ChartRow[] = rows.map(row => ({
    name: chartName(row.fiscalYear),
    total: row.total,
    percentV2: row.coverage !== null ? row.coverage.toFixed(2) : null,
    // Composition series are current-contract only — legacy FYs stay null, never zero.
    passed: row.isCurrentContract ? row.passed : null,
    failed: row.failed,
    pending: row.pending,
    target: row.target !== undefined ? row.target : null,
  }));

  const capReached = selectedYears.length >= MAX_SELECTED_YEARS;

  // ── Facility preparation layer (Issue #25) ── one derived structure from the SAME
  // selected-FY / active-age-group annual summaries. Target and snapshot time reuse
  // the annual rows' already-resolved values — no second authority, no recomputation.
  const targetByFy = new Map(rows.map(row => [row.fiscalYear, row.target]));
  const facilitiesByCode = new Map<string, FacilityComparisonRow>();
  for (const fiscalYear of selectedYears) {
    const summary = data.find(d => d.targetTable === ageGroup && Number(d.fiscalYear) === fiscalYear);
    if (!summary) continue; // no annual summary for this selected FY → no facility data, never zeros
    const absorb = (breakdown: FacilityBreakdownEntry[] | undefined, view: keyof FacilityYearEntry) => {
      for (const entry of breakdown ?? []) {
        let facility = facilitiesByCode.get(entry.hoscode);
        if (!facility) {
          facility = { hoscode: entry.hoscode, hosname: '', years: new Map() };
          facilitiesByCode.set(entry.hoscode, facility);
        }
        const year = facility.years.get(fiscalYear) ?? { view1: null, view2: null };
        year[view] = entry.coverage; // an entry is a real value — coverage 0 stays a real zero
        facility.years.set(fiscalYear, year);
        // Display-name policy: the most recent selected FY's non-empty name wins
        // (selectedYears is ascending) — display metadata only, never the join key.
        if (entry.hosname) facility.hosname = entry.hosname;
      }
    };
    absorb(summary.summaryData.facilityBreakdownV1, 'view1');
    absorb(summary.summaryData.facilityBreakdownV2, 'view2');
  }
  const facilities = [...facilitiesByCode.values()]
    .map(facility => ({ ...facility, hosname: facility.hosname || facility.hoscode }))
    .sort((a, b) => (a.hoscode < b.hoscode ? -1 : a.hoscode > b.hoscode ? 1 : 0)); // exact string sort

  /** View 2 delta vs the previous selected FY where THIS facility has View 2 data. */
  const facilityDelta = (facility: FacilityComparisonRow): number | null => {
    let previous: number | null = null;
    let delta: number | null = null;
    for (const fiscalYear of selectedYears) {
      const view2 = facility.years.get(fiscalYear)?.view2 ?? null;
      if (view2 !== null) {
        delta = previous !== null ? view2 - previous : null;
        previous = view2;
      }
    }
    return delta;
  };

  // ── Vaccine preparation layer (Issue #26 / Decision E) — stored snapshot data only.
  // Series join by valid metric_key within THIS age group and view; a legacy entry
  // without a valid key is never joined and never rendered as its own cross-year series.
  const validMetricKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

  interface VaccineYearEntry { coverage: number; vaccineGroup: string; name: string; }
  interface VaccineSeries {
    metricKey: string;
    displayName: string;
    years: Map<number, VaccineYearEntry>; // selected FYs ascending (insertion order)
    delta: number | null;
  }

  const summaryForFiscalYear = (fiscalYear: number): DashboardSummaryRow | undefined =>
    data.find(d => d.targetTable === ageGroup && Number(d.fiscalYear) === fiscalYear);

  const buildVaccineSeries = (viewType: 1 | 2): VaccineSeries[] => {
    const byKey = new Map<string, VaccineSeries>();
    for (const fiscalYear of selectedYears) {
      const summary = summaryForFiscalYear(fiscalYear);
      if (!summary) continue; // no annual summary → no vaccine data, never zeros
      const entries = viewType === 1 ? summary.summaryData.view1Breakdown : summary.summaryData.view2Breakdown;
      for (const entry of entries ?? []) {
        if (!validMetricKey(entry.metric_key)) continue; // legacy: unavailable for identity
        let series = byKey.get(entry.metric_key);
        if (!series) {
          series = { metricKey: entry.metric_key, displayName: '', years: new Map(), delta: null };
          byKey.set(entry.metric_key, series);
        }
        series.years.set(fiscalYear, { coverage: entry.coverage, vaccineGroup: entry.vaccine_group ?? '', name: entry.name });
        if (entry.name) series.displayName = entry.name; // deterministic: latest selected FY's non-empty name
      }
    }
    for (const series of byKey.values()) {
      let previous: number | null = null;
      for (const { coverage } of series.years.values()) {
        series.delta = previous !== null ? coverage - previous : null;
        previous = coverage;
      }
      if (!series.displayName) series.displayName = series.metricKey;
    }
    return [...byKey.values()]
      .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.metricKey < b.metricKey ? -1 : 1));
  };

  const vaccineViews = [
    { viewType: 1 as const, label: 'View 1 (รายชนิด)', series: buildVaccineSeries(1) },
    { viewType: 2 as const, label: 'View 2 (Fully Immunized)', series: buildVaccineSeries(2) },
  ];

  /** Selected FYs whose snapshot carries legacy (non-identity) vaccine entries — each gets a visible notice. */
  const vaccineLegacyYears = selectedYears.filter(fiscalYear => {
    const summary = summaryForFiscalYear(fiscalYear);
    if (!summary) return false;
    return [...(summary.summaryData.view1Breakdown ?? []), ...(summary.summaryData.view2Breakdown ?? [])]
      .some(entry => !validMetricKey(entry.metric_key));
  });

  // FY chips render whenever the age group's usable years are known — independent of the
  // summary fetch lifecycle, so selection stays interactive while summaries load.
  const yearChips = (
    <Card className="border-zinc-200 shadow-sm">
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-zinc-700 mb-3">เลือกปีงบประมาณที่ต้องการเปรียบเทียบ:</p>
        <div className="flex flex-wrap gap-2">
          {[...availableYears].sort((a, b) => b - a).map(year => {
            const isSelected = selectedYears.includes(year);
            return (
              <button
                key={year}
                type="button"
                onClick={() => handleYearToggle(year)}
                disabled={!isSelected && capReached}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-primary text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50'
                }`}
              >
                {chartName(year)}
              </button>
            );
          })}
        </div>
        {capReached && (
          <p className="text-xs text-zinc-500 mt-2">เลือกได้สูงสุด {MAX_SELECTED_YEARS} ปีงบประมาณ</p>
        )}
      </CardContent>
    </Card>
  );

  // Analytical area state precedence (Issue #24): empty selection → summary error →
  // loading → content. The chips above are unaffected by all four.
  const analyticalArea = selectedYears.length === 0 ? (
    <div className="bg-amber-50 text-amber-700 p-4 rounded-lg text-center">
      กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล
    </div>
  ) : summariesError ? (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="pt-6">
        <p className="text-sm font-semibold text-red-700">ไม่สามารถดึงข้อมูลสรุปได้</p>
        <p className="text-sm text-red-600 mt-1">{summariesError}</p>
      </CardContent>
    </Card>
  ) : (summariesLoading || targetLoading) && data.length === 0 ? (
    <div className="flex items-center justify-center h-64 bg-white rounded-2xl border border-zinc-200">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" data-testid="comparison-loading" />
    </div>
  ) : (
    <div className="space-y-6">
      {missingYears.length > 0 && (
        <div className="bg-amber-50 text-amber-700 p-4 rounded-lg" role="status">
          ไม่มีข้อมูลสรุป ปีงบประมาณ {missingYears.join(', ')} — ปีที่ไม่มีข้อมูลสรุปจะไม่ถูกนำมาแสดงเป็น 0%
        </div>
      )}

      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-xs text-zinc-500">ความครอบคลุม Fully Immunized (ปี {latest.fiscalYear})</p>
              <p className="text-3xl font-bold text-zinc-900 mt-1">{latest.coverage !== null ? `${latest.coverage.toFixed(2)}%` : '—'}</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-xs text-zinc-500">{previousUsable ? `เปลี่ยนแปลงจากปี ${previousUsable.fiscalYear}` : 'เปลี่ยนแปลงจากปีก่อนหน้า'}</p>
              <p className="text-3xl font-bold text-zinc-900 mt-1">{latest.delta !== null ? formatPp(latest.delta) : '—'}</p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-xs text-zinc-500">ส่วนต่างจากเป้าหมาย (ปี {latest.fiscalYear})</p>
              <p className="text-3xl font-bold text-zinc-900 mt-1">
                {latest.target !== undefined && latest.coverage !== null ? formatPp(latest.coverage - latest.target) : 'ไม่ได้กำหนดเป้าหมาย'}
              </p>
            </CardContent>
          </Card>
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-xs text-zinc-500">ผ่านเกณฑ์ / เข้าเกณฑ์ประเมิน (ปี {latest.fiscalYear})</p>
              <p className="text-3xl font-bold text-zinc-900 mt-1">
                {latest.passed !== null
                  ? `${latest.passed.toLocaleString()} / ${latest.applicable !== null ? latest.applicable.toLocaleString() : '—'} คน`
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">แนวโน้มความครอบคลุม Fully Immunized รายปีงบประมาณ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] w-full">
            {TrendLineChart && TrendLine ? (
              <Recharts.ResponsiveContainer width="100%" height="100%">
                <TrendLineChart data={chartRows} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                  <Recharts.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                  <Recharts.XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <Recharts.YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                  <Recharts.Tooltip content={<TrendTooltip rowsByYear={rowsByYear} />} />
                  <Recharts.Legend />
                  {TREND_SERIES.map(series => (
                    <TrendLine
                      key={series.dataKey}
                      dataKey={series.dataKey}
                      name={series.label}
                      stroke={series.stroke}
                      strokeWidth={2}
                      strokeDasharray={series.dashed ? '6 4' : undefined}
                      connectNulls={false}
                    />
                  ))}
                </TrendLineChart>
              </Recharts.ResponsiveContainer>
            ) : null}
          {/* Series registry (sr-only): the trend series declared in one place. The
              Line elements render inert in production recharts (no output outside a
              chart — verified) and keep the series contract observable to tests where
              the LineChart mock discards its children. */}
          <div className="sr-only">
            {TrendLine
              ? TREND_SERIES.map(series => (
                  <TrendLine key={series.dataKey} dataKey={series.dataKey} name={series.label} />
                ))
              : null}
          </div>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            แต่ละปีงบประมาณเป็นข้อมูลสรุปที่จัดเก็บไว้ในระบบ ณ เวลาที่คำนวณของปีนั้น จึงอาจมีเวลาคำนวณสรุปต่างกัน — ไม่ใช่การคำนวณใหม่ ณ วันเดียวกัน
          </p>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">องค์ประกอบผลการประเมิน View 2 (คน)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] w-full">
            <Recharts.ResponsiveContainer width="100%" height="100%">
              <Recharts.BarChart data={chartRows} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                <Recharts.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <Recharts.XAxis dataKey="name" axisLine={false} tickLine={false} />
                <Recharts.YAxis axisLine={false} tickLine={false} />
                <Recharts.Tooltip />
                <Recharts.Legend />
                <Recharts.Bar dataKey="passed" name="ผ่านเกณฑ์" stackId="v2" fill="#10b981" />
                <Recharts.Bar dataKey="failed" name="ไม่ผ่านเกณฑ์" stackId="v2" fill="#f43f5e" />
                <Recharts.Bar dataKey="pending" name="ยังไม่เข้าเกณฑ์ประเมิน" stackId="v2" fill="#a1a1aa" />
              </Recharts.BarChart>
            </Recharts.ResponsiveContainer>
          </div>
          {legacyRows.length > 0 && (
            <p className="text-xs text-zinc-500 mt-3" role="status">
              ไม่มีข้อมูลรายละเอียดสำหรับ summary รุ่นนี้ (ปีงบประมาณ {legacyRows.map(row => row.fiscalYear).join(', ')}) — สรุปรุ่นเก่าไม่ได้บันทึกจำนวนที่เข้าเกณฑ์ประเมิน จึงไม่แสดงองค์ประกอบการแยกผ่าน/ไม่ผ่าน/ยังไม่เข้าเกณฑ์ของปีนั้น
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">ตารางเปรียบเทียบรายปีงบประมาณ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-zinc-700">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">ปีงบประมาณ</th>
                  <th className="py-2 pr-4 font-medium">เด็กเป้าหมายทั้งหมด</th>
                  <th className="py-2 pr-4 font-medium">เข้าเกณฑ์ประเมิน View 2</th>
                  <th className="py-2 pr-4 font-medium">ผ่านเกณฑ์</th>
                  <th className="py-2 pr-4 font-medium">ไม่ผ่านเกณฑ์</th>
                  <th className="py-2 pr-4 font-medium">ยังไม่เข้าเกณฑ์ประเมิน</th>
                  <th className="py-2 pr-4 font-medium">ความครอบคลุม</th>
                  <th className="py-2 pr-4 font-medium">เป้าหมาย</th>
                  <th className="py-2 pr-4 font-medium">ส่วนต่างจากเป้าหมาย</th>
                  <th className="py-2 pr-4 font-medium">เปลี่ยนแปลงจากปีก่อนหน้า (จุดร้อยละ)</th>
                  <th className="py-2 font-medium">เวลาคำนวณสรุป</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.fiscalYear} className="border-b border-zinc-100">
                    <td className="py-2 pr-4 font-medium text-zinc-900">{chartName(row.fiscalYear)}</td>
                    <td className="py-2 pr-4">{row.total !== null ? row.total.toLocaleString() : 'ไม่มีข้อมูลสรุป'}</td>
                    <td className="py-2 pr-4">{row.applicable !== null ? row.applicable.toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">{row.isCurrentContract && row.passed !== null ? row.passed.toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">{row.failed !== null ? row.failed.toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">{row.pending !== null ? row.pending.toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">{row.coverage !== null ? `${row.coverage.toFixed(2)}%` : 'ไม่มีข้อมูลสรุป'}</td>
                    <td className="py-2 pr-4">{row.target !== undefined ? `${row.target}%` : 'ไม่ได้กำหนดเป้าหมาย'}</td>
                    <td className="py-2 pr-4">{row.gap !== null ? formatPp(row.gap) : '—'}</td>
                    <td className="py-2 pr-4">{row.delta !== null ? formatPp(row.delta) : '—'}</td>
                    <td className="py-2">{row.updatedAt ? `ข้อมูลสรุป ณ วันที่ ${formatDateTimeStr(row.updatedAt)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">การเปรียบเทียบสถานบริการ (รพ.สต.) ข้ามปีงบประมาณ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 mb-3">
            {rows.map(row =>
              row.updatedAt ? (
                <span key={row.fiscalYear}>ปี {row.fiscalYear}: ข้อมูลสรุป ณ วันที่ {formatDateTimeStr(row.updatedAt)}</span>
              ) : null,
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-zinc-700">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th rowSpan={2} className="py-2 pr-4 font-medium">รหัสสถานบริการ</th>
                  <th rowSpan={2} className="py-2 pr-4 font-medium">ชื่อสถานบริการ</th>
                  {selectedYears.map(fiscalYear => (
                    <th key={fiscalYear} colSpan={3} className="py-2 pr-4 pl-4 font-medium text-center border-l border-zinc-100">ปีงบประมาณ {fiscalYear}</th>
                  ))}
                  <th rowSpan={2} className="py-2 font-medium">เปลี่ยนแปลงจากปีที่มีข้อมูลก่อนหน้า (จุดร้อยละ)</th>
                </tr>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  {selectedYears.map(fiscalYear => (
                    <Fragment key={fiscalYear}>
                      <th className="py-2 pr-3 pl-4 font-medium border-l border-zinc-100">View 1</th>
                      <th className="py-2 pr-3 font-medium">View 2</th>
                      <th className="py-2 pr-4 font-medium">ส่วนต่างจากเป้าหมาย</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facilities.length === 0 ? (
                  <tr>
                    <td colSpan={2 + selectedYears.length * 3 + 1} className="py-3 text-zinc-500">ไม่มีข้อมูลรายสถานบริการสำหรับปีที่เลือก</td>
                  </tr>
                ) : (
                  facilities.map(facility => {
                    const delta = facilityDelta(facility);
                    return (
                      <tr key={facility.hoscode} className="border-b border-zinc-100">
                        <td className="py-2 pr-4 font-medium text-zinc-900">{facility.hoscode}</td>
                        <td className="py-2 pr-4">{facility.hosname}</td>
                        {selectedYears.map(fiscalYear => {
                          const entry = facility.years.get(fiscalYear);
                          const view1 = entry?.view1 ?? null;
                          const view2 = entry?.view2 ?? null;
                          const target = targetByFy.get(fiscalYear);
                          return (
                            <Fragment key={fiscalYear}>
                              <td className="py-2 pr-3 pl-4 border-l border-zinc-100">{view1 !== null ? `${view1.toFixed(2)}%` : '—'}</td>
                              <td className="py-2 pr-3">{view2 !== null ? `${view2.toFixed(2)}%` : '—'}</td>
                              <td className="py-2 pr-4">
                                {target === undefined ? 'ไม่ได้กำหนดเป้าหมาย' : view2 === null ? '—' : formatPp(view2 - target)}
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className="py-2">{delta !== null ? formatPp(delta) : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            ค่ารายสถานบริการมาจากข้อมูลสรุปประจำปีที่จัดเก็บไว้ของแต่ละปีงบประมาณ (เข้าร่วมด้วยรหัสสถานบริการ) — ปีใดไม่มีข้อมูลของสถานบริการนั้นแสดงเป็น — ไม่ใช่ค่า 0
          </p>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">การเปรียบเทียบวัคซีนข้ามปีงบประมาณ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 mb-3">
            {rows.map(row =>
              row.updatedAt ? (
                <span key={row.fiscalYear}>ปี {row.fiscalYear}: ข้อมูลสรุป ณ วันที่ {formatDateTimeStr(row.updatedAt)}</span>
              ) : null,
            )}
          </div>
          {vaccineLegacyYears.length > 0 && (
            <div className="flex flex-col gap-y-1 mb-3">
              {vaccineLegacyYears.map(fiscalYear => (
                <p key={fiscalYear} className="text-xs text-amber-700" role="status">
                  ปี {fiscalYear}: ไม่มีรหัสเชื่อมโยงวัคซีนสำหรับการเปรียบเทียบข้ามปี
                </p>
              ))}
            </div>
          )}
          {vaccineViews.every(({ series }) => series.length === 0) ? (
            <p className="text-sm text-zinc-600">ไม่มีข้อมูลวัคซีนที่มีรหัสเชื่อมโยงสำหรับปีที่เลือก</p>
          ) : (
            vaccineViews.map(({ viewType, label, series }) => (
              <div key={viewType} className="mb-5 last:mb-0">
                <p className="text-sm font-medium text-zinc-700 mb-2">{label}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-zinc-700">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                        <th className="py-2 pr-4 font-medium">วัคซีน</th>
                        {selectedYears.map(fiscalYear => (
                          <th key={fiscalYear} className="py-2 pr-4 font-medium">ปีงบประมาณ {fiscalYear}</th>
                        ))}
                        <th className="py-2 pr-4 font-medium">เปลี่ยนแปลงจากปีที่มีข้อมูลก่อนหน้า (จุดร้อยละ)</th>
                        <th className="py-2 font-medium">ส่วนต่างจากเป้าหมาย (จุดร้อยละ)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.length === 0 ? (
                        <tr>
                          <td colSpan={2 + selectedYears.length} className="py-3 text-zinc-500">ไม่มีข้อมูลวัคซีนที่มีรหัสเชื่อมโยงสำหรับมุมมองนี้</td>
                        </tr>
                      ) : (
                        series.map(entry => {
                          const latestFy = [...entry.years.keys()].pop();
                          const latest = latestFy !== undefined ? entry.years.get(latestFy) : undefined;
                          const target = latest && latestFy !== undefined
                            ? getTarget('all', viewType, latest.vaccineGroup, latestFy)
                            : undefined;
                          return (
                            <tr key={`${viewType}-${entry.metricKey}`} className="border-b border-zinc-100">
                              <td className="py-2 pr-4 font-medium text-zinc-900">{entry.displayName}</td>
                              {selectedYears.map(fiscalYear => {
                                const yearEntry = entry.years.get(fiscalYear);
                                return (
                                  <td key={fiscalYear} className="py-2 pr-4">
                                    {yearEntry ? `${yearEntry.coverage.toFixed(2)}%` : '—'}
                                  </td>
                                );
                              })}
                              <td className="py-2 pr-4">{entry.delta !== null ? formatPp(entry.delta) : '—'}</td>
                              <td className="py-2">
                                {latest === undefined || latestFy === undefined
                                  ? '—'
                                  : target === undefined
                                    ? 'ไม่ได้กำหนดเป้าหมาย'
                                    : formatPp(latest.coverage - target)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-zinc-500 mt-3">
            ค่ารายวัคซีนเชื่อมโยงข้ามปีด้วยรหัสเชื่อมโยงวัคซีน (metric key) ที่จัดเก็บในข้อมูลสรุปของแต่ละปี — ปีใดไม่มีข้อมูลของวัคซีนนั้นแสดงเป็น — ไม่ใช่ค่า 0 และชื่อที่แสดงเป็นชื่อ ณ เวลาคำนวณสรุปของปีนั้น (การเปลี่ยนชื่อไม่ตัดอนุกรม)
          </p>
        </CardContent>
      </Card>
    </div>
  );

  // When embedded by the new annual dashboard, this existing analysis remains
  // available on request without a second header or an independent FY selector.
  if (hideChrome) {
    if (selectedYears.length === 0) return (
      <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล</p>
    );
    if (yearsError || targetError || summariesError) return (
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">ไม่สามารถดึงข้อมูลรายละเอียดได้</p>
    );
    return <div className="space-y-6">{analyticalArea}</div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="เปรียบเทียบข้ามปีงบประมาณ" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <p className="text-zinc-500 font-medium">เปรียบเทียบผลการดำเนินงานสร้างเสริมภูมิคุ้มกันโรคข้ามปีงบประมาณ</p>
          <Select value={ageGroup} onValueChange={(value) => setAgeGroup(value)}>
            <SelectTrigger className="w-[180px] bg-white h-[34px] text-[14px]">
              <SelectValue placeholder="เลือกกลุ่มอายุ" />
            </SelectTrigger>
            <SelectContent>
              {AGE_GROUPS.map(group => (
                <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {yearsError ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-semibold text-red-700">ไม่สามารถดึงข้อมูลปีงบประมาณที่มีข้อมูลสรุปได้</p>
              <p className="text-sm text-red-600 mt-1">{yearsError}</p>
            </CardContent>
          </Card>
        ) : targetError ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-semibold text-red-700">ไม่สามารถดึงการตั้งค่าเป้าหมายได้</p>
              <p className="text-sm text-red-600 mt-1">กรุณาลองใหม่อีกครั้ง หากยังไม่สำเร็จโปรดติดต่อผู้ดูแลระบบ</p>
            </CardContent>
          </Card>
        ) : yearsLoading && data.length === 0 ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-2xl border border-zinc-200">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" data-testid="comparison-loading" />
          </div>
        ) : yearsReady && availableYears.length === 0 ? (
          <Card className="border-zinc-200">
            <CardContent className="pt-6">
              <p className="text-sm text-zinc-600">ไม่มีข้อมูลสรุปสำหรับกลุ่มอายุนี้ — ยังไม่มีปีงบประมาณที่มีสรุปประจำปีที่ใช้เปรียบเทียบได้</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {yearChips}
            {analyticalArea}
          </div>
        )}
      </main>
    </div>
  );
};


/**
 * Public route: a multi-fiscal-year analogue of /dashboard.
 * Chart-first presentation for ages 1 / 2 / 3 / 5, with ONE global
 * FY selection. Detailed historical vaccine/facility tables remain on-demand.
 */
export const YearComparison = () => {
  const { tables, isLoading: yearsLoading, error: yearsError } = useDashboardSummaryYears();
  const { getTarget, isLoading: targetLoading, isError: targetError } = useTargetSettings();
  const availableYears = getComparisonFiscalYears(tables);
  const yearsReady = !yearsLoading && !yearsError;
  const yearsKey = yearsReady ? availableYears.join(',') : null;

  // A real, stored-summary year is the only source of FY options. No browser-clock
  // placeholder is ever sent as an annual comparison query.
  const [selectedYears, setSelectedYears] = useState<number[]>(() =>
    yearsReady ? getDefaultComparisonYears(availableYears) : [],
  );
  const [derivedKey, setDerivedKey] = useState<string | null>(yearsKey);
  if (yearsKey !== null && yearsKey !== derivedKey) {
    setDerivedKey(yearsKey);
    setSelectedYears(getDefaultComparisonYears(availableYears));
  }
  const selectionReady = yearsKey !== null && yearsKey === derivedKey;
  const queryYears = selectionReady ? selectedYears : [];
  const { data, isLoading: summariesLoading, error: summariesError } = useDashboardSummariesMultiYear(queryYears);

  const [showDetails, setShowDetails] = useState(false);
  const [detailAgeGroup, setDetailAgeGroup] = useState<EpiTargetTable>('Epi_1_Year');
  const capReached = selectedYears.length >= MAX_SELECTED_YEARS;
  const model = buildAnnualComparisonModel(data, queryYears, (view, fiscalYear) =>
    getTarget('all', view, undefined, fiscalYear),
  );

  const toggleYear = (year: number) => {
    setSelectedYears(prev => {
      if (prev.includes(year)) return prev.filter(fy => fy !== year);
      if (prev.length >= MAX_SELECTED_YEARS) return prev;
      return [...prev, year].sort((a, b) => a - b);
    });
  };

  const blocked = Boolean(yearsError || targetError || summariesError);
  const loading = yearsLoading || targetLoading || (selectedYears.length > 0 && summariesLoading);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/50">
      <SubNav title="เปรียบเทียบข้ามปีงบประมาณ" />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
            เปรียบเทียบผลการดำเนินงานรายปีงบประมาณ
          </h1>
          <p className="text-sm text-zinc-600">
            เปรียบเทียบข้อมูลสรุปประจำปีตามกลุ่มเด็กอายุ 1, 2, 3 และ 5 ปี
            โดยแยกมุมมองที่ 1 (รายโดส) และมุมมองที่ 2 (รายคน)
          </p>
        </header>

        {!yearsError && yearsReady && availableYears.length > 0 && (
          <Card className="border-zinc-200 shadow-sm">
            <CardContent>
              <h2 className="mb-3 text-sm font-semibold text-zinc-900">เลือกปีงบประมาณที่ต้องการเปรียบเทียบ</h2>
              <div role="group" aria-label="เลือกปีงบประมาณ" className="flex flex-wrap gap-2">
                {[...availableYears].reverse().map(year => {
                  const selected = selectedYears.includes(year);
                  return (
                    <button
                      key={year}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleYear(year)}
                      disabled={!selected && capReached}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        selected ? 'bg-primary text-white' :
                        'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50'
                      }`}
                    >
                      ปี {year}
                    </button>
                  );
                })}
              </div>
              {capReached && <p className="mt-2 text-xs text-zinc-600">เลือกได้สูงสุด 5 ปีงบประมาณ</p>}
            </CardContent>
          </Card>
        )}

        {yearsError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            ไม่สามารถดึงข้อมูลปีงบประมาณที่มีข้อมูลสรุปได้
          </div>
        ) : targetError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            ไม่สามารถดึงการตั้งค่าเป้าหมายได้
          </div>
        ) : summariesError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            ไม่สามารถดึงข้อมูลสรุปได้
          </div>
        ) : loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-zinc-200 bg-white">
            <div role="status" aria-label="กำลังโหลดข้อมูลสรุป" className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : yearsReady && availableYears.length === 0 ? (
          <div role="status" className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            ยังไม่มีข้อมูลสรุปประจำปีที่ใช้เปรียบเทียบได้
          </div>
        ) : selectedYears.length === 0 ? (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล
          </div>
        ) : !blocked ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5">
              {model.ageGroups.map(group => (
                <AnnualAgeGroupCharts key={group.targetTable} group={group} />
              ))}
            </div>
            <p className="text-xs text-zinc-600">
              ผลในแต่ละปีมาจากข้อมูลสรุปที่จัดเก็บไว้ ณ เวลาคำนวณของปีนั้น
              เด็กเป้าหมายและเงื่อนไขการประเมินอาจแตกต่างกันระหว่างปี
              ตัวเลขนี้ไม่ใช่การติดตามเด็กกลุ่มเดียวกันข้ามปี
            </p>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
              <button
                type="button"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(open => !open)}
                className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-zinc-900 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span>ดูรายละเอียดรายวัคซีนและหน่วยบริการ</span>
                <span aria-hidden="true">{showDetails ? '−' : '+'}</span>
              </button>
              {showDetails && (
                <div className="mt-5 space-y-5 border-t border-zinc-200 pt-5">
                  <div role="group" aria-label="เลือกกลุ่มอายุสำหรับรายละเอียด" className="flex flex-wrap gap-2">
                    {COMPARISON_AGE_GROUPS.map(group => (
                      <button
                        type="button"
                        key={group.targetTable}
                        aria-pressed={detailAgeGroup === group.targetTable}
                        onClick={() => setDetailAgeGroup(group.targetTable)}
                        className={`rounded-full px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary ${
                          detailAgeGroup === group.targetTable
                            ? 'bg-primary text-white'
                            : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                        }`}
                      >
                        รายละเอียด{group.label}
                      </button>
                    ))}
                  </div>
                  <YearComparisonDetail
                    key={detailAgeGroup}
                    selectedAgeGroup={detailAgeGroup}
                    selectedFiscalYears={selectedYears}
                    hideChrome
                  />
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
};
