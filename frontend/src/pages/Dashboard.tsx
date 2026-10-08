import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardSummaries } from '../shared/hooks/useDashboardSummaries';
import { useDashboardSummaryYears } from '../shared/hooks/useDashboardSummaryYears';
import { getComparisonFiscalYears } from './comparison/model';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { SubNav } from '../widgets/layout/SubNav';
import {
  ChevronRightIcon,
  ActivityIcon,
  TargetIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-react';

import { AgeGroupExpandedView } from '../shared/components/AgeGroupExpandedView';
import type { LegacyCompatibleGroupSummary } from '../shared/utils/dashboardLogic';
import { formatDateTimeStr } from '../shared/utils/dateUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/components/ui/select';

// ──────────────────────────────────────────────
// AgeGroupSection Component
// ──────────────────────────────────────────────
const AgeGroupSection = memo(function AgeGroupSection({
  age,
  ageGroup,
  summary,
  updatedAt,
  targetView1,
  targetView2,
  fiscalYear,
  quarter,
  isLoading,
  path
}: {
  age: string;
  ageGroup: string;
  summary: LegacyCompatibleGroupSummary | null;
  updatedAt?: string | null;
  targetView1?: number;
  targetView2?: number;
  fiscalYear: number;
  quarter: number | 'all';
  isLoading: boolean;
  path: string;
}) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-zinc-200 animate-pulse mb-6">
        <div className="h-6 bg-zinc-200 rounded w-1/4 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-28 bg-zinc-100 rounded-xl" />
          <div className="h-28 bg-zinc-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <section className="bg-white rounded-2xl p-6 border border-zinc-200 mb-6">
        <h2 className="text-xl font-bold text-zinc-900">ภาพรวมเด็กอายุครบ {age}</h2>
        <p className="mt-3 text-sm text-zinc-500">
          ไม่มีข้อมูลสรุปสำหรับปีงบประมาณ {fiscalYear}{quarter === 'all' ? '' : ` ไตรมาส ${quarter}`}
        </p>
      </section>
    );
  }

  const v1TargetMet = targetView1 !== undefined ? summary.view1Coverage >= targetView1 : true;
  const v2TargetMet = targetView2 !== undefined ? summary.view2Coverage >= targetView2 : true;

  return (
    <section className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm mb-6">
      <div className="flex justify-between items-center mb-5">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">ภาพรวมเด็กอายุครบ {age}</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-1">
            <p className="text-sm text-zinc-500">เด็กเป้าหมายทั้งหมดในระบบ: <strong className="text-zinc-800">{summary.total.toLocaleString()}</strong> คน</p>
            {updatedAt && (
              <p className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full w-fit">ข้อมูล ณ วันที่: {formatDateTimeStr(updatedAt)}</p>
            )}
          </div>
        </div>
        <button 
          onClick={() => navigate(path)}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-full transition-colors flex items-center gap-1"
        >
          เจาะลึกข้อมูล <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* View 1 Card */}
        <div className="bg-zinc-50/80 rounded-xl p-5 border border-zinc-200 relative overflow-hidden group hover:border-blue-300 transition-colors">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-400" />
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center gap-2">
                <ActivityIcon className="w-4 h-4 text-blue-500" />
                <h3 className="font-semibold text-zinc-800">มุมมองที่ 1 (รายชนิดวัคซีน)</h3>
              </div>
              <p className="text-xs text-zinc-500 mt-1">ได้รับวัคซีนครบถ้วนตามเกณฑ์รายวัคซีน</p>
            </div>
            <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold tracking-wide uppercase ${summary.view1TotalDoses === 0 ? 'bg-zinc-100 text-zinc-600' : v1TargetMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {summary.view1TotalDoses === 0 ? 'ยังประเมินไม่ได้' : v1TargetMet ? 'PASS' : 'FAIL'}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-zinc-900 tracking-tight">{summary.view1TotalDoses === 0 ? '—' : summary.view1Coverage.toFixed(2)}<span className="text-xl text-zinc-400 font-medium ml-0.5">%</span></p>
              <p className="text-sm text-zinc-500 mt-1">
                ได้รับแล้ว <strong className="text-zinc-800">{summary.view1PassedDoses.toLocaleString()}</strong> จาก <strong className="text-zinc-800">{summary.view1TotalDoses.toLocaleString()}</strong> โดส
                {!!summary.view1UnknownDoses && <span className="block">ข้อมูลไม่พอประเมิน {summary.view1UnknownDoses.toLocaleString()} รายการ (ไม่นับในตัวหาร)</span>}
              </p>
            </div>
            <div className="text-right">
              {targetView1 !== undefined && (
                <p className="text-[10px] text-zinc-400 mt-1">เป้าหมาย: ≥ {targetView1}%</p>
              )}
            </div>
          </div>
          
          <div className="w-full bg-zinc-200 h-1.5 rounded-full mt-4 overflow-hidden relative">
            <div className={`absolute h-full rounded-full transition-all duration-500 ${v1TargetMet ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${summary.view1Coverage}%` }} />
            <div className="absolute h-full w-0.5 bg-zinc-400 top-0" style={{ left: `${targetView1}%` }} />
          </div>
        </div>

        {/* View 2 Card */}
        <div className="bg-zinc-50/80 rounded-xl p-5 border border-zinc-200 relative overflow-hidden group hover:border-emerald-300 transition-colors">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-400" />
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center gap-2">
                <TargetIcon className="w-4 h-4 text-emerald-500" />
                <h3 className="font-semibold text-zinc-800">มุมมองที่ 2 (Fully Immunized)</h3>
              </div>
              <p className="text-xs text-zinc-500 mt-1">ผ่านเกณฑ์ Fully Immunized</p>
            </div>
            <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold tracking-wide uppercase ${v2TargetMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {v2TargetMet ? 'PASS' : 'FAIL'}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-zinc-900 tracking-tight">{summary.view2Coverage.toFixed(2)}<span className="text-xl text-zinc-400 font-medium ml-0.5">%</span></p>
              <p className="text-sm text-zinc-500 mt-1">
                ผ่านเกณฑ์ <strong className="text-zinc-800">{summary.view2Passed.toLocaleString()}</strong> คน
                <span className="mx-1.5 text-zinc-300">|</span>
                ตกหล่น <strong className="text-zinc-800">{typeof summary.view2ApplicableTotal === 'number' ? (summary.view2ApplicableTotal - summary.view2Passed).toLocaleString() : '—'}</strong> คน
              </p>
            </div>
            <div className="text-right">
              {targetView2 !== undefined && (
                <p className="text-[10px] text-zinc-400 mt-1">เป้าหมาย: ≥ {targetView2}%</p>
              )}
            </div>
          </div>

          <div className="w-full bg-zinc-200 h-1.5 rounded-full mt-4 overflow-hidden relative">
            <div className={`absolute h-full rounded-full transition-all duration-500 ${v2TargetMet ? 'bg-green-500' : 'bg-emerald-500'}`} style={{ width: `${summary.view2Coverage}%` }} />
            <div className="absolute h-full w-0.5 bg-zinc-400 top-0" style={{ left: `${targetView2}%` }} />
          </div>
        </div>
      </div>

      {/* ── Expanded Area Toggle ── */}
      <div className="mt-4 flex justify-center">
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-800 flex items-center gap-1 transition-colors px-4 py-2 rounded-full hover:bg-zinc-100"
        >
          {isExpanded ? (
            <>ย่อรายละเอียด <ChevronUpIcon className="w-4 h-4" /></>
          ) : (
            <>ดูรายละเอียดรายวัคซีน <ChevronDownIcon className="w-4 h-4" /></>
          )}
        </button>
      </div>

      {isExpanded && (
        <AgeGroupExpandedView summary={summary} targetView1={targetView1} targetView2={targetView2} fiscalYear={fiscalYear} quarter={quarter} ageGroup={ageGroup} />
      )}
    </section>
  );
});

