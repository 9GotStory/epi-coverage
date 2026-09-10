import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EpiRecord } from '../types';
import type { EpiAge, View1AgeProps } from '../types/hdc';
import { useVaccineRules } from '../hooks/useVaccineRules';
import { isOutPlanRule, sortRulesForDisplay } from '../utils/vaccine/rulePresentation';
import { evaluateDynamicV1 } from '../utils/vaccine/ruleEngine';
import { getRecordDateWarnings } from '../utils/vaccine/dateWarnings';
import { getHdcExportRows, getHdcVaccineRows, hdcValue } from '../utils/vaccine/hdcData';
import { formatDateStr, formatDateTimeStr, getBirthDateRangeForQuarter } from '../utils/dateUtils';
import { exportToExcel, exportToPdf } from '../exportUtils';
import { EpiDataTable } from './EpiDataTable';
import { VaccineHistoryModal } from './VaccineHistoryModal';
import { VaccineRulesGuide } from './VaccineRulesGuide';
import { Button } from './ui/button';

const STATUS_COMPLETE = 'ครบ';
const STATUS_INCOMPLETE = 'ไม่ครบ';
const STATUS_PENDING = 'ยังไม่ถึงเกณฑ์';
const STATUS_UNKNOWN = 'ข้อมูลไม่พอประเมิน';
const STATUS_OPTIONS = [STATUS_COMPLETE, STATUS_INCOMPLETE, STATUS_PENDING, STATUS_UNKNOWN];

