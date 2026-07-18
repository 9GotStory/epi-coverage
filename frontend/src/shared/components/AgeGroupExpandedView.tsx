import { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { GroupSummary } from '../utils/dashboardLogic';

interface FacilityData {
  hoscode: string;
  hosname: string;
  total: number;
  passed: number;
  coverage: number;
}

interface AgeGroupExpandedViewProps {
  summary: GroupSummary;
  targetView1: number;
  targetView2: number;
}

interface FacilityGroupProps {
  title: string;
  facilities: FacilityData[];
  target: number;
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
        {title} (≥ {target}%)
      </h5>
      <div className="space-y-1">
        {facilities.length === 0 ? (
          <p className={`text-xs ${classes.emptyText} py-2`}>
            {isPassedGroup ? 'ยังไม่มีหน่วยบริการที่ผ่านเกณฑ์' : 'ทุกหน่วยบริการผ่านเกณฑ์ยอดเยี่ยม!'}
          </p>
        ) : (
          facilities.map((fac, idx) => {
            const gap = !isPassedGroup ? Math.ceil((fac.total * target / 100) - fac.passed) : 0;
            return (
              <div key={fac.hoscode} className={`flex justify-between items-center text-xs py-1.5 border-b ${classes.borderRow} last:border-0`}>
                <span className="text-zinc-700 font-medium truncate pr-2">
                  <span className={`${classes.numText} mr-1.5`}>{idx + 1}.</span>{fac.hosname}
                </span>
                <div className="flex items-center gap-1.5">
                  {!isPassedGroup && (
                    <span className="text-[10px] text-red-600 bg-red-100/70 px-1.5 py-0.5 rounded-md font-medium">ขาด {gap}</span>
                  )}
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

export function AgeGroupExpandedView({ summary, targetView1, targetView2 }: AgeGroupExpandedViewProps) {
  // Use useMemo to avoid recalculating array filters on every re-render
  const passedFacilitiesV1 = useMemo(() => summary.facilityBreakdownV1.filter(f => f.coverage >= targetView1), [summary.facilityBreakdownV1, targetView1]);
  const failedFacilitiesV1 = useMemo(() => summary.facilityBreakdownV1.filter(f => f.coverage < targetView1).sort((a, b) => a.coverage - b.coverage), [summary.facilityBreakdownV1, targetView1]);
  
  const passedFacilitiesV2 = useMemo(() => summary.facilityBreakdownV2.filter(f => f.coverage >= targetView2), [summary.facilityBreakdownV2, targetView2]);
  const failedFacilitiesV2 = useMemo(() => summary.facilityBreakdownV2.filter(f => f.coverage < targetView2).sort((a, b) => a.coverage - b.coverage), [summary.facilityBreakdownV2, targetView2]);
  
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
          {/* View 1 Breakdown */}
          <div>
            <h4 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
              สัดส่วนการได้รับวัคซีนรายชนิด (View 1)
            </h4>
            {summary.view1Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {summary.view1Breakdown.map(item => {
                  const isPassed = item.coverage >= targetView1;
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
            <h4 className="text-sm font-bold text-zinc-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-zinc-800 rounded-full" />
              ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 1
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FacilityGroup title="กลุ่มผ่านเกณฑ์" facilities={passedFacilitiesV1} target={targetView1} isPassedGroup={true} />
              <FacilityGroup title="กลุ่มต้องเร่งติดตาม" facilities={failedFacilitiesV1} target={targetView1} isPassedGroup={false} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="view2" className="space-y-8 outline-none">
          {/* View 2 Breakdown */}
          <div>
            <h4 className="text-sm font-bold text-emerald-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
              สัดส่วนผู้ที่ผ่านเกณฑ์แยกตามหมวด (View 2)
            </h4>
            {summary.view2Breakdown.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {summary.view2Breakdown.map(item => {
                  const isPassed = item.coverage >= targetView2;
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
            <h4 className="text-sm font-bold text-zinc-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-4 bg-zinc-800 rounded-full" />
              ผลการดำเนินงานรายหน่วยบริการ (รพ.สต.) - มุมมองที่ 2
            </h4>
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
