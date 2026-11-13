import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Landmark } from 'lucide-react';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import { useHdcAgeAnnualReference } from '../hooks/useHdcAgeAnnualReference';
import { findHdcAgeMetric, formatHdcProcessingDate } from '../utils/hdcAnnualReference';
import { formatDateTimeStr } from '../utils/dateUtils';

interface Props {
  fiscalYear:number;
  ageGroup:string;
  summary:LegacyCompatibleGroupSummary;
  rules:VaccineRule[];
  updatedAt?:string|null;
}

/**
 * HDC Dose Coverage (CONTEXT.md §56) beside the View 1 result, each with its own
 * denominator. No HDC − EPI difference, even when the denominators match (Issue #188).
 */
export function HdcAgeAnnualComparison({fiscalYear,ageGroup,summary,rules,updatedAt}:Props){
  const [expanded,setExpanded]=useState(false);
  const panelId=useId();
  const {reference,isLoading,error}=useHdcAgeAnnualReference(fiscalYear,ageGroup,expanded);
  // Every displayed vaccine comes ONLY from the current EPI summary, linked to
  // the current fiscal-year rule by a persisted stable metric identity.
  const rows=summary.view1Breakdown.map(item=>{
    const metric=findHdcAgeMetric(item,rules,fiscalYear,ageGroup);
    const valid=Number.isSafeInteger(item.passed)&&Number.isSafeInteger(item.total)&&
      item.total>0&&item.passed>=0&&item.passed<=item.total&&Number.isFinite(item.coverage);
    return {item,metric,valid};
  });
  const matchedCount=rows.filter(r=>r.metric).length;

  return <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={()=>setExpanded(v=>!v)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <span className="flex items-center gap-2">
        <Landmark aria-hidden="true" className="h-4 w-4 text-blue-600"/>
        ความครอบคลุมรายวัคซีนตาม HDC
      </span>
      {expanded?<ChevronUp aria-hidden="true" className="h-4 w-4"/>:<ChevronDown aria-hidden="true" className="h-4 w-4"/>}
    </button>
    {expanded && <div id={panelId} className="border-t border-zinc-100 px-3 pb-3 pt-2 text-xs">
      {isLoading ? <p role="status" className="py-2 text-zinc-500">กำลังโหลดข้อมูล HDC...</p>
      :error ? <p role="alert" className="py-2 text-amber-800">ไม่สามารถดึงข้อมูล HDC ได้: {error}</p>
      :!reference ? <p role="status" className="py-2 text-zinc-500">ยังไม่มีข้อมูลจาก HDC ปีงบประมาณ {fiscalYear}</p>
      : rows.length===0 ? <p role="status" className="py-2 text-zinc-500">ยังไม่มีผลประเมินรายวัคซีนของ EPI ในปีนี้</p>
      : <>
        <p className="mb-2 text-[11px] text-zinc-500">
          จับคู่กับรายงาน HDC ได้ {matchedCount} จาก {rows.length} รายการ
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[395px] text-xs">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th scope="col" className="py-2 pr-2 text-left font-medium">วัคซีน EPI</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">HDC</th>
                <th scope="col" className="py-2 pl-2 text-right font-medium">ผ่านกฎ EPI</th>
              </tr>
            </thead>
            <tbody>{rows.map(({item,metric,valid})=>{
              const sourceCount=reference.numerators[metric??''];
              const available=metric!==null&&Number.isSafeInteger(sourceCount);
              const hdcRate=available ? sourceCount/reference.target*100 : null;
              return <tr key={item.metric_key??item.name} className="border-b border-zinc-100 last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-medium text-zinc-700">
                  {item.name}
                  {!metric && <span className="block font-normal text-[10px] text-zinc-400">ยังจับคู่กับรายงาน HDC ไม่ได้</span>}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  {hdcRate===null?'—':<>{hdcRate.toFixed(2)}%<span className="block text-[10px] text-zinc-400">{sourceCount}/{reference.target}</span></>}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {valid?<>{item.coverage.toFixed(2)}%<span className="block text-[10px] text-zinc-400">{item.passed}/{item.total}</span></>:'ประเมินไม่ได้'}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          HDC ใช้เกณฑ์ ตัวหาร และรอบประมวลผลของกระทรวง ผลจึงอาจต่างจากผลประเมินจากข้อมูลที่นำเข้า
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          รายงาน HDC ({reference.table}) · รหัส {reference.reportId} · ประมวลผล {formatHdcProcessingDate(reference.dateCom)}
          {updatedAt && <> · EPI อัปเดต {formatDateTimeStr(updatedAt)}</>}
        </p>
      </>}
    </div>}
  </div>;
}
