import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EpiRecord } from '../types';
import { EpiDataTable } from './EpiDataTable';
import { VaccineHistoryModal } from './VaccineHistoryModal';
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

export function HdcRecordsView({ age, fiscalYear, quarter, data, isLoading, error, asOfDate }: HdcRecordsViewProps) {
  const [facility, setFacility] = useState('');
  const [result, setResult] = useState('');
  const [search, setSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const cohort = useMemo(() => {
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, age);
    return data.filter(record => {
      const birth = new Date(record.birth);
      return birth >= start && birth <= end;
    });
  }, [data, fiscalYear, quarter, age]);
  const facilities = useMemo(() => [...new Map(cohort.map(record => [record.hoscode, record.hosname])).entries()].sort(), [cohort]);
  const results = useMemo(() => [...new Set(cohort.map(record => hdcValue(record.result)))].sort(), [cohort]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return cohort.filter(record =>
      (!facility || record.hoscode === facility) &&
      (!result || hdcValue(record.result) === result) &&
      (!query || `${record.cid} ${record.pid} ${record.name} ${record.lname}`.toLocaleLowerCase().includes(query)),
    );
  }, [cohort, facility, result, search]);
  const columns = useMemo<ColumnDef<EpiRecord>[]>(() => [
    { header: 'สถานบริการ', accessorKey: 'hoscode', cell: ({ row }) => <div><div>{row.original.hoscode}</div><div className="text-xs text-zinc-500">{row.original.hosname}</div></div> },
    { header: 'CID', accessorKey: 'cid' },
    { header: 'ชื่อ-สกุล', accessorFn: record => `${record.name} ${record.lname}` },
    { header: 'วันเกิด', accessorKey: 'birth', cell: ({ row }) => <div>{formatDateStr(row.original.birth)}<div className="text-xs text-zinc-500">(อายุ {formatAgeStr(row.original.birth)})</div></div> },
    { header: 'ผลจาก HDC', accessorFn: record => hdcValue(record.result), cell: info => <span className="whitespace-pre-wrap">{info.getValue<string>()}</span> },
    { header: 'ประวัติวัคซีน', id: 'history', cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => setSelectedPatient(row.original)}>ดูประวัติ</Button> },
  ], []);

  if (isLoading) return <p role="status" className="py-12 text-center">กำลังโหลดข้อมูล HDC...</p>;
  if (error) return <p role="alert" className="py-12 text-center text-red-700">{error}</p>;
  const filename = `HDC_${age}yr_${fiscalYear}_${quarter}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">รายชื่อเด็กอายุครบ {age} ปี</h2>
        <p className="text-sm text-zinc-500">แสดงผลจาก HDC ที่นำเข้า เปิดประวัติเพื่อดูวันที่วัคซีนแต่ละเข็ม</p>
        {asOfDate && <p className="text-xs text-zinc-500 mt-1">ข้อมูล ณ วันที่ {formatDateTimeStr(asOfDate)}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        <input aria-label="ค้นหาชื่อหรือ CID" placeholder="ค้นหาชื่อหรือ CID" value={search} onChange={event => setSearch(event.target.value)} className="border rounded-lg px-3 py-2 text-sm w-full sm:w-56" />
        <select aria-label="สถานบริการ" value={facility} onChange={event => setFacility(event.target.value)} className="border rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="">ทุกสถานบริการ</option>
          {facilities.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
        </select>
        <select aria-label="ผลจาก HDC" value={result} onChange={event => setResult(event.target.value)} className="border rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="">ผลจาก HDC ทั้งหมด</option>
          {results.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <Button variant="outline" onClick={() => exportToExcel(getHdcExportRows(filtered), filename, 'HDC')}>Excel พร้อมข้อมูลวัคซีน</Button>
        <Button variant="outline" onClick={() => exportToPdf(filtered.map(record => ({
          'สถานบริการ': `${record.hoscode} ${record.hosname}`,
          'CID': record.cid,
          'ชื่อ-สกุล': `${record.name} ${record.lname}`,
          'วันเกิด': formatDateStr(record.birth),
          'ผลจาก HDC': hdcValue(record.result),
        })), filename, `รายชื่อเด็กอายุครบ ${age} ปี — ข้อมูลจาก HDC`)}>PDF รายชื่อ</Button>
      </div>
      <p className="text-sm text-zinc-500">แสดง {filtered.length.toLocaleString()} จาก {cohort.length.toLocaleString()} คน</p>
      <EpiDataTable data={filtered} columns={columns} />
      <VaccineHistoryModal isOpen={!!selectedPatient} record={selectedPatient} onClose={() => setSelectedPatient(null)} />
    </div>
  );
}
