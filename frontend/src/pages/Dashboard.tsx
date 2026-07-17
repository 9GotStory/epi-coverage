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

// ──────────────────────────────────────────────
// Helper: คำนวณ Summary แยกมุมมองที่ 1 และ 2 สำหรับกลุ่มอายุ
// ──────────────────────────────────────────────
function calcGroupSummary(
  data: EpiRecord[],
  evalView1Fn: (r: EpiRecord) => { missingVaccines: string[]; passedCount?: number; results?: Record<string, boolean> },
  evalView2Fn: (r: EpiRecord) => { isFullyImmunized: boolean; passedVaccines?: string[] },
  _fiscalYear?: number // ไม่ได้ใช้ — HDC นับ active ทุก record ไม่กรองปี
) {
  // HDC นับทุก Active record ในชีต โดยไม่กรองปีงบประมาณ
  // (fiscal_year ใช้สำหรับ Upload เท่านั้น ไม่ใช่สำหรับ filter การแสดงผล)
  const filtered = data;
  
  const total = filtered.length;
  let view1PassedDoses = 0;
  let view1TotalDoses = 0;
  let view2Passed = 0;
  
  const view1Details: Record<string, number> = {};
  const view2Details: Record<string, number> = {};
  const facilityMap: Record<string, { hosname: string; total: number; passedV2: number }> = {};

  for (const r of filtered) {
    const v1 = evalView1Fn(r);
    // ถ้ามี passedCount ให้ใช้คำนวณแบบโดสรวม, ถ้าไม่มีให้ถือว่า 1 คน = 1 โดส
    if (v1.passedCount !== undefined && v1.results) {
      view1PassedDoses += v1.passedCount;
      view1TotalDoses += Object.keys(v1.results).length;
      
      // Aggregate each individual vaccine in View 1
      for (const [vac, passed] of Object.entries(v1.results)) {
        if (!view1Details[vac]) view1Details[vac] = 0;
        if (passed) view1Details[vac]++;
      }
    } else {
      view1PassedDoses += v1.missingVaccines.length === 0 ? 1 : 0;
      view1TotalDoses += 1;
    }

    const v2 = evalView2Fn(r);
    if (v2.isFullyImmunized) view2Passed++;
    
    // Aggregate each group in View 2
    if (v2.passedVaccines) {
      for (const vac of v2.passedVaccines) {
        if (!view2Details[vac]) view2Details[vac] = 0;
        view2Details[vac]++;
      }
    }
    
    // Aggregate by Facility (using View 2)
    const hoscode = r.hoscode || 'unknown';
    if (!facilityMap[hoscode]) {
      facilityMap[hoscode] = { hosname: r.hosname || hoscode, total: 0, passedV2: 0 };
    }
    facilityMap[hoscode].total += 1;
    if (v2.isFullyImmunized) facilityMap[hoscode].passedV2 += 1;
  }

  const view1Coverage = view1TotalDoses > 0 ? (view1PassedDoses / view1TotalDoses) * 100 : 0;
  const view2Coverage = total > 0 ? (view2Passed / total) * 100 : 0;
  
  const view1Breakdown = Object.entries(view1Details).map(([name, passed]) => ({
    name,
    passed,
    total,
    coverage: total > 0 ? (passed / total) * 100 : 0
  }));
  
  const view2Breakdown = Object.entries(view2Details).map(([name, passed]) => ({
    name,
    passed,
    total,
    coverage: total > 0 ? (passed / total) * 100 : 0
  }));

  const facilityBreakdown = Object.entries(facilityMap).map(([hoscode, v]) => {
    const coverage = v.total > 0 ? (v.passedV2 / v.total) * 100 : 0;
    return { hoscode, hosname: v.hosname, total: v.total, passed: v.passedV2, coverage };
  }).sort((a, b) => b.coverage - a.coverage);

  return { total, view1PassedDoses, view1TotalDoses, view2Passed, view1Coverage, view2Coverage, view1Breakdown, view2Breakdown, facilityBreakdown };
}


