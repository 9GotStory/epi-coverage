import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import type { LegacyCompatibleGroupSummary } from '../utils/dashboardLogic';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import { useHdcAgeAnnualReference } from '../hooks/useHdcAgeAnnualReference';
import { findHdcAgeMetric } from '../utils/hdcAnnualReference';
import { formatDateTimeStr } from '../utils/dateUtils';

interface Props {
  fiscalYear: number;
  ageGroup: string;
  summary: LegacyCompatibleGroupSummary;
  rules: VaccineRule[];
  updatedAt?: string | null;
}

const INITIAL_VISIBLE = 5;

/**
 * View 2 answers "who completed all requirements"; dose-level HDC reports
 * answer "which dose had lower coverage in the current age cohort".
 * Never mislabel these per-dose figures as a breakdown of s_epi_complete.
 */
export function HdcView2DoseInsights({ fiscalYear, ageGroup, summary, rules, updatedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const panelId = useId();
  const { reference, isLoading, error } = useHdcAgeAnnualReference(fiscalYear, ageGroup, expanded);

  const candidates = summary.view1Breakdown.flatMap(item => {
    const metric = findHdcAgeMetric(item, rules, fiscalYear, ageGroup);
    if (!metric) return [];
    // V1 doses marked out-of-plan must not dominate the V2 follow-up list.
    const associated = rules.filter(rule => rule.is_active && rule.view_type === 1 &&
      rule.age_group === ageGroup && Number(rule.fiscal_year) === fiscalYear &&
      rule.display_name === item.name && (rule.metric_key || rule.rule_id) === item.metric_key &&
      rule.is_required_for_v2 !== false && !rule.display_only);
    if (associated.length !== 1) return [];
    return [{ name: item.name, metric }];
  });
  const missedMappings = summary.view1Breakdown.length - candidates.length;
  const allItems = reference ? candidates.map(candidate => {
    const received = reference.numerators[candidate.metric];
    return { ...candidate, received, target: reference.target,
      rate: received / reference.target * 100,
      unreceived: reference.target - received };
  }).sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name)) : [];
  const items = showAll ? allItems : allItems.slice(0, INITIAL_VISIBLE);

  return <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
    <button type="button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(value => !value)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
      <span className="flex items-center gap-2">
        <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-emerald-600" />
        ดูความครอบคลุมรายเข็มจาก HDC
      </span>
      {expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> :
        <ChevronDown aria-hidden="true" className="h-4 w-4" />}
    </button>
    {expanded && <div id={panelId} className="border-t border-zinc-100 px-3 py-3 text-xs">
      <p className="mb-3 text-zinc-500 leading-relaxed">
        รายการรายเข็มจากรายงาน HDC ของกลุ่มอายุนี้ เรียงจากความครอบคลุมต่ำไปสูง
        เพื่อช่วยเลือกประเด็นติดตาม ไม่ใช่การแจกแจงผล Fully Immunized
      </p>
      {isLoading ? <p role="status" className="py-2 text-zinc-500">กำลังโหลดข้อมูลรายเข็ม HDC...</p>
        : error ? <p role="alert" className="py-2 text-amber-800">ไม่สามารถอ่านข้อมูลรายเข็ม HDC ได้: {error}</p>
        : !reference ? <p role="status" className="py-2 text-zinc-500">
          ยังไม่มีผลรายวัคซีน HDC สำหรับกลุ่มอายุและปีงบประมาณนี้
        </p>
        : allItems.length === 0 ? <p role="status" className="py-2 text-zinc-500">
          ไม่มีรายการที่จับคู่รายเข็ม HDC กับกฎ EPI สำหรับปีนี้ได้
        </p>
        : <>
          <p className="mb-2 text-[11px] text-zinc-500">
            เป้าหมายรายเข็ม HDC {reference.target.toLocaleString()} คน · ตรวจเชื่อมโยงได้ {allItems.length} รายการ
          </p>
          <ol className="space-y-3">
            {items.map(item => <li key={item.metric} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-zinc-700" title={item.name}>{item.name}</span>
                <span className="shrink-0 tabular-nums font-semibold text-zinc-800">
                  {item.rate.toFixed(2)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${item.rate}%` }}/>
              </div>
              <p className="text-[11px] tabular-nums text-zinc-500">
                ได้รับ {item.received.toLocaleString()} / {item.target.toLocaleString()} คน
                {' · '}ยังไม่มีผลงานในตัวชี้วัด {item.unreceived.toLocaleString()} คน
              </p>
            </li>)}
          </ol>
          {allItems.length > INITIAL_VISIBLE && <button type="button"
            onClick={() => setShowAll(value => !value)}
            className="mt-3 text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
            {showAll ? 'แสดงเฉพาะรายการที่ความครอบคลุมต่ำสุด'
              : `ดูรายเข็มทั้งหมด (${allItems.length} รายการ)`}
          </button>}
          {missedMappings > 0 && <p className="mt-3 text-[11px] text-zinc-500">
            ไม่รวม {missedMappings} รายการที่เป็นวัคซีนนอกแผนหรือยังไม่ยืนยันรหัสเชื่อมโยงกับ HDC
          </p>}
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            หมายเหตุ: คนเดียวกันอาจยังไม่ได้รับวัคซีนมากกว่าหนึ่งเข็ม
            จำนวนแต่ละเข็มจึงไม่ใช่จำนวนเด็กที่ไม่ครบชุด และรายงานรายเข็มอาจมีตัวหาร
            ต่างจากรายงาน Fully Immunized โดยเฉพาะเด็กอายุ 3 และ 5 ปี
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            HDC {reference.table} · รอบประมวลผล {reference.dateCom.slice(6,8)}/{reference.dateCom.slice(4,6)}/{reference.dateCom.slice(0,4)}
            {' '}{reference.dateCom.slice(8,10)}:{reference.dateCom.slice(10,12)}
            {updatedAt && <> · EPI อัปเดต {formatDateTimeStr(updatedAt)}</>}
          </p>
          <a href={`https://hdc.moph.go.th/pre/public/standard-report-detail/${reference.reportId}?subcatalogId=4df360514655f79f13901ef1181ca1c7`}
            target="_blank" rel="noreferrer"
            className="mt-1 inline-block text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
            ดูรายงาน HDC รายวัคซีนต้นทาง
          </a>
        </>}
    </div>}
  </div>;
}
