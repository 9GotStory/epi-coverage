import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { evaluateView2_5Yr } from '../utils/vaccineLogic5Yr';
import type { VaccineStatus } from '../../../shared/types';
import { formatDateTimeStr, getBirthDateRangeForQuarter, getAgeInMonths } from '../../../shared/utils/dateUtils';
import type { EpiRecord } from '../../../shared/types';
import { EpiDataTable } from '../../../shared/components/EpiDataTable';
import { exportToExcel, exportToPdf } from '../../../shared/exportUtils';

// Helper for abbreviation
function shortenFacilityName(name: string) {
  if (!name) return name;
  return name
    .replace(/สำนักงานสาธารณสุขอำเภอ/g, 'สสอ.')
    .replace(/โรงพยาบาลส่งเสริมสุขภาพตำบล/g, 'รพ.สต.')
    .replace(/โรงพยาบาล/g, 'รพ.')
    .replace(/ศูนย์สุขภาพชุมชน/g, 'สสช.')
    .replace(/สถานบริการสาธารณสุขชุมชน/g, 'สสช.')
    .replace(/สถานีอนามัยเฉลิมพระเกียรติฯ/g, 'สอน.')
    .replace(/สถานีอนามัย/g, 'สอ.');
}

type ProcessedFullyImmunizedRecord = EpiRecord & {
  evaluation: VaccineStatus;
};

