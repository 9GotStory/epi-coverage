import { useMemo, memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpiData } from '../shared/hooks/useEpiData';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { SubNav } from '../widgets/layout/SubNav';
import { evaluateView1, evaluateView2 } from '../features/vaccine-1yr/utils/vaccineLogic';
import { evaluateView1_2Yr, evaluateView2_2Yr } from '../features/vaccine-2yr/utils/vaccineLogic';
import { evaluateView1_3Yr, evaluateView2_3Yr } from '../features/vaccine-3yr/utils/vaccineLogic';
import { evaluateView1_5Yr, evaluateView2_5Yr } from '../features/vaccine-5yr/utils/vaccineLogic5Yr';
import type { EpiRecord } from '../shared/types';
import {
  ChevronRightIcon,
  ActivityIcon,
  TargetIcon,
  DatabaseIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-react';

import { AgeGroupExpandedView } from '../shared/components/AgeGroupExpandedView';
import { calcGroupSummary } from '../shared/utils/dashboardLogic';

// ──────────────────────────────────────────────
// AgeGroupSection Component
// ──────────────────────────────────────────────
const AgeGroupSection = memo(function AgeGroupSection({
  age,
  summary,
  targetView1,
  targetView2,
  isLoading,
  path
}: {
  age: string;
  summary: ReturnType<typeof calcGroupSummary>;
  targetView1: number;
  targetView2: number;
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

  const v1TargetMet = summary.view1Coverage >= targetView1;
  const v2TargetMet = summary.view2Coverage >= targetView2;

  return (
    <section className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm mb-6">
      <div className="flex justify-between items-center mb-5">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">ภาพรวมเด็กอายุครบ {age}</h2>
          <p className="text-sm text-zinc-500 mt-1">เด็กเป้าหมายทั้งหมดในระบบ: <strong className="text-zinc-800">{summary.total.toLocaleString()}</strong> คน</p>
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
              <p className="text-xs text-zinc-400">เป้าหมาย View 1</p>
              <p className="text-sm font-semibold text-zinc-700">{targetView1}%</p>
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
                <span className="text-zinc-500 font-medium">ตกหล่น {(summary.total - summary.view2Passed).toLocaleString()} คน</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-400">เป้าหมาย View 2</p>
              <p className="text-sm font-semibold text-zinc-700">{targetView2}%</p>
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
        <AgeGroupExpandedView summary={summary} targetView1={targetView1} targetView2={targetView2} />
      )}
    </section>
  );
});

// ──────────────────────────────────────────────
// Main Dashboard Page
// ──────────────────────────────────────────────
export function Dashboard() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear() + 543;
  const { getTarget } = useTargetSettings();

  // โหลดข้อมูล Excel ทั้ง 4 กลุ่มอายุ
  const { data: data1yr, isLoading: loading1 } = useEpiData('Epi_1_Year');
  const { data: data2yr, isLoading: loading2 } = useEpiData('Epi_2_Year');
  const { data: data3yr, isLoading: loading3 } = useEpiData('Epi_3_Year');
  const { data: data5yr, isLoading: loading5 } = useEpiData('Epi_5_Year');

  // ดึงเป้าหมายแบบไดนามิก (ใช้ไตรมาส 4 เป็นค่าเริ่มต้นสำหรับภาพรวมรายปี)
  const targetView1 = getTarget(4, 1);
  const targetView2 = getTarget(4, 2);

  // สรุปผลแต่ละกลุ่มอายุ
  const summary1yr = useMemo(() => calcGroupSummary(data1yr, evaluateView1, evaluateView2, currentYear), [data1yr, currentYear]);
  const summary2yr = useMemo(() => calcGroupSummary(data2yr, evaluateView1_2Yr, evaluateView2_2Yr, currentYear), [data2yr, currentYear]);
  const summary3yr = useMemo(() => calcGroupSummary(data3yr, evaluateView1_3Yr, evaluateView2_3Yr, currentYear), [data3yr, currentYear]);
  const summary5yr = useMemo(() => calcGroupSummary(data5yr, evaluateView1_5Yr, evaluateView2_5Yr, currentYear), [data5yr, currentYear]);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="ภาพรวมการดำเนินงาน (Executive Summary)" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <p className="text-zinc-500 font-medium">ภาพรวมผลการดำเนินงานสร้างเสริมภูมิคุ้มกันโรค ปีงบประมาณ {currentYear}</p>

        {/* ── Age Group Sections ── */}
        <AgeGroupSection
          age="1 ปี"
          summary={summary1yr}
          targetView1={targetView1}
          targetView2={targetView2}
          isLoading={loading1}
          path="/dashboard/epi-1yr"
        />
        
        <AgeGroupSection
          age="2 ปี"
          summary={summary2yr}
          targetView1={targetView1}
          targetView2={targetView2}
          isLoading={loading2}
          path="/dashboard/epi-2yr"
        />

        <AgeGroupSection
          age="3 ปี"
          summary={summary3yr}
          targetView1={targetView1}
          targetView2={targetView2}
          isLoading={loading3}
          path="/dashboard/epi-3yr"
        />

        <AgeGroupSection
          age="5 ปี"
          summary={summary5yr}
          targetView1={targetView1}
          targetView2={targetView2}
          isLoading={loading5}
          path="/dashboard/epi-5yr"
        />


      </main>
    </div>
  );
}
