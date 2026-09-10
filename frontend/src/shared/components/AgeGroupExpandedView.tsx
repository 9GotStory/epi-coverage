import { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { GroupSummary } from '../utils/dashboardLogic';
import { useTargetSettings } from '../hooks/useTargetSettings';
import { useVaccineRules } from '../hooks/useVaccineRules';

function shortenFacilityName(name: string) {
  return name.replace(/โรงพยาบาลส่งเสริมสุขภาพตำบล/g, 'รพ.สต.')
             .replace(/สถานบริการสาธารณสุขชุมชน/g, 'สสช.');
}

interface FacilityData {
  hoscode: string;
  hosname: string;
  total: number;
  passed: number;
  coverage: number;
}

interface AgeGroupExpandedViewProps {
  summary: GroupSummary;
  targetView1?: number;
  targetView2?: number;
  fiscalYear: number;
  quarter: number | 'all';
  ageGroup: string;
}

interface FacilityGroupProps {
  title: string;
  facilities: FacilityData[];
  target?: number;
  isPassedGroup: boolean;
}

const FacilityGroup = ({ title, facilities, target, isPassedGroup }: FacilityGroupProps) => {
  const classes = isPassedGroup ? {
    bg: 'bg-green-50/50',
    border: 'border-green-100',
    textTitle: 'text-green-800',
    ping: 'bg-green-400',
    dot: 'bg-green-500',
    emptyText: 'text-green-600/70',
    borderRow: 'border-green-100/50',
    numText: 'text-green-600/60',
    percentText: 'text-green-700',
    percentBg: 'bg-green-200/50'
  } : {
    bg: 'bg-red-50/50',
    border: 'border-red-100',
    textTitle: 'text-red-800',
    ping: 'bg-red-400',
    dot: 'bg-red-500',
    emptyText: 'text-red-600/70',
    borderRow: 'border-red-100/50',
    numText: 'text-red-500/60',
    percentText: 'text-red-700',
    percentBg: 'bg-red-200/50'
  };

  return (
    <div className={`${classes.bg} rounded-xl p-4 border ${classes.border}`}>
      <h5 className={`text-xs font-bold ${classes.textTitle} mb-3 uppercase tracking-wider flex items-center gap-1.5`}>
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${classes.ping} opacity-75`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${classes.dot}`}></span>
        </span>
        {title} {target !== undefined ? `(≥ ${target}%)` : '(ไม่ได้กำหนดเป้า)'}
      </h5>
      <div className="space-y-1">
        {facilities.length === 0 ? (
          <p className={`text-xs ${classes.emptyText} py-2`}>
            {isPassedGroup ? 'ยังไม่มีหน่วยบริการที่ผ่านเกณฑ์' : 'ทุกหน่วยบริการผ่านเกณฑ์ยอดเยี่ยม!'}
          </p>
        ) : (
          facilities.map((fac, idx) => {
            return (
              <div key={fac.hoscode} className={`flex justify-between items-center text-xs py-1.5 border-b ${classes.borderRow} last:border-0`}>
                <span className="text-zinc-700 font-medium truncate pr-2">
                  <span className={`${classes.numText} mr-1.5`}>{idx + 1}.</span>{shortenFacilityName(fac.hosname)}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400">({fac.passed}/{fac.total})</span>
                  <span className={`inline-flex items-center justify-center min-w-[3rem] px-1.5 py-0.5 rounded-md font-semibold ${classes.percentText} ${classes.percentBg}`}>
                    {fac.coverage.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export function AgeGroupExpandedView({ summary, targetView1, targetView2, fiscalYear, quarter, ageGroup }: AgeGroupExpandedViewProps) {
  const { getTarget } = useTargetSettings();
  const { rules } = useVaccineRules(fiscalYear, ageGroup);
  // จับคู่ชื่อเกณฑ์ (display_name จาก summary) → vaccine_group จาก vaccine_rules — ไม่เดาจากชื่อ
  const groupByDisplayName = useMemo(() => new Map(rules.map(rule => [rule.display_name, rule.vaccine_group])), [rules]);

  const getSpecificTarget = (name: string, defaultTarget: number | undefined, view: 1 | 2) => {
    const vaccineKey = (groupByDisplayName.get(name) || '').toLowerCase();
    if (vaccineKey) {
      const targetQuarter = quarter === 'all' ? 4 : quarter;
      return getTarget(targetQuarter, view, vaccineKey, fiscalYear);
    }
    return defaultTarget;
  };

  // Use useMemo to avoid recalculating array filters on every re-render
  const passedFacilitiesV1 = useMemo(() => summary.facilityBreakdownV1.filter(f => f.coverage >= (targetView1 ?? 0)), [summary.facilityBreakdownV1, targetView1]);
  const failedFacilitiesV1 = useMemo(() => summary.facilityBreakdownV1.filter(f => f.coverage < (targetView1 ?? 0)).sort((a, b) => a.coverage - b.coverage), [summary.facilityBreakdownV1, targetView1]);
  
  const passedFacilitiesV2 = useMemo(() => summary.facilityBreakdownV2.filter(f => f.coverage >= (targetView2 ?? 0)), [summary.facilityBreakdownV2, targetView2]);
  const failedFacilitiesV2 = useMemo(() => summary.facilityBreakdownV2.filter(f => f.coverage < (targetView2 ?? 0)).sort((a, b) => a.coverage - b.coverage), [summary.facilityBreakdownV2, targetView2]);
  
  return (
    <div className="mt-4 pt-5 border-t border-zinc-100 animate-in fade-in slide-in-from-top-2 duration-300">
      <Tabs defaultValue="view2" className="w-full">
        <div className="flex justify-center mb-6">
          <TabsList className="grid w-full max-w-[400px] grid-cols-2">
            <TabsTrigger value="view1" className="text-xs">มุมมองที่ 1 (รายวัคซีน)</TabsTrigger>
            <TabsTrigger value="view2" className="text-xs">มุมมองที่ 2 (ครบชุด)</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="view1" className="space-y-8 outline-none">
          {!!summary.view1UnknownDoses && <p role="status" className="text-sm text-muted-foreground">ข้อมูลไม่พอประเมิน {summary.view1UnknownDoses.toLocaleString()} รายการ ไม่นับในตัวหารความครอบคลุม</p>}
          {/* View 1 Breakdown */}
          <div>
            <div className="mb-4">
              <h4 className="text-sm font-bold text-blue-800 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                สัดส่วนการได้รับวัคซีนรายชนิด (View 1)
              </h4>
              <p className="text-[11px] text-zinc-500 mt-1.5 ml-3.5 leading-relaxed bg-blue-50/50 p-2 rounded-md border border-blue-100/50">
                <strong className="text-blue-700 font-semibold mr-1">คำชี้แจง:</strong> 
                การประเมินมุมมองที่ 1 คิดแยกเป็น <strong>"รายเข็ม" (Per Dose)</strong> เพื่อตรวจสอบความครบถ้วนของการบันทึกข้อมูล 
                (วัคซีนเข็มใดที่เด็กยังอายุไม่ถึงเกณฑ์ฉีด จะถูกหักออกจากตัวหารเป้าหมายโดยอัตโนมัติ)
              </p>
            </div>
            {summary.view1Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {summary.view1Breakdown.map(item => {
                  const specificTarget = getSpecificTarget(item.name, targetView1, 1) ?? 0;
                  const isPassed = item.coverage >= specificTarget;
                  if (item.total === 0) return <div key={item.name} className="flex justify-between gap-3 text-xs py-1.5 border-b"><span>{item.name}</span><span className="text-muted-foreground">ยังประเมินไม่ได้</span></div>;
                  return (
                    <div key={item.name} className={`flex justify-between items-center text-xs py-1.5 border-b ${isPassed ? 'border-green-100/30' : 'border-red-100/30'} last:border-0`}>
                      <span className="text-zinc-700 truncate font-medium mr-2" title={item.name}>{item.name}</span>
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-1.5 py-0.5 rounded-md font-semibold ${isPassed ? 'text-green-700 bg-green-100/60' : 'text-red-700 bg-red-100/60'}`}>
                        {item.coverage.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 py-2">ไม่มีข้อมูลวัคซีนในเงื่อนไข</div>
            )}
          </div>

          {/* Facility Leaderboard V1 */}
          <div className="w-full">
            <div className="mb-4">
              <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-zinc-800 rounded-full" />
                ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 1
              </h4>
              <p className="text-[11px] text-zinc-500 mt-1.5 ml-3.5 leading-relaxed bg-zinc-50 p-2 rounded-md border border-zinc-200/60">
                <strong className="text-zinc-700 font-semibold mr-1">คำชี้แจง:</strong> 
                ตัวเลขในวงเล็บแสดงสัดส่วน <strong>(จำนวนโดสที่ฉีดได้ / จำนวนโดสเป้าหมายทั้งหมด)</strong> ซึ่งจะสอดคล้องกับตัวเลขรายงานมาตรฐานของ HDC
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FacilityGroup title="กลุ่มผ่านเกณฑ์" facilities={passedFacilitiesV1} target={targetView1} isPassedGroup={true} />
              <FacilityGroup title="กลุ่มต้องเร่งติดตาม" facilities={failedFacilitiesV1} target={targetView1} isPassedGroup={false} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="view2" className="space-y-8 outline-none">
          {/* View 2 Breakdown */}
          <div>
            <div className="mb-4">
              <h4 className="text-sm font-bold text-emerald-800 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                สัดส่วนตามกฎประเมินภายใน (View 2)
              </h4>
              <p className="text-[11px] text-zinc-500 mt-1.5 ml-3.5 leading-relaxed bg-emerald-50/50 p-2 rounded-md border border-emerald-100/50">
                <strong className="text-emerald-700 font-semibold mr-1">คำชี้แจง:</strong> 
                สรุปนี้คำนวณจากกฎภายในระบบ ส่วนหน้ารายบุคคลมุมมองที่ 2 แสดงผล HDC ต้นทาง ภาพรวม Fully Immunized คิดแบบ <strong>"ต้องผ่านทุกหมวด" (All or Nothing)</strong>
                หากตกเกณฑ์แค่วัคซีนหมวดเดียวจะถือว่าตกภาพรวมทันที (เปอร์เซ็นต์รวมจึงไม่ใช่การนำกราฟแท่งมาหาค่าเฉลี่ย)
              </p>
            </div>
            {summary.view2Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {summary.view2Breakdown.map(item => {
                  const specificTarget = getSpecificTarget(item.name, targetView2, 2) ?? 0;
                  const isPassed = item.coverage >= specificTarget;
                  return (
                    <div key={item.name} className={`flex justify-between items-center text-xs py-1.5 border-b ${isPassed ? 'border-emerald-100/30' : 'border-red-100/30'} last:border-0`}>
                      <span className="text-zinc-700 truncate font-medium mr-2" title={item.name}>{item.name}</span>
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-1.5 py-0.5 rounded-md font-semibold ${isPassed ? 'text-emerald-700 bg-emerald-100/60' : 'text-red-700 bg-red-100/60'}`}>
                        {item.coverage.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 py-2">ไม่มีข้อมูลวัคซีนในเงื่อนไข</div>
            )}
          </div>

          {/* Facility Leaderboard V2 */}
          <div className="w-full">
            <div className="mb-4">
              <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <div className="w-1.5 h-4 bg-zinc-800 rounded-full" />
                ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 2
              </h4>
              <p className="text-[11px] text-zinc-500 mt-1.5 ml-3.5 leading-relaxed bg-zinc-50 p-2 rounded-md border border-zinc-200/60">
                <strong className="text-zinc-700 font-semibold mr-1">คำชี้แจง:</strong> 
                ตัวเลขในวงเล็บแสดงสัดส่วน <strong>(จำนวนเด็กที่ผ่านเกณฑ์ / จำนวนเด็กเป้าหมายทั้งหมด)</strong> ซึ่งจะสอดคล้องกับตัวเลขรายงานมาตรฐานของ HDC
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FacilityGroup title="กลุ่มผ่านเกณฑ์" facilities={passedFacilitiesV2} target={targetView2} isPassedGroup={true} />
              <FacilityGroup title="กลุ่มต้องเร่งติดตาม" facilities={failedFacilitiesV2} target={targetView2} isPassedGroup={false} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
