import { useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpiData } from '../shared/hooks/useEpiData';
import { useTargetSettings } from '../shared/hooks/useTargetSettings';
import { SubNav } from '../widgets/layout/SubNav';
import { evaluateView1, evaluateView2 } from '../features/vaccine-1yr/utils/vaccineLogic';
import { evaluateView1_2Yr, evaluateView2_2Yr } from '../features/vaccine-2yr/utils/vaccineLogic';
import { evaluateView1_3Yr, evaluateView2_3Yr } from '../features/vaccine-3yr/utils/vaccineLogic';
import { evaluateView1_5Yr, evaluateView2_5Yr } from '../features/vaccine-5yr/utils/vaccineLogic5Yr';
import {
  ChevronRightIcon,
  ActivityIcon,
  TargetIcon,
  DatabaseIcon,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Helper: คำนวณ Summary แยกมุมมองที่ 1 และ 2 สำหรับกลุ่มอายุ
// ──────────────────────────────────────────────
function calcGroupSummary(
  data: any[],
  evalView1Fn: (r: any) => { missingVaccines: string[]; passedCount?: number; results?: Record<string, boolean> },
  evalView2Fn: (r: any) => { isFullyImmunized: boolean },
  _fiscalYear?: number // ไม่ได้ใช้ — HDC นับ active ทุก record ไม่กรองปี
) {
  // HDC นับทุก Active record ในชีต โดยไม่กรองปีงบประมาณ
  // (fiscal_year ใช้สำหรับ Upload เท่านั้น ไม่ใช่สำหรับ filter การแสดงผล)
  const filtered = data;
  
  const total = filtered.length;
  let view1PassedDoses = 0;
  let view1TotalDoses = 0;
  let view2Passed = 0;

  for (const r of filtered) {
    const v1 = evalView1Fn(r);
    // ถ้ามี passedCount ให้ใช้คำนวณแบบโดสรวม, ถ้าไม่มีให้ถือว่า 1 คน = 1 โดส
    if (v1.passedCount !== undefined && v1.results) {
      view1PassedDoses += v1.passedCount;
      view1TotalDoses += Object.keys(v1.results).length;
    } else {
      view1PassedDoses += v1.missingVaccines.length === 0 ? 1 : 0;
      view1TotalDoses += 1;
    }

    if (evalView2Fn(r).isFullyImmunized) view2Passed++;
  }

  const view1Coverage = view1TotalDoses > 0 ? (view1PassedDoses / view1TotalDoses) * 100 : 0;
  const view2Coverage = total > 0 ? (view2Passed / total) * 100 : 0;

  return { total, view1PassedDoses, view1TotalDoses, view2Passed, view1Coverage, view2Coverage };
}


// ──────────────────────────────────────────────
// Helper: คำนวณ รพ.สต. ที่มีเด็กตกหล่นมากที่สุด
// รวมทุกกลุ่มอายุเข้าด้วยกัน สำหรับมุมมองที่ 2
// ──────────────────────────────────────────────
function calcFacilityRanking(allGroupedData: { data: any[]; evalFn: (r: any) => { isFullyImmunized: boolean } }[]) {
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
