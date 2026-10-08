import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';
import { useHdcCompleteAnnualReference } from '../hooks/useHdcCompleteAnnualReference';
import { formatDateTimeStr } from '../utils/dateUtils';

interface Props {
  fiscalYear: number;
  ageGroup: string;
  summary: LegacyCompatibleGroupSummary;
  updatedAt?: string | null;
}

export function HdcFullyImmunizedComparison({
  fiscalYear,ageGroup,summary,updatedAt,
}:Props) {
  const [expanded,setExpanded] = useState(false);
  const panelId = useId();
  const { reference,isLoading,error } = useHdcCompleteAnnualReference(fiscalYear,ageGroup,expanded);

  const epiValid = Number.isSafeInteger(summary.view2Passed) &&
    summary.view2Passed >= 0 && Number.isFinite(summary.view2Coverage) &&
    summary.view2Coverage >= 0 && summary.view2Coverage <= 100;
  const eligible = summary.view2ApplicableTotal;
  const denominatorConfirmed = !!reference &&
    Number.isSafeInteger(eligible) && (eligible ?? 0) > 0 &&
    summary.total === reference.target && eligible === reference.target &&
    summary.view2Passed <= (eligible ?? 0);
  const epiConsistent = denominatorConfirmed && epiValid &&
    Math.abs(summary.view2Coverage - summary.view2Passed / (eligible ?? 1) * 100) < 0.01;
  const comparable = denominatorConfirmed && epiConsistent;
  const hdcRate = reference ? reference.result / reference.target * 100 : null;
  const gap = comparable && hdcRate !== null
    ? hdcRate - summary.view2Coverage : null;

  return <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={() => setExpanded(value => !value)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <span className="flex items-center gap-2">
        <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-emerald-600"/>
        เปรียบเทียบกับ HDC Fully Immunized
      </span>
      {expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4"/>
        : <ChevronDown aria-hidden="true" className="h-4 w-4"/>}
    </button>
    {expanded && <div id={panelId} className="border-t border-zinc-100 px-3 pb-3 pt-3 text-xs">
      <p className="mb-3 leading-relaxed text-zinc-500">
        รายงานครบชุดจาก HDC OpenData เทียบกับผลการประเมิน View 2 ของ EPI
        (จำนวนเด็กที่ผ่าน / จำนวนเด็กเป้าหมาย) ไม่ใช่ค่าเฉลี่ยรายวัคซีน
      </p>
      {isLoading ? <p role="status" className="py-2 text-zinc-500">กำลังโหลดข้อมูล HDC...</p>
      : error ? <p role="alert" className="py-2 text-amber-800">
          ไม่สามารถเปรียบเทียบกับ HDC ได้: {error}
        </p>
      : !reference ? <p role="status" className="py-2 text-zinc-500">
          ยังไม่มีรายงาน HDC Fully Immunized สำหรับปีงบประมาณ {fiscalYear}
        </p>
      : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="mb-1 font-medium text-zinc-600">HDC OpenData</p>
            <p className="text-xl font-semibold tabular-nums text-zinc-900">{hdcRate?.toFixed(2)}%</p>
            <p className="mt-1 tabular-nums text-zinc-500">{reference.result.toLocaleString()} / {reference.target.toLocaleString()} คน</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="mb-1 font-medium text-zinc-600">EPI View 2</p>
            <p className="text-xl font-semibold tabular-nums text-zinc-900">
              {epiValid ? summary.view2Coverage.toFixed(2) + '%' : 'ประเมินไม่ได้'}
            </p>
            <p className="mt-1 tabular-nums text-zinc-500">
              {epiValid ? summary.view2Passed.toLocaleString() : '—'} / {Number.isSafeInteger(eligible)
                ? eligible?.toLocaleString() : 'ไม่ทราบตัวหาร'} คน
            </p>
          </div>
        </div>
        {!comparable ? <p role="status" className="mt-3 rounded-md bg-amber-50 p-2 text-amber-800">
          ยังไม่สามารถสรุปส่วนต่างได้: ตัวหารของ HDC และ EPI ไม่ตรงกัน
          หรือข้อมูลสรุป EPI ไม่ครบ/ไม่สอดคล้องกับตัวตั้ง–ตัวหาร
          (HDC {reference.target.toLocaleString()} คน,
          EPI {summary.total.toLocaleString()} คน,
          ประเมินได้ {Number.isSafeInteger(eligible) ? eligible?.toLocaleString() : 'ไม่ทราบ'} คน)
        </p> : <p className="mt-3 font-medium text-zinc-700">
          ส่วนต่าง HDC − EPI: <span className="tabular-nums">
            {gap !== null ? (gap > 0 ? '+' : '') + gap.toFixed(2) + ' จุดร้อยละ' : '—'}
          </span>
        </p>}
        <p className="mt-2 leading-relaxed text-[11px] text-zinc-500">
          ผลที่ตรงกันไม่ได้ยืนยันว่านิยามประเมินของ HDC และ EPI เหมือนกันทุกกรณี
          เนื่องจาก View 2 รองรับผลสถานะที่นำเข้าจาก HDC ด้วย
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          HDC รอบประมวลผล: {reference.processingDate.slice(6,8) + '/' +
          reference.processingDate.slice(4,6) + '/' + reference.processingDate.slice(0,4) + ' ' +
          reference.processingDate.slice(8,10) + ':' + reference.processingDate.slice(10,12)}
          {updatedAt && <> · EPI อัปเดต: {formatDateTimeStr(updatedAt)}</>}
        </p>
        <a
          className="mt-1 inline-block text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
          href={'https://hdc.moph.go.th/pre/public/standard-report-detail/' + reference.reportId + '?subcatalogId=4df360514655f79f13901ef1181ca1c7'}
          target="_blank" rel="noreferrer"
        >
          ดูรายงาน Fully Immunized ต้นทาง
        </a>
      </>}
    </div>}
  </div>;
}
