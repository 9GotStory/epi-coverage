import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardSummaries } from '../shared/hooks/useDashboardSummaries';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { SubNav } from '../widgets/layout/SubNav';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';
import {
  ChevronRightIcon,
  ActivityIcon,
  TargetIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-react';

import { AgeGroupExpandedView } from '../shared/components/AgeGroupExpandedView';
import { calcGroupSummary } from '../shared/utils/dashboardLogic';
import { formatDateTimeStr } from '../shared/utils/dateUtils';

// ──────────────────────────────────────────────
// AgeGroupSection Component
// ──────────────────────────────────────────────
const AgeGroupSection = memo(function AgeGroupSection({
  age,
  summary,
  updatedAt,
  targetView1,
  targetView2,
  fiscalYear,
  isLoading,
  path
}: {
  age: string;
  summary: ReturnType<typeof calcGroupSummary>;
  updatedAt?: string | null;
  targetView1?: number;
  targetView2?: number;
  fiscalYear: number;
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
            <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold tracking-wide uppercase ${v1TargetMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {v1TargetMet ? 'PASS' : 'FAIL'}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-zinc-900 tracking-tight">{summary.view1Coverage.toFixed(2)}<span className="text-xl text-zinc-400 font-medium ml-0.5">%</span></p>
              <p className="text-sm text-zinc-500 mt-1">
                ได้รับแล้ว <strong className="text-zinc-800">{summary.view1PassedDoses.toLocaleString()}</strong> จาก <strong className="text-zinc-800">{summary.view1TotalDoses.toLocaleString()}</strong> โดส
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
                ตกหล่น <strong className="text-zinc-800">{(summary.total - summary.view2Passed).toLocaleString()}</strong> คน
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

      {/* ── Expanded Content ── */}
      {isExpanded && (
        <AgeGroupExpandedView summary={summary} targetView1={targetView1} targetView2={targetView2} fiscalYear={fiscalYear} />
      )}
    </section>
  );
});

// ──────────────────────────────────────────────
// Main Dashboard Page
// ──────────────────────────────────────────────
export function Dashboard() {
  const currentYear = getCurrentFiscalYear();
  const { getTarget } = useTargetSettings();

  // โหลดข้อมูลผลสรุป (JSON Cache) จาก API แทนการโหลดข้อมูลดิบ
  const { data: summaries, isLoading } = useDashboardSummaries(currentYear);

  // ดึงเป้าหมายแบบไดนามิกของปีปัจจุบัน (ใช้ไตรมาส 4 เป็นค่าเริ่มต้นสำหรับภาพรวมรายปี)
  const targetView1 = getTarget(4, 1, undefined, currentYear);
  const targetView2 = getTarget(4, 2, undefined, currentYear);

  // ดึง summary ของแต่ละกลุ่มอายุจาก Array ที่ได้กลับมา
  const getSummary = (table: string) => {
    const found = summaries.find(s => s.targetTable === table);
    if (found && found.summaryData) {
      return { data: found.summaryData, updatedAt: found.updated_at };
    }
    // ส่งค่า Default กลับไปถ้ายังไม่มีข้อมูล Cache
    return {
      data: {
        total: 0,
        view1Coverage: 0, view1PassedDoses: 0, view1TotalDoses: 0, view1Breakdown: {},
        view2Coverage: 0, view2Passed: 0, view2Failed: 0, view2Breakdown: {},
        facilityBreakdownV1: [],
        facilityBreakdownV2: []
      },
      updatedAt: null
    };
  };

  const summary1yr = getSummary('Epi_1_Year');
  const summary2yr = getSummary('Epi_2_Year');
  const summary3yr = getSummary('Epi_3_Year');
  const summary5yr = getSummary('Epi_5_Year');

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="ภาพรวมการดำเนินงาน (Executive Summary)" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <p className="text-zinc-500 font-medium">ภาพรวมผลการดำเนินงานสร้างเสริมภูมิคุ้มกันโรค ปีงบประมาณ {currentYear}</p>

        {/* ── Age Group Sections ── */}
        <AgeGroupSection
          age="1 ปี"
          summary={summary1yr.data}
          updatedAt={summary1yr.updatedAt}
          targetView1={targetView1}
          targetView2={targetView2}
          fiscalYear={currentYear}
          isLoading={isLoading}
          path="/dashboard/epi-1yr"
        />
        
        <AgeGroupSection
          age="2 ปี"
          summary={summary2yr.data}
          updatedAt={summary2yr.updatedAt}
          targetView1={targetView1}
          targetView2={targetView2}
          fiscalYear={currentYear}
          isLoading={isLoading}
          path="/dashboard/epi-2yr"
        />

        <AgeGroupSection
          age="3 ปี"
          summary={summary3yr.data}
          updatedAt={summary3yr.updatedAt}
          targetView1={targetView1}
          targetView2={targetView2}
          fiscalYear={currentYear}
          isLoading={isLoading}
          path="/dashboard/epi-3yr"
        />

        <AgeGroupSection
          age="5 ปี"
          summary={summary5yr.data}
          updatedAt={summary5yr.updatedAt}
          targetView1={targetView1}
          targetView2={targetView2}
          fiscalYear={currentYear}
          isLoading={isLoading}
          path="/dashboard/epi-5yr"
        />


      </main>
    </div>
  );
}
