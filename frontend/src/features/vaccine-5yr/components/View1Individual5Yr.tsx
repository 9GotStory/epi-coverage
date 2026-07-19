import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { evaluateView1_5Yr } from '../../../shared/utils/vaccine/vaccine-5yr';
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

type ProcessedView1Record = EpiRecord & {
  missingVaccines: string[];
  isPassedAll: boolean;
};

interface View1Props {
  fiscalYear: number;
  quarter: number;
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

export function View1Individual5Yr({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View1Props) {
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

    // 2. Evaluate criteria for 2-year cohort (1 parameter)
    return cohort.map(record => {
      const evaluation = evaluateView1_5Yr(record);
      return {
        ...record,
        missingVaccines: evaluation.missingVaccines,
        isPassedAll: evaluation.missingVaccines.length === 0
      };
    });
  }, [data, fiscalYear, quarter]);

  const filteredData = useMemo(() => {
    return processedData.filter((row) => {
      // 1. Facility filter
      if (filterFacility !== 'all' && row.hoscode !== filterFacility) return false;
      // 2. Status filter
      if (filterStatus === 'passed' && !row.isPassedAll) return false;
      if (filterStatus === 'failed' && row.isPassedAll) return false;
      return true;
    });
  }, [processedData, filterFacility, filterStatus]);

  const uniqueFacilities = useMemo(() => {
    const facilities = new Set(processedData.map(d => `${d.hoscode} - ${d.hosname}`));
    return Array.from(facilities).sort();
  }, [processedData]);

  // Statistics

