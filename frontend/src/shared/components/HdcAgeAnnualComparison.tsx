import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import { useHdcAgeAnnualReference } from '../hooks/useHdcAgeAnnualReference';
import { findHdcAgeMetric } from '../utils/hdcAnnualReference';
import { formatDateTimeStr } from '../utils/dateUtils';

interface Props {
  fiscalYear:number;
  ageGroup:string;
  summary:LegacyCompatibleGroupSummary;
  rules:VaccineRule[];
  updatedAt?:string|null;
}

function formatProcessingDate(date:string):string{
  // HDC supplies YYYYMMDDHHMM (ages 2/3/5) or YYYYMMDDHHMMSS (age 1).
  return `${date.slice(6,8)}/${date.slice(4,6)}/${date.slice(0,4)} ${date.slice(8,10)}:${date.slice(10,12)}${date.length===14?`:${date.slice(12,14)}`:''}`;
}

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
  const comparableCount=rows.filter(r=>r.metric&&r.valid).length;

  return <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={()=>setExpanded(v=>!v)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <span className="flex items-center gap-2">
        <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-blue-600"/>
        เปรียบเทียบกับ HDC OpenData
      </span>
      {expanded?<ChevronUp aria-hidden="true" className="h-4 w-4"/>:<ChevronDown aria-hidden="true" className="h-4 w-4"/>}
    </button>
    {expanded && <div id={panelId} className="border-t border-zinc-100 px-3 pb-3 pt-2 text-xs">
      <p className="mb-2 text-zinc-500">
        HDC เป็นตัวเลขจากรายงานกระทรวงสาธารณสุข ส่วน EPI เป็นผลประเมินจากข้อมูลที่นำเข้า
        ทั้งสองแหล่งอาจให้ผลต่างกัน
      </p>
      {isLoading ? <p role="status" className="py-2 text-zinc-500">กำลังโหลดข้อมูล HDC...</p>
      :error ? <p role="alert" className="py-2 text-amber-800">ไม่สามารถเปรียบเทียบกับ HDC ได้: {error}</p>
      :!reference ? <p role="status" className="py-2 text-zinc-500">ยังไม่มีข้อมูลรายงาน HDC ปีงบประมาณ {fiscalYear}</p>
      : rows.length===0 ? <p role="status" className="py-2 text-zinc-500">ยังไม่มีผลประเมินรายวัคซีนของ EPI ในปีนี้</p>
      : <>
        {reference.target!==summary.total && <p role="alert" className="mb-2 rounded-md bg-amber-50 p-2 text-amber-800">
          จำนวนเด็กเป้าหมายต่างกัน: HDC {reference.target.toLocaleString()} คน / EPI {summary.total.toLocaleString()} คน
          — จึงยังไม่คำนวณส่วนต่าง
        </p>}
        <p className="mb-2 text-[11px] text-zinc-500">
          เทียบรายการวัคซีนได้ {comparableCount} จาก {rows.length} รายการ
          {comparableCount<rows.length && ' · รายการที่เหลือยังจับคู่กับ HDC ไม่ได้'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[395px] text-xs">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th scope="col" className="py-2 pr-2 text-left font-medium">วัคซีน EPI</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">HDC</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">ผ่านกฎ EPI</th>
                <th scope="col" className="py-2 pl-2 text-right font-medium">HDC − EPI</th>
              </tr>
            </thead>
            <tbody>{rows.map(({item,metric,valid})=>{
              const sourceCount=reference.numerators[metric??''];
              const available=metric!==null&&Number.isSafeInteger(sourceCount);
              const hdcRate=available ? sourceCount/reference.target*100 : null;
              const comparable=available && valid && reference.target===summary.total &&
                item.total===reference.target;
              return <tr key={item.metric_key??item.name} className="border-b border-zinc-100 last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-medium text-zinc-700">
                  {item.name}
                  {!metric && <span className="block font-normal text-[10px] text-zinc-400">ยังจับคู่กับรายงาน HDC ไม่ได้</span>}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  {hdcRate===null?'—':<>{hdcRate.toFixed(2)}%<span className="block text-[10px] text-zinc-400">{sourceCount}/{reference.target}</span></>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {valid?<>{item.coverage.toFixed(2)}%<span className="block text-[10px] text-zinc-400">{item.passed}/{item.total}</span></>:'ประเมินไม่ได้'}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums text-zinc-600">
                  {comparable && hdcRate!==null ?
                    `${hdcRate>item.coverage?'+':''}${(hdcRate-item.coverage).toFixed(2)} จุด` : 'เทียบไม่ได้'}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          ส่วนต่างแสดงเมื่อจำนวนที่ใช้คำนวณตรงกันเท่านั้น
          ตัวเลขอาจต่างกันเพราะช่วงเวลาและเกณฑ์การนับไม่เหมือนกัน
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          รายงาน HDC ({reference.table}) · รหัส {reference.reportId} · ประมวลผล {formatProcessingDate(reference.dateCom)}
          {updatedAt && <> · EPI อัปเดต {formatDateTimeStr(updatedAt)}</>}
        </p>
      </>}
    </div>}
  </div>;
}