export function View1AgeRecords({ age, fiscalYear, quarter, data, isLoading, error, asOfDate }: View1AgeProps & { age: EpiAge }) {
  const { rules, isLoading: rulesLoading, error: rulesError } = useVaccineRules(fiscalYear, `${age}yr`);
  const ageRules = useMemo(() => sortRulesForDisplay(rules.filter(rule => rule.view_type === 1 && rule.is_active)), [rules]);
  const [facility, setFacility] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<EpiRecord | null>(null);
  const processed = useMemo(() => {
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, age);
    return data.filter(record => {
      const birth = new Date(record.birth);
      return birth >= start && birth <= end;
    }).map(record => {
      const evaluation = evaluateDynamicV1(record, rules);
      const warnings = getRecordDateWarnings(record, ageRules);
      const missing = evaluation.missingVaccines.filter(value => !warnings.some(warning => value.includes(warning)));
      const unknown = rulesLoading || rulesError || !rules.length || !!evaluation.unknownVaccines?.length;
      // สถานะเต็ม (ใช้กับ filter + tooltip): unknown > missing > warnings > pending > ครบ
      // (กรณีมี date warning เช่น ลงวันที่ตรงวันเกิด → rule นั้นไม่ผ่าน จึงต้องเป็น ไม่ครบ ไม่ใช่ ครบ)
      const status = unknown ? STATUS_UNKNOWN
        : missing.length || warnings.length ? STATUS_INCOMPLETE
        : evaluation.pendingVaccines?.length ? STATUS_PENDING
        : STATUS_COMPLETE;
      // badge แสดงเฉพาะ ครบ/ไม่ครบ — เหตุผลเต็มอยู่ใน tooltip
      const badge = status === STATUS_COMPLETE ? STATUS_COMPLETE : STATUS_INCOMPLETE;
      const details = [...missing, ...(evaluation.pendingVaccines || []), ...(evaluation.unknownVaccines || [])];
      const tooltipParts = details.length ? [details.join(' · ')] : [];
      if (warnings.length) tooltipParts.push(`ตรวจสอบวันที่: ${warnings.join(' · ')}`);
      return { ...record, evaluationStatus: status, evaluationBadge: badge, evaluationDetails: details.join(' · '), evaluationTooltip: tooltipParts.join(' · ') };
    });
  }, [data, fiscalYear, quarter, age, rules, ageRules, rulesLoading, rulesError]);
  const facilities = [...new Map(processed.map(record => [record.hoscode, record.hosname])).entries()].sort();
  const filtered = processed.filter(record => (!facility || record.hoscode === facility) &&
    (!statusFilter || record.evaluationStatus === statusFilter) &&
    `${record.name} ${record.lname} ${record.cid} ${record.pid} ${record.addr || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  type Row = (typeof processed)[number];
  const columns: ColumnDef<Row>[] = [
    { header: 'สถานบริการ', accessorFn: record => `${record.hoscode} ${record.hosname}` },
    { header: 'CID', accessorKey: 'cid' },
    { header: 'ชื่อ-สกุล', accessorFn: record => `${record.name} ${record.lname}` },
    { header: 'วันเกิด', accessorFn: record => formatDateStr(record.birth) },
    { header: 'ที่อยู่', accessorFn: record => hdcValue(record.addr) },
    { header: 'ประเภทพื้นที่', accessorFn: record => hdcValue(record.check_typearea) },
    {
      header: 'ผลการประเมิน',
      accessorKey: 'evaluationBadge',
      cell: ({ row }) => (
        <div title={row.original.evaluationTooltip || row.original.evaluationBadge}>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${row.original.evaluationBadge === STATUS_COMPLETE ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
            {row.original.evaluationBadge}
          </span>
        </div>
      ),
    },
    { header: 'วัคซีนตามกลุ่มอายุ', id: 'history', cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => setSelected(row.original)}>ดูรายละเอียด</Button> },
  ];
  const filename = `EPI_View1_${age}yr_${fiscalYear}_${quarter}`;
  const exportRows = () => getHdcExportRows(filtered, ageRules).map((row, index) => ({
    ...row, 'ผลการประเมิน': filtered[index].evaluationBadge, 'รายละเอียดผล': filtered[index].evaluationDetails,
    'รายการตามกลุ่มอายุ': getHdcVaccineRows(filtered[index], ageRules).map(dose => `${dose.name}: ${dose.date}${dose.note ? ` (${dose.note})` : ''}`).join('\n'),
  }));
  if (isLoading) return <p role="status">กำลังโหลดข้อมูล...</p>;
  if (error) return <p role="alert">{error}</p>;
  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold">วัคซีนรายชนิดสำหรับกลุ่มอายุ {age} ปี</h2>
      <p className="text-sm text-muted-foreground">
        {rulesLoading ? 'กำลังโหลดเกณฑ์...' : `${ageRules.length} รายการตามกลุ่มอายุ`}
        {ageRules.some(isOutPlanRule) && ' · รายการนอกแผนแสดงประกอบและไม่นับในความครบถ้วน'}
      </p>
      {asOfDate && <p className="text-sm text-muted-foreground">ข้อมูล ณ {formatDateTimeStr(asOfDate)}</p>}
      {rulesError && <p role="alert">โหลดเกณฑ์ไม่สำเร็จ: {rulesError}</p>}
    </div>
    <VaccineRulesGuide rules={rules} viewType={1} isLoading={rulesLoading} error={rulesError} />
    <div className="flex flex-wrap gap-3">
      <input aria-label="ค้นหารายชื่อ" value={search} onChange={event => setSearch(event.target.value)} placeholder="ชื่อ CID หรือที่อยู่" className="border rounded-md p-2 w-full sm:w-56" />
      <select aria-label="สถานบริการ" value={facility} onChange={event => setFacility(event.target.value)} className="border rounded-md p-2 max-w-full"><option value="">ทุกสถานบริการ</option>{facilities.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select>
      <select aria-label="ผลการประเมิน" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="border rounded-md p-2"><option value="">ทุกผลการประเมิน</option>{STATUS_OPTIONS.map(status => <option key={status}>{status}</option>)}</select>
      <Button variant="outline" onClick={() => exportToExcel(exportRows(), filename)}>Excel พร้อมวัคซีนตามอายุ</Button>
      <Button variant="outline" onClick={() => exportToPdf(filtered.map(record => ({ 'สถานบริการ': record.hoscode, 'ชื่อ-สกุล': `${record.name} ${record.lname}`, 'ที่อยู่': hdcValue(record.addr), 'ประเภทพื้นที่': hdcValue(record.check_typearea), 'ผลการประเมิน': record.evaluationBadge, 'รายละเอียด': record.evaluationDetails })), filename, `วัคซีนรายชนิด อายุ ${age} ปี`)}>PDF รายชื่อ</Button>
    </div>
    <p className="text-sm text-muted-foreground">แสดง {filtered.length} จาก {processed.length} คน</p>
    <EpiDataTable data={filtered} columns={columns} />
    <VaccineHistoryModal rules={ageRules} caption={`รายการวัคซีนสำหรับกลุ่มอายุ ${age} ปี`} record={selected} isOpen={!!selected} onClose={() => setSelected(null)} warnings={selected ? getRecordDateWarnings(selected, ageRules) : []} warningsStatus={rulesLoading ? 'กำลังโหลดเกณฑ์...' : rulesError || undefined} />
  </div>;
}