  const columns = useMemo<ColumnDef<ProcessedView1Record, any>[]>(() => [
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
      header: 'ผลการประเมินรายชนิด',
      id: 'status',
      size: 500,
      cell: ({ row }) => {
        if (row.original.isPassedAll) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              ได้รับวัคซีนครบถ้วน (2 รายการ)
            </span>
          );
        }
        return (
          <div className="flex flex-col gap-1 items-start">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
              ไม่ผ่านเกณฑ์ (ตกหล่น)
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {row.original.missingVaccines.map((v, i) => (
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
        <p className="mt-4 text-zinc-500">กำลังประมวลผลข้อมูลรายบุคคล...</p>
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
      const missingStr = evaluateView1_5Yr(row).missingVaccines.join(', ');
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      
      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ': row.name,
        'นามสกุล': row.lname,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน (2 รายการ)': missingStr.length === 0 ? 'ได้รับวัคซีนครบถ้วน' : `ตกหล่น: ${missingStr}`
      };
    });
    exportToExcel(exportData, `EPI_View1_Tracking_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = filteredData.map(row => {
      const missingStr = evaluateView1_5Yr(row).missingVaccines.join(', ');
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      
      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ-สกุล': `${row.name} ${row.lname}`,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน': missingStr.length === 0 ? 'ครบถ้วน' : `ตกหล่น: ${missingStr}`
      };
    });
    const title = `ทะเบียนติดตามเด็กรายบุคคล เด็ก 5 ปี (ความครอบคลุม 2 รายการ) - ไตรมาส ${quarter}/${fiscalYear}`;
    exportToPdf(exportData, `EPI_View1_Tracking_${new Date().getTime()}`, title);
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
            ทะเบียนติดตามเด็กรายบุคคล (เด็กอายุ 5 ปี): ความครอบคลุมการได้รับวัคซีนรายชนิด (2 รายการ)
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
            <option value="all">สถานะการรับวัคซีนทั้งหมด</option>
            <option value="passed">ได้รับวัคซีนครบถ้วน (2 รายการ)</option>
            <option value="failed">ยังได้รับวัคซีนไม่ครบถ้วน (ตกหล่น)</option>
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



      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 flex gap-3 text-sm text-blue-900">
        <InfoIcon className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">เกี่ยวกับมุมมองที่ 1 (ความครอบคลุมวัคซีนเข็มกระตุ้น สำหรับเด็ก 5 ปี)</p>
          <p className="mb-2 text-blue-800 leading-relaxed">
            มุมมองนี้แสดงประวัติการได้รับวัคซีนแบบ <strong>แยกตามชนิดและเข็ม (รวม 2 รายการ)</strong> 
            เพื่อสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ในการ <strong>ติดตามเด็ก 5 ปีที่ได้รับวัคซีนเข็มกระตุ้นไม่ครบถ้วน</strong> ได้อย่างแม่นยำ 
          </p>
          <div className="bg-white/70 p-4 rounded-lg border border-blue-100/50 mt-3 text-xs shadow-sm">
            <p className="font-semibold mb-3 text-blue-900 border-b border-blue-100 pb-2">
              คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 5 ปี
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-blue-800">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">DTP (คอตีบ บาดทะยัก ไอกรน) เข็มกระตุ้น 4 ปี</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 5</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">035</code> หรือ <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">D35, D45, D55, T11</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">OPV (โปลิโอชนิดหยอด) เข็มกระตุ้น 4 ปี</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV เข็ม 5 (ครั้งที่ 3)</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">085</code> หรือ <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">D35, D45, D55, I15</code>)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <EpiDataTable data={filteredData} columns={columns} />
      
      {/* FAQ & Explanation Note */}
      <div className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm mt-8">
        <h3 className="text-blue-800 font-bold text-base mb-3 flex items-center gap-2">
          <InfoIcon className="w-5 h-5" />
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 1 (เด็กอายุ 5 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: มุมมองที่ 1 ของเด็ก 5 ปี แตกต่างจากช่วงอายุอื่นอย่างไร?</p>
            <p className="text-blue-800">
              <strong className="text-blue-900">A:</strong> สำหรับเด็กอายุ 5 ปีบริบูรณ์ (ก่อนเข้าเรียน) ระบบจะโฟกัสที่ <strong>วัคซีนเข็มกระตุ้นช่วงอายุ 4 ปี</strong> เป็นหลักครับ 
              ได้แก่ DTP เข็มที่ 5 (คอตีบ-บาดทะยัก-ไอกรน) และ OPV เข็มที่ 5 หรือ ครั้งที่ 3 (โปลิโอหยอด) ซึ่งเป็นเกณฑ์ชี้วัดสำคัญของช่วงวัยนี้ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมรายการวัคซีนถึงมีแค่ DTP5 และ OPV5 หายไปไหนหมด?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> ในรายงานมุมมองที่ 1 จะแสดงเฉพาะ <strong>"วัคซีนเป้าหมาย"</strong> ประจำช่วงอายุนั้นๆ ครับ 
              ส่วนวัคซีนอื่นๆ ที่เคยได้รับมาตั้งแต่แรกเกิด (เช่น BCG, ตับอักเสบบี, หัด, โรต้า, สมองอักเสบเจอี) จะถูกนำไปคำนวณรวมกันใน <strong>มุมมองที่ 2 (Fully Immunized)</strong> แทนครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: เด็กได้รับวัคซีนตอน 4 ขวบแล้ว แต่ใน HDC ยังฟ้องว่าตกหล่น เกิดจากสาเหตุอะไรได้บ้าง?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> มักจะเจอบ่อยๆ จากการคีย์รหัสผิดในระบบ HIS ครับ เช่น:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>จ่ายวัคซีน DTP เข็มที่ 5 ให้เด็กแล้ว แต่ในโปรแกรมไปเลือกรหัสของเข็มที่ 4 (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">034</code>) แทนที่จะเป็นเข็มที่ 5 (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">035, T11</code>)</li>
                <li>หรือให้ OPV หยอดแล้ว แต่ในโปรแกรมไปเลือกรหัสของเข็มที่ 4 (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">084</code>) แทนที่จะเป็น OPV เข็ม 5 (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">085, I15</code>)</li>
              </ul>
              ให้ลองตรวจสอบการลงรหัสวัคซีนในวันรับบริการ (Visit) ของเด็กรายนั้นอีกครั้ง แล้วปรับแก้รหัส 43 แฟ้มให้ถูกต้องครับ
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