// ──────────────────────────────────────────────
// Main Dashboard Page
// ──────────────────────────────────────────────
export function Dashboard() {
  const { tables, isLoading: yearsLoading, error: yearsError } = useDashboardSummaryYears();
  const availableYears = getComparisonFiscalYears(tables);
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  // The selector only advertises years backed by an actual, usable annual snapshot.
  // Manual selection is retained unless that year disappears from the available set.
  const fiscalYear = chosenYear !== null && availableYears.includes(chosenYear)
    ? chosenYear
    : availableYears[availableYears.length - 1];

  const { getTarget } = useTargetSettings();
  const [quarter, setQuarter] = useState<number | 'all'>('all');

  // A selected fiscal year drives both the summary query and its target thresholds.
  // The summary query is disabled until fiscal-year discovery returns a usable year.
  const { data: summaries, isLoading: summariesLoading, error: summariesError } =
    useDashboardSummaries(fiscalYear, quarter);

  const targetQuarter = quarter === 'all' ? 4 : quarter;
  const targetView1 = getTarget(targetQuarter, 1, undefined, fiscalYear);
  const targetView2 = getTarget(targetQuarter, 2, undefined, fiscalYear);

  const getSummary = (table: string) => {
    // Backend owns canonical annual precedence (_all over legacy, Issue #22).
    const found = summaries.find(s => s.targetTable === table && s.summaryData);
    return found
      ? { data: found.summaryData as LegacyCompatibleGroupSummary, updatedAt: found.updated_at }
      : { data: null, updatedAt: null };
  };

  const summary1yr = getSummary('Epi_1_Year');
  const summary2yr = getSummary('Epi_2_Year');
  const summary3yr = getSummary('Epi_3_Year');
  const summary5yr = getSummary('Epi_5_Year');

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="ภาพรวมการดำเนินงาน (Executive Summary)" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <p className="text-zinc-500 font-medium">
            ภาพรวมผลการดำเนินงานสร้างเสริมภูมิคุ้มกันโรค
            {fiscalYear !== undefined ? ` ปีงบประมาณ ${fiscalYear}` : ''}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="dashboard-fiscal-year" className="text-[14px] text-zinc-500 font-medium whitespace-nowrap">
              ปีงบประมาณ:
            </label>
            <Select
              value={fiscalYear?.toString()}
              disabled={yearsLoading || !!yearsError || availableYears.length === 0}
              onValueChange={value => {
                setChosenYear(Number(value));
                setQuarter('all');
              }}
            >
              <SelectTrigger id="dashboard-fiscal-year" aria-label="ปีงบประมาณ" className="w-[135px] bg-white h-[34px] text-[14px]">
                <SelectValue placeholder="เลือกปี" />
              </SelectTrigger>
              <SelectContent>
                {[...availableYears].reverse().map(year => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label htmlFor="dashboard-quarter" className="text-[14px] text-zinc-500 font-medium whitespace-nowrap">
              ไตรมาส:
            </label>
            <Select
              value={quarter.toString()}
              disabled={yearsLoading || !!yearsError || fiscalYear === undefined}
              onValueChange={val => setQuarter(val === 'all' ? 'all' : Number(val))}
            >
              <SelectTrigger id="dashboard-quarter" aria-label="ไตรมาส" className="w-[200px] bg-white h-[34px] text-[14px]">
                <SelectValue placeholder="เลือกไตรมาส" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ภาพรวมทั้งปีงบประมาณ</SelectItem>
                <SelectItem value="1">ไตรมาส 1 (ต.ค. - ธ.ค.)</SelectItem>
                <SelectItem value="2">ไตรมาส 2 (ม.ค. - มี.ค.)</SelectItem>
                <SelectItem value="3">ไตรมาส 3 (เม.ย. - มิ.ย.)</SelectItem>
                <SelectItem value="4">ไตรมาส 4 (ก.ค. - ก.ย.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {yearsLoading ? (
          <p role="status" className="text-sm text-zinc-500">กำลังโหลดปีงบประมาณที่มีข้อมูลสรุป...</p>
        ) : yearsError ? (
          <p role="alert" className="text-sm text-red-700">ไม่สามารถโหลดปีงบประมาณที่มีข้อมูลสรุปได้: {yearsError}</p>
        ) : fiscalYear === undefined ? (
          <p role="status" className="text-sm text-zinc-500">ยังไม่มีข้อมูลสรุปสำหรับปีงบประมาณใด กรุณานำเข้าข้อมูลและสร้างสรุปก่อน</p>
        ) : summariesError ? (
          <p role="alert" className="text-sm text-red-700">
            ไม่สามารถโหลดข้อมูลสรุปปีงบประมาณ {fiscalYear} ได้: {summariesError}
          </p>
        ) : (
          <>
            <AgeGroupSection
              age="1 ปี"
              ageGroup="1yr"
              summary={summary1yr.data}
              updatedAt={summary1yr.updatedAt}
              targetView1={targetView1}
              targetView2={targetView2}
              fiscalYear={fiscalYear}
              quarter={quarter}
              isLoading={summariesLoading}
              path="/dashboard/epi-1yr"
            />

            <AgeGroupSection
              age="2 ปี"
              ageGroup="2yr"
              summary={summary2yr.data}
              updatedAt={summary2yr.updatedAt}
              targetView1={targetView1}
              targetView2={targetView2}
              fiscalYear={fiscalYear}
              quarter={quarter}
              isLoading={summariesLoading}
              path="/dashboard/epi-2yr"
            />

            <AgeGroupSection
              age="3 ปี"
              ageGroup="3yr"
              summary={summary3yr.data}
              updatedAt={summary3yr.updatedAt}
              targetView1={targetView1}
              targetView2={targetView2}
              fiscalYear={fiscalYear}
              quarter={quarter}
              isLoading={summariesLoading}
              path="/dashboard/epi-3yr"
            />

            <AgeGroupSection
              age="5 ปี"
              ageGroup="5yr"
              summary={summary5yr.data}
              updatedAt={summary5yr.updatedAt}
              targetView1={targetView1}
              targetView2={targetView2}
              fiscalYear={fiscalYear}
              quarter={quarter}
              isLoading={summariesLoading}
              path="/dashboard/epi-5yr"
            />
          </>
        )}
      </main>
    </div>
  );
}
