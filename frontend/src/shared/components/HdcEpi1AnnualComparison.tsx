import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import { useHdcEpi1AnnualReference } from '../hooks/useHdcEpi1AnnualReference';
import { findHdcEpi1Metric } from '../utils/hdcAnnualReference';
import { formatDateTimeStr } from '../utils/dateUtils';

interface Props {
  fiscalYear: number;
  summary: LegacyCompatibleGroupSummary;
  rules: VaccineRule[];
  updatedAt?: string | null;
}

const HDC_REPORT_URL = 'https://hdc.moph.go.th/pre/public/standard-report-detail/c88658f4d09acb8c76e6c06ffb58ebaf?subcatalogId=4df360514655f79f13901ef1181ca1c7';

export function HdcEpi1AnnualComparison({ fiscalYear, summary, rules, updatedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  // No API call until the user requests comparison; not a second dashboard.
  const { reference, isLoading, error } = useHdcEpi1AnnualReference(fiscalYear, expanded);
  const comparable = summary.view1Breakdown.flatMap(item => {
    const metric = findHdcEpi1Metric(item, rules, fiscalYear);
    if (!metric || !Number.isFinite(item.coverage) ||
      !Number.isSafeInteger(item.passed) || !Number.isSafeInteger(item.total) ||
      item.total <= 0 || item.passed < 0 || item.passed > item.total) return [];
    return [{ item, metric }];
  });

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <span className="flex items-center gap-2">
          <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-blue-600" />
          เปรียบเทียบกับ HDC OpenData
        </span>
        {expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-zinc-100 px-3 pb-3 pt-2 text-xs">
          <p className="mb-2 text-zinc-500">
            ข้อมูลรายงาน HDC ที่ประมวลผลแล้ว เทียบกับผลผ่านกฎตรวจสอบของ EPI
            (เฉพาะรหัสวัคซีนที่ยืนยันการจับคู่แล้ว)
          </p>
          {isLoading ? (
            <p role="status" className="py-2 text-zinc-500">กำลังโหลดผลรายงาน HDC...</p>
          ) : error ? (
            <p role="alert" className="py-2 text-amber-800">ไม่สามารถเปรียบเทียบกับ HDC ได้: {error}</p>
          ) : !reference ? (
            <p role="status" className="py-2 text-zinc-500">ยังไม่มีข้อมูล HDC OpenData สำหรับปีงบประมาณ {fiscalYear}</p>
          ) : comparable.length === 0 ? (
            <p role="status" className="py-2 text-zinc-500">ยังไม่มีรายการที่ยืนยันรหัสเชื่อมโยง HDC กับสรุป EPI ของปีนี้</p>
          ) : (
            <>
              {reference.target !== summary.total && (
                <p role="alert" className="mb-2 rounded-md bg-amber-50 p-2 text-amber-800">
                  จำนวนเด็กเป้าหมายไม่ตรงกัน (HDC {reference.target.toLocaleString()} / EPI {summary.total.toLocaleString()})
                  — ไม่สรุปส่วนต่างร้อยละจนกว่าจะยืนยันประชากรและรอบข้อมูล
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[380px] text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500">
                    <tr>
                      <th scope="col" className="py-2 pr-2 font-medium">วัคซีน</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">HDC</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">ผ่านกฎ EPI</th>
                      <th scope="col" className="py-2 pl-2 text-right font-medium">ส่วนต่าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparable.map(({ item, metric }) => {
                      const numerator = reference.numerators[metric];
                      const hdcCoverage = numerator / reference.target * 100;
                      const sameDenominator = reference.target === summary.total && item.total === reference.target;
                      return (
                        <tr key={item.metric_key} className="border-b border-zinc-100 last:border-0">
                          <th scope="row" className="py-2 pr-2 font-medium text-zinc-700">{item.name}</th>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {hdcCoverage.toFixed(2)}%
                            <span className="block text-[10px] text-zinc-400">{numerator}/{reference.target}</span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {item.coverage.toFixed(2)}%
                            <span className="block text-[10px] text-zinc-400">{item.passed}/{item.total}</span>
                          </td>
                          <td className="py-2 pl-2 text-right tabular-nums text-zinc-600">
                            {sameDenominator ? `${Math.abs(hdcCoverage - item.coverage).toFixed(2)} จุด` : 'เทียบไม่ได้'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                ตัวเลขต่างกันได้จากกฎตรวจวันที่หรือรอบปรับปรุงข้อมูลต่างกัน
                ไม่ถือว่าเป็นข้อสรุปว่าระเบียนรายบุคคลผิดโดยอัตโนมัติ
              </p>
              <p className="mt-2 text-[11px] text-zinc-500">
                HDC รอบประมวลผล: {reference.dateCom.slice(6,8)}/{reference.dateCom.slice(4,6)}/{reference.dateCom.slice(0,4)} {reference.dateCom.slice(8,10)}:{reference.dateCom.slice(10,12)}
                {updatedAt && <> · EPI อัปเดต: {formatDateTimeStr(updatedAt)}</>}
              </p>
              <a className="mt-1 inline-block text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900" href={HDC_REPORT_URL} target="_blank" rel="noreferrer">
                ดูรายงาน HDC ต้นทาง
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
