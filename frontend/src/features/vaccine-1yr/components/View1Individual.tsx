import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { evaluateView1 } from '../../../shared/utils/vaccine/vaccine-1yr';
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
  quarter: number | 'all';
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

export function View1Individual({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View1Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    // 2. Evaluate 20 criteria
    return cohort.map(record => {
      const evaluation = evaluateView1(record);
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
      size: 200,
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
              ได้รับวัคซีนครบถ้วน (17 รายการ)
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
      const missingStr = evaluateView1(row).missingVaccines.join(', ');
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      
      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ': row.name,
        'นามสกุล': row.lname,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน (17 รายการ)': missingStr.length === 0 ? 'ได้รับวัคซีนครบถ้วน' : `ตกหล่น: ${missingStr}`
      };
    });
    exportToExcel(exportData, `EPI_View1_Tracking_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = filteredData.map(row => {
      const missingStr = evaluateView1(row).missingVaccines.join(', ');
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
    const quarterLabel = quarter === 'all' ? `ภาพรวมทั้งปีงบประมาณ ${fiscalYear}` : `ไตรมาส ${quarter}/${fiscalYear}`;
    const title = `ทะเบียนติดตามเด็กรายบุคคล (ความครอบคลุม 17 รายการ) - ${quarterLabel}`;
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
            ทะเบียนติดตามเด็กรายบุคคล: ความครอบคลุมการได้รับวัคซีนรายชนิด (17 รายการ)
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
            {uniqueFacilities.length === 1 ? (
              <option value="all">{uniqueFacilities[0]}</option>
            ) : (
              <option value="all">ทุกสถานบริการ</option>
            )}
            {uniqueFacilities.length > 1 && uniqueFacilities.map((fac) => {
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
            <option value="passed">ได้รับวัคซีนครบถ้วน (17 รายการ)</option>
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
          <p className="font-semibold mb-1">เกี่ยวกับมุมมองที่ 1 (ความครอบคลุมรายชนิดวัคซีน)</p>
          <p className="mb-2 text-blue-800 leading-relaxed">
            มุมมองนี้แสดงประวัติการได้รับวัคซีนแบบ <strong>แยกตามชนิดและเข็ม (รวม 17 รายการ)</strong> 
            เพื่อสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ในการ <strong>ติดตามเด็กที่ได้รับวัคซีนไม่ครบถ้วน</strong> ได้อย่างแม่นยำ 
            (หมายเหตุ: เด็ก 1 รายอาจขาดวัคซีนบางรายการในมุมมองนี้ แต่ยังคงผ่านเกณฑ์ตัวชี้วัด Fully Immunized ในภาพรวมได้เนื่องจากเงื่อนไขการประเมินที่ต่างกัน)
          </p>
          <div className="bg-white/70 p-4 rounded-lg border border-blue-100/50 mt-3 text-xs shadow-sm">
            <p className="font-semibold mb-3 text-blue-900 border-b border-blue-100 pb-2">
              คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 1 ปี
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-blue-800">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">BCG (ป้องกันวัณโรค)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>BCG</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">011</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">HBV (ไวรัสตับอักเสบบี)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>HBV เข็ม 1-4</strong> ตามช่วงอายุ (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">041, 042, 043, 044</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">DTP (คอตีบ บาดทะยัก ไอกรน)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 1-3</strong> หรือ <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">031, 032, 033</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">Hib (ฮิบ)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">H11, H12, H13</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">OPV (โปลิโอชนิดหยอด)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">081, 082, 083</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">IPV (โปลิโอชนิดฉีด)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>IPV เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">091, 092</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">MMR (หัด หัดเยอรมัน คางทูม)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 1</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">061</code>)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">Rota (ไวรัสโรต้า)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>Rota เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">R11, R12, R13</code> หรือ R21-R31)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-blue-900">PCV (นิวโมค็อกคัส)</span>
                <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>PCV เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">P11, P12, P13</code>)</span>
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
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 1 (เด็ก 1 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: เราสามารถใช้ประโยชน์จากหน้านี้ได้ยังไงบ้างครับ?</p>
            <p className="text-blue-800">
              <strong className="text-zinc-800">A:</strong> แม้ว่าเกณฑ์ Fully Immunized (มุมมองที่ 2) จะไม่บังคับใช้ <strong>HBV เข็มที่ 3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-blue-800">043</code>) ในการประเมิน แต่ในหน้านี้ซึ่งเป็นการตรวจสอบความสมบูรณ์ของการบันทึกข้อมูล 20 รายการ จะมีการแจ้งเตือนเสมอหากไม่มีข้อมูล <strong>เพื่อเตือนให้เจ้าหน้าที่ทราบว่าอาจลืมบันทึกรหัสวัคซีนรวมในระบบ HIS</strong>
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: วัคซีนโรต้า (Rota) ลงข้อมูลอย่างไรให้ผ่านเกณฑ์?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> วัคซีนโรต้าใน HDC มีการแยกชนิด 2 เข็มและ 3 เข็ม ขึ้นอยู่กับบริบทของสถานบริการ เจ้าหน้าที่จะต้องบันทึกรหัสให้ถูกต้องตามชนิดวัคซีนที่ให้ครับ เช่น แบบ 2 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">R11, R12</code> หรือ <code>R21, R22</code>) หรือแบบ 3 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">R31, R32, R33</code>) ระบบจะถือว่าข้อมูลสมบูรณ์ทันทีหากพบว่าได้รับครบ 2 เข็มแรก หรือครบ 3 เข็ม อย่างใดอย่างหนึ่งครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: วัคซีนโปลิโอหยอด (OPV) ลงข้อมูลอย่างไรให้ถูกต้อง?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> สำหรับวัคซีน OPV ที่อายุ 6 เดือน รูปแบบการส่งออกของ HDC จะประเมินจาก <strong>OPV เข็มที่ 3 (อายุ 6 เดือน)</strong> ซึ่งตรงกับรหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">083</code> ดังนั้นหากเด็กได้รับ OPV ครบแล้วแต่ระบบยังแจ้งว่าขาด ให้ตรวจสอบว่าการคีย์ข้อมูลรหัส 083 ในระบบ HIS ถูกผูกรหัสตรงตามมาตรฐานส่งออกของ HDC หรือไม่ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: วัคซีนโปลิโอฉีด (IPV) ระบบตรวจสอบอย่างไร?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> ระบบจะตรวจสอบการได้รับ IPV จำนวน 2 เข็ม คือ <strong>IPV 2 เดือน</strong> (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">091</code>) และ <strong>IPV 4 เดือน</strong> (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">092</code>) หากเจ้าหน้าที่ลืมลงบันทึกรหัสใดรหัสหนึ่ง ระบบจะฟ้องว่าตกหล่น เพื่อให้กลับไปบันทึกข้อมูลย้อนหลังให้ครบถ้วนครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: กรณีวัคซีนพื้นฐาน (เช่น BCG, DTP) ฟ้องว่าขาด ทั้งที่มั่นใจว่าฉีดแล้ว ต้องทำอย่างไร?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> วัคซีนพื้นฐานส่วนใหญ่มีเงื่อนไขตรงไปตรงมา คือ "ฉีด 1 เข็ม = ลงบันทึก 1 รหัส" (เช่น BCG รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">011</code>) หากระบบแจ้งว่าขาด มักเกิดจาก <strong>ลืมบันทึกรหัสวัคซีนในวันรับบริการ</strong> หรือ <strong>รหัสวัคซีนใน HIS ไม่ได้ผูกกับรหัสมาตรฐาน 43 แฟ้มของ HDC</strong> เจ้าหน้าที่สามารถนำรายชื่อเด็กไปตรวจสอบและคีย์ข้อมูลรหัสที่ถูกต้องเพิ่มเติมใน HIS ได้ทันทีครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมมุมมองที่ 1 ถึงมีรายการวัคซีน PCV (นิวโมค็อกคัส) แจ้งเตือนด้วย ทั้งๆ ที่เป็นวัคซีนนอกแผน?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> สาเหตุที่ต้องมีรายการ PCV รวมอยู่ด้วย เป็นเพราะระบบอิงตาม <strong>มาตรฐานรายงาน HDC ของกระทรวงสาธารณสุขโดยตรง</strong> ครับ (ในคู่มือ HDC ระบุ PCV เป็นรายการที่ 18-20) ซึ่งกระทรวงฯ ต้องการเก็บข้อมูลเชิงสถิติของวัคซีนทางเลือกในภาพรวมของประเทศ 
              หากหน่วยบริการของเราไม่มีวัคซีนตัวนี้ หรือผู้ปกครองไม่ได้พาน้องไปฉีดที่อื่น <strong>สามารถปล่อยผ่านได้เลยครับ</strong> จะไม่มีผลกระทบต่อผลการประเมิน Fully Immunized (มุมมองที่ 2) แต่อย่างใด
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมเด็กบางคน "ไม่ผ่าน" ในมุมมองที่ 1 (ขาดวัคซีนบางตัว) แต่กลับ "ผ่าน" ในมุมมองที่ 2 (Fully Immunized)?</p>
            <div className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> เพราะ 2 มุมมองนี้ใช้ <strong>เกณฑ์การประเมินที่ต่างกันครับ</strong>:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><strong>มุมมองที่ 1:</strong> เป็นการตรวจสอบ "ความสมบูรณ์ของการบันทึกข้อมูลแบบรายเข็ม" (เข้มงวด 17 รายการ) เช็คแม้กระทั่ง HBV เข็ม 3 (PCV ไม่นำมารวมแล้ว)</li>
                <li><strong>มุมมองที่ 2 (Fully Immunized):</strong> ประเมินเฉพาะ "วัคซีนพื้นฐาน 8 หมวด" ตามเกณฑ์ชี้วัดหลักระดับประเทศ หากได้วัคซีนหลักครบ ก็ถือว่าเด็กมีภูมิคุ้มกันที่เพียงพอและผ่านเกณฑ์ครับ</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

