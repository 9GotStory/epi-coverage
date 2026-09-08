import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EpiRecord } from '../types';
import type { EpiAge, View1AgeProps } from '../types/hdc';
import { useVaccineRules } from '../hooks/useVaccineRules';
import { AGE_VACCINES, getAgeView1Rules } from '../utils/vaccine/ageVaccines';
import { evaluateAgeView1 } from '../utils/vaccine/ruleEngine';
import { getRecordDateWarnings } from '../utils/vaccine/dateWarnings';
import { getHdcExportRows, getHdcVaccineRows, hdcValue } from '../utils/vaccine/hdcData';
import { formatDateStr, formatDateTimeStr, getBirthDateRangeForQuarter } from '../utils/dateUtils';
import { exportToExcel, exportToPdf } from '../exportUtils';
import { EpiDataTable } from './EpiDataTable';
import { VaccineHistoryModal } from './VaccineHistoryModal';
import { Button } from './ui/button';

export function View1AgeRecords({ age, fiscalYear, quarter, data, isLoading, error, asOfDate }: View1AgeProps & { age: EpiAge }) {
  const { rules, isLoading: rulesLoading, error: rulesError } = useVaccineRules(fiscalYear, `${age}yr`);
  const ageRules = useMemo(() => getAgeView1Rules(rules, age), [rules, age]);
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
      const evaluation = evaluateAgeView1(record, rules, age);
      const warnings = getRecordDateWarnings(record, ageRules);
      const missing = evaluation.missingVaccines.filter(value => !warnings.some(warning => value.includes(warning)));
      const unknown = rulesLoading || rulesError || !rules.length || !!evaluation.unknownVaccines?.length;
      const status = unknown ? 'ข้อมูลไม่พอประเมิน' : missing.length ? 'พบรายการที่ยังไม่ผ่าน' : warnings.length ? 'ตรวจสอบประวัติวัคซีน' : evaluation.pendingVaccines?.length ? 'ยังไม่ถึงเกณฑ์' : 'ครบตามเกณฑ์ที่ประเมิน';
      const details = [...missing, ...(evaluation.pendingVaccines || []), ...(evaluation.unknownVaccines || [])];
      return { ...record, evaluationStatus: status, evaluationDetails: details.join(' · ') };
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
    { header: 'ผลรายชนิด', accessorKey: 'evaluationStatus', cell: ({ row }) => <div><div>{row.original.evaluationStatus}</div><div className="text-xs text-muted-foreground whitespace-normal">{row.original.evaluationDetails}</div></div> },
    { header: 'วัคซีนตามกลุ่มอายุ', id: 'history', cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => setSelected(row.original)}>ดูรายละเอียด</Button> },
  ];
  const filename = `EPI_View1_${age}yr_${fiscalYear}_${quarter}`;
  const exportRows = () => getHdcExportRows(filtered, age).map((row, index) => ({
    ...row, 'ผลรายชนิด': filtered[index].evaluationStatus, 'รายละเอียดผล': filtered[index].evaluationDetails,
    'รายการตามกลุ่มอายุ': getHdcVaccineRows(filtered[index], age).map(dose => `${dose.name}: ${dose.date}${dose.mappingNote ? ` (${dose.mappingNote})` : ''}`).join('\n'),
  }));
  if (isLoading) return <p role="status">กำลังโหลดข้อมูล...</p>;
  if (error) return <p role="alert">{error}</p>;
  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold">วัคซีนรายชนิดสำหรับกลุ่มอายุ {age} ปี</h2>
      <p className="text-sm text-muted-foreground">{AGE_VACCINES[age].length} รายการตามกลุ่มอายุ · รายการนอกแผนแสดงประกอบและไม่นับในความครบถ้วน</p>
      {asOfDate && <p className="text-sm text-muted-foreground">ข้อมูล ณ {formatDateTimeStr(asOfDate)}</p>}
      {rulesError && <p role="alert">โหลดเกณฑ์ไม่สำเร็จ: {rulesError}</p>}
    </div>
    <details className="border rounded-lg p-3">
      <summary className="cursor-pointer font-semibold">รายการและขอบเขตการประเมิน</summary>
      <ul className="list-disc pl-5 mt-3 space-y-1">{AGE_VACCINES[age].map(item => <li key={item.id}>{item.label}{item.mappingNote && <span className="text-muted-foreground"> — {item.mappingNote}</span>}</li>)}</ul>
      <p className="text-sm text-muted-foreground mt-3">ไม่มีคอลัมน์ต้นทางหรือยังไม่ยืนยัน mapping จะแสดง “ข้อมูลไม่พอประเมิน” และไม่นับเป็นขาดวัคซีน ส่วนเซลล์ว่างแสดงว่าไม่มีวันที่ในข้อมูลที่นำเข้า</p>
    </details>
    <div className="flex flex-wrap gap-3">
      <input aria-label="ค้นหารายชื่อ" value={search} onChange={event => setSearch(event.target.value)} placeholder="ชื่อ CID หรือที่อยู่" className="border rounded-md p-2 w-full sm:w-56" />
      <select aria-label="สถานบริการ" value={facility} onChange={event => setFacility(event.target.value)} className="border rounded-md p-2 max-w-full"><option value="">ทุกสถานบริการ</option>{facilities.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select>
      <select aria-label="ผลรายชนิด" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="border rounded-md p-2"><option value="">ทุกผลการประเมิน</option>{['ครบตามเกณฑ์ที่ประเมิน', 'พบรายการที่ยังไม่ผ่าน', 'ตรวจสอบประวัติวัคซีน', 'ยังไม่ถึงเกณฑ์', 'ข้อมูลไม่พอประเมิน'].map(status => <option key={status}>{status}</option>)}</select>
      <Button variant="outline" onClick={() => exportToExcel(exportRows(), filename)}>Excel พร้อมวัคซีนตามอายุ</Button>
      <Button variant="outline" onClick={() => exportToPdf(filtered.map(record => ({ 'สถานบริการ': record.hoscode, 'ชื่อ-สกุล': `${record.name} ${record.lname}`, 'ที่อยู่': hdcValue(record.addr), 'ประเภทพื้นที่': hdcValue(record.check_typearea), 'ผลรายชนิด': record.evaluationStatus, 'รายละเอียด': record.evaluationDetails })), filename, `วัคซีนรายชนิด อายุ ${age} ปี`)}>PDF รายชื่อ</Button>
    </div>
    <p className="text-sm text-muted-foreground">แสดง {filtered.length} จาก {processed.length} คน</p>
    <EpiDataTable data={filtered} columns={columns} />
    <VaccineHistoryModal age={age} record={selected} isOpen={!!selected} onClose={() => setSelected(null)} warnings={selected ? getRecordDateWarnings(selected, ageRules) : []} warningsStatus={rulesLoading ? 'กำลังโหลดเกณฑ์...' : rulesError || undefined} />
  </div>;
}