interface View2Props {
  fiscalYear: number;
  quarter: number;
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

export function View2FullyImmunized5Yr({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View2Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, 5);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    // 2. Evaluate criteria for fully immunized 2 years
    return cohort.map(record => ({
      ...record,
      evaluation: evaluateView2_5Yr(record),
    }));
  }, [data, fiscalYear, quarter]);

  const filteredData = useMemo(() => {
    return processedData.filter((row) => {
      // 1. Facility filter
      if (filterFacility !== 'all' && row.hoscode !== filterFacility) return false;
      // 2. Status filter
      if (filterStatus === 'passed' && !row.evaluation.isFullyImmunized) return false;
      if (filterStatus === 'failed' && row.evaluation.isFullyImmunized) return false;
      return true;
    });
  }, [processedData, filterFacility, filterStatus]);

  const uniqueFacilities = useMemo(() => {
    const facilities = new Set(processedData.map(d => `${d.hoscode} - ${d.hosname}`));
    return Array.from(facilities).sort();
  }, [processedData]);

  // Statistics
  const total = filteredData.length;
  const passed = filteredData.filter(d => d.evaluation.isFullyImmunized).length;
  const failed = total - passed;
  const coverageRate = total > 0 ? ((passed / total) * 100).toFixed(2) : '0.00';

  const columns = useMemo<ColumnDef<ProcessedFullyImmunizedRecord, any>[]>(() => [
    {
      header: 'สถานบริการ',
      id: 'facility',
      size: 180,
      cell: ({ row }) => {
        const shortName = shortenFacilityName(row.original.hosname);
        return (
          <div className="flex flex-col">
            <span className="font-medium text-zinc-900">{row.original.hoscode}</span>
            <span className="text-zinc-500 text-[11px] truncate max-w-[140px]" title={row.original.hosname}>
              {shortName}
            </span>
          </div>
        );
      },
    },
    {
      header: 'CID',
      accessorKey: 'cid',
      size: 140,
    },
    {
      header: 'ชื่อ-สกุล',
      accessorFn: row => `${row.name} ${row.lname}`,
      cell: info => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      header: 'วันเกิด',
      accessorKey: 'birth',
      size: 120,
      cell: info => {
        const d = new Date(info.getValue() as string);
        return <span className="text-zinc-600">{d.toLocaleDateString('th-TH')}</span>;
      },
    },
    {
      header: 'ผลการประเมิน Fully Immunized',
      id: 'status',
      size: 500,
      cell: ({ row }) => {
        const evaluation = row.original.evaluation;
        if (evaluation.isFullyImmunized) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              ผ่านเกณฑ์
            </span>
          );
        }
        return (
          <div className="flex flex-col gap-1 items-start">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
              ไม่ผ่านเกณฑ์ (ตกหล่น)
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {evaluation.missingVaccines.map((v, i) => (
                <span key={i} className="inline-flex px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium border border-red-100 shadow-sm">
                  {v}
                </span>
              ))}
            </div>
          </div>
        );
      },
    }
  ], []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-zinc-500">กำลังประมวลผลข้อมูล Fully Immunized...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">
        <h3 className="font-semibold">เกิดข้อผิดพลาดในการโหลดข้อมูล</h3>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  // Handle Export
  const handleExportExcel = () => {
    const exportData = filteredData.map(row => {
      const missingStr = row.evaluation.missingVaccines.join(', ');
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ': row.name,
        'นามสกุล': row.lname,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน (Fully Immunized)': row.evaluation.isFullyImmunized ? 'ผ่านเกณฑ์' : `ตกหล่น: ${missingStr}`
      };
    });
    exportToExcel(exportData, `EPI_View2_FullyImmunized5Yr_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = filteredData.map(row => {
      const missingStr = row.evaluation.missingVaccines.join(', ');
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ-สกุล': `${row.name} ${row.lname}`,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน': row.evaluation.isFullyImmunized ? 'ผ่านเกณฑ์' : `ตกหล่น: ${missingStr}`
      };
    });
    const title = `ทะเบียนเด็กความครบถ้วนของวัคซีน (Fully Immunized 5 ปี) - ไตรมาส ${quarter}/${fiscalYear}`;
    exportToPdf(exportData, `EPI_View2_FullyImmunized5Yr_${new Date().getTime()}`, title);
  };

  const asOfDateText = asOfDate
    ? formatDateTimeStr(asOfDate)
    : 'ไม่มีข้อมูลรอบอัปโหลด';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">
            ทะเบียนเด็กความครบถ้วนของวัคซีน (Fully Immunized เด็กอายุ 5 ปี)
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            ข้อมูลอัปเดตล่าสุด: <span className="font-medium text-blue-600">{asOfDateText}</span>
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <select 
            value={filterFacility} 
            onChange={(e) => setFilterFacility(e.target.value)}
            className="px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="all">ทุกสถานบริการ</option>
            {uniqueFacilities.map((fac) => {
              const code = fac.split(' - ')[0];
              return <option key={code} value={code}>{fac}</option>;
            })}
          </select>
          
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="all">ผลการประเมินทั้งหมด</option>
            <option value="passed">ผ่านเกณฑ์ (Fully Immunized)</option>
            <option value="failed">ยังไม่ผ่านเกณฑ์ (ตกหล่น)</option>
          </select>

          {/* Export Buttons */}
          <div className="flex bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
            <button 
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors border-r border-zinc-200 focus:outline-none"
              title="Export to Excel"
            >
              <FileSpreadsheetIcon className="w-4 h-4" />
              <span className="hidden md:inline font-medium">Excel</span>
            </button>
            <button 
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors focus:outline-none"
              title="Export to PDF"
            >
              <FileTextIcon className="w-4 h-4" />
              <span className="hidden md:inline font-medium">PDF</span>
            </button>
          </div>
        </div>
      </div>



      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex gap-3 text-sm text-indigo-900">
        <InfoIcon className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">เกี่ยวกับมุมมองที่ 2 (Fully Immunized เด็กอายุ 5 ปี)</p>
          <p className="mb-2 text-indigo-800 leading-relaxed">
            มุมมองนี้แสดงผลการประเมิน <strong>ภาพรวมการได้รับวัคซีนของเด็กรายบุคคล</strong> ตามเกณฑ์ตัวชี้วัดความครอบคลุม (Fully Immunized) 
            การประเมินผลจะใช้เงื่อนไขแบบองค์รวม (Strict AND Condition) หากขาดวัคซีนในหมวดใดหมวดหนึ่ง จะถือว่า <strong>"ไม่ผ่านเกณฑ์"</strong> ทันที
          </p>
          <div className="bg-white/60 p-4 rounded-lg border border-indigo-100/50 text-xs">
            <p className="font-semibold mb-3 text-indigo-900 border-b border-indigo-100 pb-2">
              คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 5 ปี
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-indigo-800">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">BCG (ป้องกันวัณโรค) - 1 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>BCG</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">011</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">HBV (ไวรัสตับอักเสบบี) - ครบ 3 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>HBV เข็ม 1-3</strong> (แรกเกิด, 2 ด., 6 ด.) (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">041, 042, 043</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">DTP (คอตีบ บาดทะยัก ไอกรน) - ครบ 5 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 1-5</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">031, 032, 033, 034, 035</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">Hib (ฮิบ) - ครบ 3 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">H11, H12, H13</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">IPV (โปลิโอชนิดฉีด) - ครบ 2 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>IPV เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">091, 092</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">OPV (โปลิโอชนิดหยอด) - ครบ 3 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV ครั้งที่ 1-3 ตามเกณฑ์ใหม่</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">083, 084, 085</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">MMR (หัด หัดเยอรมัน คางทูม) - ครบ 2 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">061, 073</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">Rota (ไวรัสโรต้า) - ครบ 2 หรือ 3 เข็ม</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>Rota เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">R11, R12, R13</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-indigo-900">LAJE / JE (ไข้สมองอักเสบเจอี) - ครบตามเกณฑ์</span>
                <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>LAJE เข็ม 1-2</strong> หรือ <strong>JE เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">J11, J12</code> หรือ <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">051, 052, 053</code>)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-zinc-500">จำนวนเด็กทั้งหมด (คน)</span>
          <span className="text-2xl font-bold text-zinc-900 mt-1">{total.toLocaleString()}</span>
        </div>
        <div className="bg-green-50 p-4 rounded-xl border border-green-100 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-green-700">จำนวนเด็กที่ผ่านเกณฑ์ (คน)</span>
          <span className="text-2xl font-bold text-green-800 mt-1">{passed.toLocaleString()}</span>
        </div>
        <div className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-red-700">จำนวนเด็กที่ไม่ผ่านเกณฑ์ (คน)</span>
          <span className="text-2xl font-bold text-red-800 mt-1">{failed.toLocaleString()}</span>
        </div>
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-blue-700">ร้อยละความครอบคลุม</span>
          <span className="text-2xl font-bold text-blue-800 mt-1">{coverageRate} <span className="text-sm font-normal text-blue-600">%</span></span>
        </div>
      </div>

      <EpiDataTable data={filteredData} columns={columns} />
      
      {/* FAQ & Explanation Note */}
      <div className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm mt-8">
        <h3 className="text-blue-800 font-bold text-base mb-3 flex items-center gap-2">
          <InfoIcon className="w-5 h-5" />
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 2 (เด็กอายุ 5 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: มุมมอง Fully Immunized ของเด็กอายุ 5 ปี ประเมินอะไรบ้างครับ?</p>
            <p className="text-blue-800">
              <strong className="text-blue-900">A:</strong> สำหรับเด็กอายุ 5 ปี (ก่อนเข้าเรียน) ระบบจะ <strong>ประเมินวัคซีนสะสมทั้งหมดตั้งแต่แรกเกิดจนถึงปัจจุบัน รวม 9 หมวดครับ</strong> 
              ได้แก่ วัคซีนป้องกันวัณโรค (BCG), ตับอักเสบบี (HBV 3 เข็ม), คอตีบ-บาดทะยัก-ไอกรน (DTP 5 เข็ม), ฮิบ (Hib 3 เข็ม), โปลิโอแบบหยอด (OPV 3 เข็ม ตามเกณฑ์ใหม่), โปลิโอแบบฉีด (IPV 2 เข็ม), หัด-หัดเยอรมัน-คางทูม (MMR 2 เข็ม), ไวรัสโรต้า (Rota), และไข้สมองอักเสบเจอี (LAJE 2 เข็ม หรือ JE 3 เข็ม) ถ้าขาดเข็มใดเข็มหนึ่งไป จะถือว่ายังไม่ได้รับวัคซีนครบถ้วน (ไม่ผ่านเกณฑ์ Fully Immunized) ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมเด็กบางคนฉีดครบแล้ว แต่มาตกหล่นที่ "วัคซีนโรต้า" หรือ "วัคซีนเจอี"?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> ปัญหานี้พบบ่อยมากครับ เกิดจาก HDC มีระบบตรวจสอบความสมเหตุสมผลของข้อมูล (Data Validation) เช่น 
              <strong> วันที่รับวัคซีนของเข็มที่ 1 และเข็มที่ 2 ลงเป็นวันเดียวกัน</strong> ระบบจะตัดข้อมูลทิ้งทันทีเพราะถือว่าผิดปกติทางคลินิก 
              หรือกรณี <strong>วัคซีนเจอี</strong> หากคลินิก/รพ.เอกชนฉีดเป็นชนิดเชื้อตาย (JE) จะต้องคีย์ให้ครบ 3 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">051, 052, 053</code>) แต่ถ้าเป็นชนิดเชื้อเป็น (LAJE) ตามที่รัฐจัดสรร จะใช้แค่ 2 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">J11, J12</code>) หากคีย์รหัสสลับกันระบบจะมองว่าได้รับวัคซีนผิดประเภทและประเมินว่าไม่ผ่านเกณฑ์ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ถ้าพบว่าเด็กตกหล่นวัคซีนในอดีต หรือวัคซีนตอน 4 ขวบ (เช่น ขาด DTP เข็ม 5 หรือ OPV เข็ม 3) เจ้าหน้าที่ต้องทำยังไงครับ?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> พี่ๆ เจ้าหน้าที่สามารถเชิญผู้ปกครองให้นำสมุดสีชมพู (สมุดบันทึกสุขภาพแม่และเด็ก) มาตรวจสอบที่สถานบริการได้เลยครับ 
              หากพบว่าเด็กเคยไปรับบริการที่อื่นแล้วแต่ข้อมูลไม่ลิงก์เข้ามาระบบ สามารถใช้สมุดสีชมพูเป็นหลักฐานในการ <strong>คีย์ประวัติวัคซีนย้อนหลัง (Historical Data)</strong> ลงในระบบ HIS ของหน่วยบริการได้ทันที ข้อมูลก็จะถูกส่งออกไปยัง HDC ในรอบถัดไปครับ
            </p>
          </div>
          
        </div>
      </div>
    </div>
  );
}