// ──────────────────────────────────────────────
// Helper: คำนวณ รพ.สต. ที่มีเด็กตกหล่นมากที่สุด
// รวมทุกกลุ่มอายุเข้าด้วยกัน สำหรับมุมมองที่ 2
// ──────────────────────────────────────────────
function calcFacilityRanking(allGroupedData: { data: EpiRecord[]; evalFn: (r: EpiRecord) => { isFullyImmunized: boolean } }[]) {
  const failCountMap: Record<string, { hosname: string; failCount: number; total: number }> = {};
  for (const { data, evalFn } of allGroupedData) {
    for (const r of data) {
      const hoscode = r.hoscode || 'unknown';
      if (!failCountMap[hoscode]) {
        failCountMap[hoscode] = { hosname: r.hosname || hoscode, failCount: 0, total: 0 };
      }
      failCountMap[hoscode].total += 1;
      if (!evalFn(r).isFullyImmunized) failCountMap[hoscode].failCount += 1;
    }
  }
  return Object.entries(failCountMap)
    .map(([hoscode, v]) => ({ hoscode, ...v }))
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 10);
}

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
      {isExpanded && (() => {
        const passedFacilities = summary.facilityBreakdown.filter(f => f.coverage >= targetView2);
        const failedFacilities = summary.facilityBreakdown.filter(f => f.coverage < targetView2).sort((a, b) => a.coverage - b.coverage);
        
        return (
          <div className="mt-4 pt-5 border-t border-zinc-100 flex flex-col gap-8 animate-in fade-in slide-in-from-top-2 duration-300">
            
            {/* Facility Performance Leaderboard */}
            <div className="w-full">
              <h4 className="text-sm font-bold text-zinc-800 mb-4 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-zinc-800 rounded-full" />
                ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 2
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Passed Group */}
                <div className="bg-green-50/50 rounded-xl p-4 border border-green-100">
                  <h5 className="text-xs font-bold text-green-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span>
                    กลุ่มผ่านเกณฑ์ (≥ {targetView2}%)
                  </h5>
                  <div className="space-y-3">
                    {passedFacilities.length === 0 ? (
                      <p className="text-xs text-green-600/70 py-2">ยังไม่มีหน่วยบริการที่ผ่านเกณฑ์</p>
                    ) : (
                      passedFacilities.map((fac, idx) => (
                        <div key={fac.hoscode} className="flex flex-col gap-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-700 font-medium truncate pr-2"><span className="text-zinc-400 mr-1">{idx+1}.</span>{fac.hosname}</span>
                            <span className="font-semibold text-green-700">{fac.coverage.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-green-200/50 h-1.5 rounded-full overflow-hidden relative">
                            <div className="absolute h-full bg-green-500 rounded-full" style={{ width: `${fac.coverage}%` }} />
                            <div className="absolute h-full w-0.5 bg-green-800 top-0 z-10" style={{ left: `${targetView2}%` }} title={`เป้าหมาย ${targetView2}%`} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Failed Group */}
                <div className="bg-red-50/50 rounded-xl p-4 border border-red-100">
                  <h5 className="text-xs font-bold text-red-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>
                    กลุ่มต้องเร่งติดตาม (&lt; {targetView2}%)
                  </h5>
                  <div className="space-y-3">
                    {failedFacilities.length === 0 ? (
                      <p className="text-xs text-red-600/70 py-2">ทุกหน่วยบริการผ่านเกณฑ์ยอดเยี่ยม!</p>
                    ) : (
                      failedFacilities.map((fac, idx) => {
                        const gap = Math.ceil((fac.total * targetView2 / 100) - fac.passed);
                        return (
                          <div key={fac.hoscode} className="flex flex-col gap-1">
                            <div className="flex justify-between items-end text-xs mb-0.5">
                              <span className="text-zinc-700 font-medium truncate pr-2"><span className="text-zinc-400 mr-1">{idx+1}.</span>{fac.hosname}</span>
                              <div className="flex flex-col items-end">
                                <span className="font-semibold text-red-600">{fac.coverage.toFixed(1)}%</span>
                                <span className="text-[10px] text-red-500 font-medium">ขาด {gap} คน</span>
                              </div>
                            </div>
                            <div className="w-full bg-red-200/50 h-1.5 rounded-full overflow-hidden relative">
                              <div className="absolute h-full bg-red-500 rounded-full" style={{ width: `${fac.coverage}%` }} />
                              <div className="absolute h-full w-0.5 bg-red-800 top-0 z-10" style={{ left: `${targetView2}%` }} title={`เป้าหมาย ${targetView2}%`} />
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6 border-t border-zinc-100 border-dashed">
          
          {/* View 1 Breakdown */}
          <div>
            <h4 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
              สัดส่วนการได้รับวัคซีนรายชนิด (View 1)
            </h4>
            {summary.view1Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {summary.view1Breakdown.map(item => {
                  const isPassed = item.coverage >= targetView1;
                  return (
                    <div key={item.name} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-700 truncate font-medium mr-2" title={item.name}>{item.name}</span>
                        <span className={`font-semibold ${isPassed ? 'text-green-600' : 'text-red-500'}`}>
                          {item.coverage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${isPassed ? 'bg-green-500' : 'bg-red-400'}`} style={{ width: `${item.coverage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 py-2">ไม่มีข้อมูลวัคซีนในเงื่อนไข</div>
            )}
          </div>

          {/* View 2 Breakdown */}
          <div>
            <h4 className="text-sm font-bold text-emerald-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
              สัดส่วนผู้ที่ผ่านเกณฑ์แยกตามหมวด (View 2)
            </h4>
            {summary.view2Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {summary.view2Breakdown.map(item => {
                  const isPassed = item.coverage >= targetView2;
                  return (
                    <div key={item.name} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-700 truncate font-medium mr-2" title={item.name}>{item.name}</span>
                        <span className={`font-semibold ${isPassed ? 'text-emerald-600' : 'text-red-500'}`}>
                          {item.coverage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${isPassed ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${item.coverage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 py-2">ไม่มีข้อมูลวัคซีนในเงื่อนไข</div>
            )}
          </div>

            </div>
          </div>
        );
      })()}
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

  // Ranking (ยังคงไว้สำหรับมุมมองที่ 2)
  const isAnyLoading = loading1 || loading2 || loading3 || loading5;
  const facilityRanking = useMemo(() => {
    if (isAnyLoading) return [];
    return calcFacilityRanking([
      { data: data1yr, evalFn: evaluateView2 },
      { data: data2yr, evalFn: evaluateView2_2Yr },
      { data: data3yr, evalFn: evaluateView2_3Yr },
      { data: data5yr, evalFn: evaluateView2_5Yr },
    ]);
  }, [data1yr, data2yr, data3yr, data5yr, isAnyLoading]);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="ศูนย์ปฏิบัติการ (Executive Summary)" />

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

        {/* ── OpenData Quick Links ── */}
        <section className="pt-6 border-t border-zinc-200 mt-8">
          <div className="flex items-center gap-2 mb-2">
            <DatabaseIcon className="w-5 h-5 text-indigo-500" />
            <h2 className="text-xl font-bold text-zinc-900">เจาะลึกข้อมูล Aggregate (HDC OpenData API)</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-5">
            ตัวเลขผลงานรายชนิดวัคซีนจากกระทรวง — คลิกเพื่อดูกราฟเจาะลึกมุมมองที่ 3
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'เด็ก 1 ปี', path: '/dashboard/epi-1yr', sub: 's_epi1' },
              { label: 'เด็ก 2 ปี', path: '/dashboard/epi-2yr', sub: 's_epi2' },
              { label: 'เด็ก 3 ปี', path: '/dashboard/epi-3yr', sub: 's_epi3' },
              { label: 'เด็ก 5 ปี', path: '/dashboard/epi-5yr', sub: 's_epi5' },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path + '?tab=view3')}
                className="bg-white rounded-xl p-4 border border-zinc-200 text-left hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <p className="font-semibold text-zinc-800">{item.label}</p>
                <p className="text-xs text-zinc-400 mt-1">ตาราง {item.sub}</p>
                <div className="flex items-center gap-1 mt-3 text-xs text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  ดูกราฟ OpenData <ChevronRightIcon className="w-3 h-3" />
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Urgent Follow-ups (Ranking) ── */}
        <section className="pt-6 mt-8">
          <h2 className="text-xl font-bold text-zinc-900 mb-2">🚨 สถานบริการที่ต้องเร่งติดตาม (มุมมองที่ 2)</h2>
          <p className="text-sm text-zinc-500 mb-5">
            จัดอันดับตามจำนวนเด็กตกหล่น (ไม่ Fully Immunized) รวมทุกกลุ่มอายุ
          </p>
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold text-zinc-600 w-16">#</th>
                  <th className="text-left px-5 py-3 font-semibold text-zinc-600">สถานบริการ</th>
                  <th className="text-right px-5 py-3 font-semibold text-zinc-600">เด็กทั้งหมด</th>
                  <th className="text-right px-5 py-3 font-semibold text-zinc-600">ตกหล่น (คน)</th>
                  <th className="text-right px-5 py-3 font-semibold text-zinc-600">% ตกหล่น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {isAnyLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="h-4 bg-zinc-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : facilityRanking.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-zinc-400 py-10">ไม่มีข้อมูล</td>
                  </tr>
                ) : (
                  facilityRanking.map((fac, idx) => {
                    const failPct = fac.total > 0 ? (fac.failCount / fac.total) * 100 : 0;
                    return (
                      <tr key={fac.hoscode} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-5 py-3 text-zinc-400 font-medium">{idx + 1}</td>
                        <td className="px-5 py-3">
                          <div>
                            <p className="font-medium text-zinc-900">{fac.hosname}</p>
                            <p className="text-xs text-zinc-400">{fac.hoscode}</p>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-zinc-700">{fac.total.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-semibold text-red-600">{fac.failCount.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${failPct > 20 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {failPct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}
