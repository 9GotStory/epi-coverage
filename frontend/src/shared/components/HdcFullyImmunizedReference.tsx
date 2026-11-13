import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Landmark } from 'lucide-react';
import { useHdcFullyImmunizedReference } from '../hooks/useHdcFullyImmunizedReference';
import { formatHdcProcessingDate } from '../utils/hdcAnnualReference';

interface Props {
  fiscalYear:number;
  ageGroup:string;
}

/**
 * HDC Coverage (CONTEXT.md §53) beside View 2: the Ministry's own figure,
 * shown as is. No difference against View 2 and no Coverage Goal (Issue #186).
 */
export function HdcFullyImmunizedReference({fiscalYear,ageGroup}:Props){
  const [expanded,setExpanded]=useState(false);
  const panelId=useId();
  const {reference,invalidReason,isLoading,requestError}=useHdcFullyImmunizedReference(fiscalYear,ageGroup,expanded);

  return <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={()=>setExpanded(v=>!v)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <span className="flex items-center gap-2">
        <Landmark aria-hidden="true" className="h-4 w-4 text-emerald-600"/>
        ความครอบคลุมตาม HDC (Fully Immunized)
      </span>
      {expanded?<ChevronUp aria-hidden="true" className="h-4 w-4"/>:<ChevronDown aria-hidden="true" className="h-4 w-4"/>}
    </button>
    {expanded && <div id={panelId} className="border-t border-zinc-100 px-3 pb-3 pt-2 text-xs">
      {isLoading ? <p role="status" className="py-2 text-zinc-500">กำลังโหลดข้อมูล HDC...</p>
      :requestError ? <p role="alert" className="py-2 text-amber-800">ไม่สามารถดึงข้อมูล HDC ได้: {requestError}</p>
      :invalidReason ? <p role="alert" className="py-2 text-amber-800">ข้อมูล HDC ไม่ถูกต้อง: {invalidReason}</p>
      :!reference ? <p role="status" className="py-2 text-zinc-500">ยังไม่มีข้อมูลจาก HDC ปีงบประมาณ {fiscalYear}</p>
      : <>
        <p className="text-2xl font-semibold tabular-nums text-zinc-800">{(reference.result/reference.target*100).toFixed(1)}%</p>
        <p className="tabular-nums text-zinc-600">{reference.result.toLocaleString()}/{reference.target.toLocaleString()} คน</p>
        <p className="mt-2 text-[11px] text-zinc-500">ข้อมูล HDC ณ {formatHdcProcessingDate(reference.dateCom)}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          HDC ใช้เกณฑ์และรอบประมวลผลของกระทรวง ผลจึงอาจต่างจากผลประเมินจากข้อมูลที่นำเข้าด้านบน
        </p>
      </>}
    </div>}
  </div>;
}
