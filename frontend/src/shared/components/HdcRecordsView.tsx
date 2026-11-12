import { useVaccineRules } from '../hooks/useVaccineRules';
import { getRecordDateWarningDetails } from '../utils/vaccine/dateWarnings';
import { evaluateDynamicV2 } from '../utils/vaccine/ruleEngine';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EpiRecord, VaccineStatus } from '../types';
import { EpiDataTable } from './EpiDataTable';
import { HDC_MISMATCH_LABEL as MISMATCH_LABEL, VaccineHistoryModal } from './VaccineHistoryModal';
import { VaccineRulesGuide } from './VaccineRulesGuide';
import { Button } from './ui/button';
import { formatAgeStr, formatDateStr, formatDateTimeStr, getBirthDateRangeForQuarter } from '../utils/dateUtils';
import { getHdcExportRows, hdcValue } from '../utils/vaccine/hdcData';
import { exportToExcel, exportToPdf } from '../exportUtils';

interface HdcRecordsViewProps {
  age: number;
  fiscalYear: number;
  quarter: number | 'all';
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

// Issue #101 (ADR-0006): ผลตามกฎในระบบเป็นหลัก `result` ของ HDC แสดงประกอบ
const RULE_STATUS_LABELS: Record<NonNullable<VaccineStatus['status']>, string> = {
  PASS: 'ผ่าน',
  FAIL: 'ไม่ผ่าน',
  // Issue #102: คำเตือนวันที่ไม่ใช่เข็มขาด — งานตรวจข้อมูลต้นทาง ไม่ใช่รายชื่อตามฉีด
  REVIEW: 'ตรวจสอบประวัติ',
  PENDING: 'ยังไม่ถึงเกณฑ์',
  NOT_EVALUABLE: 'ประเมินไม่ได้',
};
const RULE_STATUS_CLASSES: Record<string, string> = {
  [RULE_STATUS_LABELS.PASS]: 'bg-emerald-100 text-emerald-800',
  [RULE_STATUS_LABELS.FAIL]: 'bg-red-100 text-red-700',
  [RULE_STATUS_LABELS.REVIEW]: 'bg-amber-100 text-amber-800',
};

export function HdcRecordsView({ age, fiscalYear, quarter, data, isLoading, error, asOfDate }: HdcRecordsViewProps) {
  const { rules, isLoading: rulesLoading, error: rulesError } = useVaccineRules(fiscalYear, `${age}yr`);
  const [facility, setFacility] = useState('');
  const [ruleStatus, setRuleStatus] = useState('');
  const [result, setResult] = useState('');
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<(typeof processed)[number] | null>(null);
  const cohort = useMemo(() => {
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, age);
    return data.filter(record => {
      const birth = new Date(record.birth);
      return birth >= start && birth <= end;
    });
  }, [data, fiscalYear, quarter, age]);
  // ไม่มีกฎ View 2 = ตัดสินไม่ได้ ต้องไม่แสดงว่าทุกคนผ่าน (fail closed)
  const rulesUnavailableLabel = rulesLoading ? 'กำลังโหลดเกณฑ์...'
    : rulesError ? 'โหลดเกณฑ์ไม่สำเร็จ'
      : !rules.some(rule => rule.view_type === 2 && rule.is_active) ? 'ยังไม่มีเกณฑ์'
        : null;
  const processed = useMemo(() => cohort.map(record => {
    if (rulesUnavailableLabel) return { ...record, ruleStatus: rulesUnavailableLabel, ruleDetails: '', dateWarningDetails: [], dateWarnings: '', hdcMismatch: false };
    const evaluation = evaluateDynamicV2(record, rules);
    const details = [
      evaluation.missingVaccines.length ? `ขาด: ${evaluation.missingVaccines.join(', ')}` : '',
      evaluation.pendingVaccines?.length ? `ยังไม่ถึงเกณฑ์: ${evaluation.pendingVaccines.join(', ')}` : '',
      evaluation.notEvaluableVaccines?.length ? `ประเมินไม่ได้: ${evaluation.notEvaluableVaccines.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    // Issue #102/#130: ข้อสังเกตวันที่ (ชื่อเข็มและวันที่) แสดงใต้ผลตามกฎและอยู่ในไฟล์ export
    // ให้แก้ต้นทางได้โดยไม่ต้องเปิดประวัติทีละคน — แทนรายละเอียด "ตรวจสอบประวัติ: <ชื่อกฎ>"
    const dateWarningDetails = getRecordDateWarningDetails(record, rules);
    const dateWarnings = dateWarningDetails.map(warning => warning.message).join(' · ');
    return { ...record, ruleStatus: RULE_STATUS_LABELS[evaluation.status ?? 'NOT_EVALUABLE'], ruleDetails: details, dateWarningDetails, dateWarnings, hdcMismatch: !!evaluation.hdcMismatch };
  }), [cohort, rules, rulesUnavailableLabel]);
  const facilities = useMemo(() => [...new Map(cohort.map(record => [record.hoscode, record.hosname])).entries()].sort(), [cohort]);
  const results = useMemo(() => [...new Set(cohort.map(record => hdcValue(record.result)))].sort(), [cohort]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return processed.filter(record =>
      (!facility || record.hoscode === facility) &&
      (!ruleStatus || record.ruleStatus === ruleStatus) &&
      (!result || hdcValue(record.result) === result) &&
      (!mismatchOnly || record.hdcMismatch) &&
      (!query || `${record.cid} ${record.pid} ${record.name} ${record.lname}`.toLocaleLowerCase().includes(query)),
    );
  }, [processed, facility, ruleStatus, result, mismatchOnly, search]);
  type Row = (typeof processed)[number];
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { header: 'สถานบริการ', accessorKey: 'hoscode', cell: ({ row }) => <div><div>{row.original.hoscode}</div><div className="text-xs text-zinc-500">{row.original.hosname}</div></div> },
    { header: 'CID', accessorKey: 'cid' },
    { header: 'ที่อยู่', accessorFn: record => hdcValue(record.addr) },
    { header: 'ประเภทพื้นที่', accessorFn: record => hdcValue(record.check_typearea) },
    { header: 'ชื่อ-สกุล', accessorFn: record => `${record.name} ${record.lname}` },
    { header: 'วันเกิด', accessorKey: 'birth', cell: ({ row }) => <div>{formatDateStr(row.original.birth)}<div className="text-xs text-zinc-500">(อายุ {formatAgeStr(row.original.birth)})</div></div> },
    {
      header: 'ผลตามกฎ',
      accessorKey: 'ruleStatus',
      cell: ({ row }) => (
        <div>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${RULE_STATUS_CLASSES[row.original.ruleStatus] ?? 'bg-zinc-100 text-zinc-700'}`}>{row.original.ruleStatus}</span>
          {row.original.ruleDetails && <div className="text-xs text-zinc-500 mt-1">{row.original.ruleDetails}</div>}
          {row.original.dateWarningDetails.length > 0 && <ul className="text-xs text-amber-800 mt-1 space-y-0.5">{row.original.dateWarningDetails.map(warning => <li key={warning.message}>{warning.message}</li>)}</ul>}
        </div>
      ),
    },
    {
      header: 'ผลจาก HDC (ประกอบ)',
      accessorFn: record => hdcValue(record.result),
      cell: ({ row, getValue }) => (
        <div>
          <span className="whitespace-pre-wrap">{getValue<string>()}</span>
          {row.original.hdcMismatch && <div><span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 mt-1">{MISMATCH_LABEL}</span></div>}
        </div>
      ),
    },
    { header: 'ประวัติวัคซีน', id: 'history', cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => setSelectedPatient(row.original)}>ดูประวัติ</Button> },
  ], []);

  if (isLoading) return <p role="status" className="py-12 text-center">กำลังโหลดข้อมูล HDC...</p>;
  if (error) return <p role="alert" className="py-12 text-center text-red-700">{error}</p>;
  const filename = `HDC_${age}yr_${fiscalYear}_${quarter}`;
  const exportRows = () => getHdcExportRows(filtered).map((row, index) => ({
    ...row,
    'ผลตามกฎ': filtered[index].ruleStatus,
    'รายละเอียดผลตามกฎ': filtered[index].ruleDetails,
    'ข้อสังเกตวันที่': filtered[index].dateWarnings,
    [MISMATCH_LABEL]: filtered[index].hdcMismatch ? 'ใช่' : '',
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">รายชื่อเด็กอายุครบ {age} ปี</h2>
        <p className="text-sm text-zinc-500">ผลตามกฎวัคซีนที่ตั้งค่าไว้ แสดงผลจาก HDC ประกอบ เปิดประวัติเพื่อดูวันที่วัคซีนแต่ละเข็ม</p>
        {asOfDate && <p className="text-xs text-zinc-500 mt-1">ข้อมูล ณ วันที่ {formatDateTimeStr(asOfDate)}</p>}
      </div>
      <VaccineRulesGuide rules={rules} viewType={2} isLoading={rulesLoading} error={rulesError} />
      <div className="flex flex-wrap gap-3">
        <input aria-label="ค้นหาชื่อหรือ CID" placeholder="ค้นหาชื่อหรือ CID" value={search} onChange={event => setSearch(event.target.value)} className="border rounded-lg px-3 py-2 text-sm w-full sm:w-56" />
        <select aria-label="สถานบริการ" value={facility} onChange={event => setFacility(event.target.value)} className="border rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="">ทุกสถานบริการ</option>
          {facilities.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
        </select>
        <select aria-label="ผลตามกฎ" value={ruleStatus} onChange={event => setRuleStatus(event.target.value)} className="border rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="">ผลตามกฎทั้งหมด</option>
          {Object.values(RULE_STATUS_LABELS).map(label => <option key={label} value={label}>{label}</option>)}
        </select>
        <select aria-label="ผลจาก HDC" value={result} onChange={event => setResult(event.target.value)} className="border rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="">ผลจาก HDC ทั้งหมด</option>
          {results.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mismatchOnly} onChange={event => setMismatchOnly(event.target.checked)} />
          เฉพาะที่{MISMATCH_LABEL}
        </label>
        <Button variant="outline" onClick={() => exportToExcel(exportRows(), filename, 'HDC')}>Excel พร้อมข้อมูลวัคซีน</Button>
        <Button variant="outline" onClick={() => exportToPdf(filtered.map(record => ({
          'สถานบริการ': `${record.hoscode} ${record.hosname}`,
          'CID': record.cid,
          'ที่อยู่': hdcValue(record.addr),
          'ประเภทพื้นที่': hdcValue(record.check_typearea),
          'ชื่อ-สกุล': `${record.name} ${record.lname}`,
          'วันเกิด': formatDateStr(record.birth),
          'ผลตามกฎ': record.ruleStatus,
          'ผลจาก HDC': hdcValue(record.result),
          [MISMATCH_LABEL]: record.hdcMismatch ? 'ใช่' : '',
          'ข้อสังเกตวันที่': record.dateWarnings,
        })), filename, `รายชื่อเด็กอายุครบ ${age} ปี — ผลตามกฎและผลจาก HDC`)}>PDF รายชื่อ</Button>
      </div>
      <p className="text-sm text-zinc-500">แสดง {filtered.length.toLocaleString()} จาก {cohort.length.toLocaleString()} คน</p>
      <EpiDataTable data={filtered} columns={columns} />
      <VaccineHistoryModal warnings={selectedPatient ? getRecordDateWarningDetails(selectedPatient, rules) : []} warningsStatus={rulesLoading ? 'กำลังโหลดเกณฑ์ตรวจวันที่...' : rulesError ? 'โหลดเกณฑ์ตรวจวันที่ไม่สำเร็จ' : rules.length === 0 ? 'ยังไม่มีเกณฑ์ตรวจวันที่สำหรับปีและกลุ่มอายุนี้' : undefined} inapplicableRules={selectedPatient ? evaluateDynamicV2(selectedPatient, rules).inapplicableRules : []} ruleResult={selectedPatient ? { label: selectedPatient.ruleStatus, hdcMismatch: selectedPatient.hdcMismatch } : undefined} isOpen={!!selectedPatient} record={selectedPatient} onClose={() => setSelectedPatient(null)} />
    </div>
  );
}
