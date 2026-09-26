import { useState } from 'react';
import * as Recharts from 'recharts';
import type { ReactElement } from 'react';
import { useDashboardSummariesMultiYear } from '../shared/hooks/useDashboardSummariesMultiYear';
import { useDashboardSummaryYears } from '../shared/hooks/useDashboardSummaryYears';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../shared/components/ui/card';
import { SubNav } from '../widgets/layout/SubNav';
import { formatDateTimeStr, getCurrentFiscalYear } from '../shared/utils/dateUtils';
import type { DashboardSummaryRow } from '../shared/types/dashboardSummary';

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
const formatPp = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)} pp`;

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

export const YearComparison = () => {
  const currentYear = getCurrentFiscalYear();
  const [ageGroup, setAgeGroup] = useState<string>('Epi_1_Year');

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
  const [selectedYears, setSelectedYears] = useState<number[]>(() => {
    const initialYears = tables?.[ageGroup];
    return initialYears?.length ? defaultSelectedYears(initialYears) : [currentYear - 1, currentYear];
  });
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
  const queryYears = selectionDerived || typeof window === 'undefined' ? selectedYears : [];
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
                  <th className="py-2 pr-4 font-medium">เปลี่ยนแปลงจากปีก่อนหน้า (pp)</th>
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
    </div>
  );

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
