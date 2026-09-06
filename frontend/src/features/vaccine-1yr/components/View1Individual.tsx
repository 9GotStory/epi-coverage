import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { evaluateDynamicV1, getDataErrors } from '../../../shared/utils/vaccine/ruleEngine';
import { formatDateTimeStr, getBirthDateRangeForQuarter, formatAgeStr } from '../../../shared/utils/dateUtils';
import type { EpiRecord } from '../../../shared/types';
import { EpiDataTable } from '../../../shared/components/EpiDataTable';
import { exportToExcel, exportToPdf } from '../../../shared/exportUtils';
import { useVaccineRules } from '../../../shared/hooks/useVaccineRules';
import { DynamicVaccineGuide } from '../../../shared/components/DynamicVaccineGuide';
import { VaccineHistoryModal } from '../../../shared/components/VaccineHistoryModal';
import { Search } from 'lucide-react';

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
  pendingVaccines: string[];
  dataErrors?: string[];
  status: 'PASS' | 'FAIL' | 'PENDING';
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
  
  // Modal state
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { rules } = useVaccineRules(fiscalYear, '1yr');
  const v1RulesCount = rules.filter(r => r.view_type === 1 && r.is_active).length;
  const v2RulesCount = rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2).length;

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    const evalFn = (r: EpiRecord) => evaluateDynamicV1(r, rules);

    return cohort.map(record => {
      const evaluation = evalFn(record);
      const pending = evaluation.pendingVaccines || [];
      const missing = evaluation.missingVaccines || [];
      let status: 'PASS' | 'FAIL' | 'PENDING' = 'PASS';
      if (missing.length > 0) status = 'FAIL';
      else if (pending.length > 0) status = 'PENDING';
      

      
      const v1Rules = rules.filter(r => r.view_type === 1 && r.is_active);
      const dataErrors = getDataErrors(record, v1Rules);
      
      return {
        ...record,
        missingVaccines: missing,
        pendingVaccines: pending,
        dataErrors,
        status: status
      };
    });
  }, [data, fiscalYear, quarter, rules]);

  const filteredData = useMemo(() => {
    return processedData.filter((row) => {
      // 1. Facility filter
      if (filterFacility !== 'all' && row.hoscode !== filterFacility) return false;
      // 2. Status filter
      if (filterStatus === 'passed' && row.status !== 'PASS') return false;
      if (filterStatus === 'pending' && row.status !== 'PENDING') return false;
      if (filterStatus === 'failed' && row.status !== 'FAIL') return false;
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
        const val = info.getValue() as string;
        if (!val) return <span className="text-zinc-400">-</span>;
        const d = new Date(val);
        const ageStr = formatAgeStr(val);
          
        return (
          <div className="flex flex-col">
            <span className="text-zinc-700">{d.toLocaleDateString('th-TH')}</span>
            <span className="text-[10px] text-zinc-500">(อายุ {ageStr})</span>
          </div>
        );
      },
    },
    {
      header: 'ผลการประเมินรายชนิด',
      id: 'status',
      size: 500,
      cell: ({ row }) => {
        const { status, missingVaccines, pendingVaccines, dataErrors = [] } = row.original;
        
        // Filter missing and pending to NOT include dataErrors
        const pureMissing = missingVaccines.filter(v => !dataErrors.includes(v));
        const purePending = pendingVaccines.filter(v => !dataErrors.includes(v));

        return (
          <div className="flex flex-col gap-1 items-start">
            {/* Main Status Pill */}
            {status === 'PASS' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#e3f4e1] text-[#1e7e26]">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ได้รับวัคซีนครบถ้วน ({v1RulesCount} รายการ)
              </span>
            ) : status === 'FAIL' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#ffe2e5] text-[#d91f2a]">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                ไม่ผ่านเกณฑ์ (ตกหล่น)
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#fff0d6] text-[#b06100]">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ยังไม่ถึงเกณฑ์
              </span>
            )}
            
            {/* Badges Container */}
            {(dataErrors.length > 0 || pureMissing.length > 0 || purePending.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {/* 1. Data Errors (Orange) */}
                {dataErrors.map((v, i) => (
                  <span key={`err-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe8d6] text-[#c95d00]" title="ข้อมูลวันที่ผิดปกติ (เช่น ก่อนวันเกิด หรือคีย์ซ้ำซ้อน)">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {v} (ข้อมูลวันที่ผิด)
                  </span>
                ))}
                
                {/* 2. Pure Missing (Red) */}
                {pureMissing.map((v, i) => (
                  <span key={`m-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe2e5] text-[#d91f2a]">
                    {v}
                  </span>
                ))}

                {/* 3. Pure Pending (Gray) */}
                {purePending.map((v, i) => (
                  <span key={`p-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#e3e3e8] text-[#424245]">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: 'Actions',
      id: 'actions',
      size: 50,
      cell: ({ row }) => {
        return (
          <button
            onClick={() => {
              setSelectedPatient(row.original);
              setIsModalOpen(true);
            }}
            className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            title="ดูประวัติวัคซีน"
          >
            <Search className="w-4 h-4" />
          </button>
        );
      },
    }
  ], [v1RulesCount]);

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
      const ageStr = formatAgeStr(row.birth);
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      
      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ': row.name,
        'นามสกุล': row.lname,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน': (() => {
          let text = row.status === 'PASS' 
            ? `ได้รับวัคซีนครบถ้วน (${v1RulesCount} รายการ)` 
            : (row.status === 'FAIL' 
              ? `ตกหล่น: ${row.missingVaccines.join(', ')}` 
              : `ยังไม่ถึงเกณฑ์: ${row.pendingVaccines.join(', ')}`);
          if (row.dataErrors && row.dataErrors.length > 0) {
            text += `\n[ข้อมูลวันที่ผิดปกติ: ${row.dataErrors.join(', ')}]`;
          }
          return text;
        })()
      };
    });
    exportToExcel(exportData, `EPI_View1_Tracking_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = filteredData.map(row => {
      const ageStr = formatAgeStr(row.birth);
      const birthStr = row.birth ? new Date(row.birth as string).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      
      return {
        'สถานบริการ': shortenFacilityName(row.hosname || ''),
        'CID': row.cid,
        'ชื่อ-สกุล': `${row.name} ${row.lname}`,
        'วันเกิด': birthStr ? `${birthStr}\n(อายุ ${ageStr})` : '',
        'ผลการประเมิน': (() => {
          let text = row.status === 'PASS' 
            ? `ได้รับวัคซีนครบถ้วน (${v1RulesCount} รายการ)` 
            : (row.status === 'FAIL' 
              ? `ตกหล่น: ${row.missingVaccines.join(', ')}` 
              : `ยังไม่ถึงเกณฑ์: ${row.pendingVaccines.join(', ')}`);
          if (row.dataErrors && row.dataErrors.length > 0) {
            text += `\n[ข้อมูลวันที่ผิดปกติ: ${row.dataErrors.join(', ')}]`;
          }
          return text;
        })()
      };
    });
    const quarterLabel = quarter === 'all' ? `ภาพรวมทั้งปีงบประมาณ ${fiscalYear}` : `ไตรมาส ${quarter}/${fiscalYear}`;
    const title = `ทะเบียนติดตามเด็กรายบุคคล (ความครอบคลุม ${v1RulesCount} รายการ) - ${quarterLabel}`;
    exportToPdf(exportData, `EPI_View1_Tracking_${new Date().getTime()}`, title);
  };

  const asOfDateText = asOfDate
    ? formatDateTimeStr(asOfDate)
    : 'ไม่มีข้อมูลรอบอัปโหลด';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <VaccineHistoryModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          record={selectedPatient}
          rules={rules.filter(r => r.view_type === 1 && r.is_active)}
          allRules={rules}
        />
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] tracking-[-0.432px]">
            ทะเบียนติดตามเด็กรายบุคคล: ความครอบคลุมการได้รับวัคซีนรายชนิด ({v1RulesCount} รายการ)
          </h2>
          <p className="text-[14px] text-[#7a7a7a] mt-1 tracking-[-0.224px]">
            ข้อมูลอัปเดตล่าสุด: <span className="font-medium text-[#0066cc]">{asOfDateText}</span>
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <select 
            value={filterFacility} 
            onChange={(e) => setFilterFacility(e.target.value)}
            className="px-3 py-2 bg-white border border-[#e0e0e0] rounded-lg text-[14px] text-[#1d1d1f] focus:ring-2 focus:ring-[#0066cc] focus:border-[#0066cc] focus:outline-none transition-colors"
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
            className="px-3 py-2 bg-white border border-[#e0e0e0] rounded-lg text-[14px] text-[#1d1d1f] focus:ring-2 focus:ring-[#0066cc] focus:border-[#0066cc] focus:outline-none transition-colors"
          >
            <option value="all">สถานะการรับวัคซีนทั้งหมด</option>
            <option value="passed">ได้รับวัคซีนครบถ้วน ({v1RulesCount} รายการ)</option>
            <option value="pending">ยังไม่ถึงเกณฑ์ (รอรับบริการ)</option>
            <option value="failed">ยังได้รับวัคซีนไม่ครบถ้วน (ตกหล่น)</option>
          </select>

          {/* Export Buttons */}
          <div className="flex bg-white border border-[#e0e0e0] rounded-lg overflow-hidden">
            <button 
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-2 text-[14px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors border-r border-[#e0e0e0] focus:outline-none"
              title="Export to Excel"
            >
              <FileSpreadsheetIcon className="w-4 h-4 text-[#34c759]" />
              <span className="hidden md:inline font-medium">Excel</span>
            </button>
            <button 
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3 py-2 text-[14px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors focus:outline-none"
              title="Export to PDF"
            >
              <FileTextIcon className="w-4 h-4 text-[#ff3b30]" />
              <span className="hidden md:inline font-medium">PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#f2f8ff] rounded-[16px] p-5 flex gap-4 text-[#1d1d1f]">
        <InfoIcon className="w-6 h-6 text-[#0066cc] shrink-0" />
        <div>
          <p className="font-semibold text-[15px] mb-1 tracking-[-0.24px]">เกี่ยวกับมุมมองที่ 1 (ความครอบคลุมรายชนิดวัคซีน)</p>
          <p className="mb-2 text-[14px] text-[#424245] leading-relaxed tracking-[-0.224px]">
            มุมมองนี้แสดงประวัติการได้รับวัคซีนแบบ <strong>แยกตามชนิดและเข็ม (รวม {v1RulesCount} รายการ)</strong> 
            เพื่อสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ในการ <strong>ติดตามเด็กที่ได้รับวัคซีนไม่ครบถ้วน</strong> ได้อย่างแม่นยำ 
            (หมายเหตุ: เด็ก 1 รายอาจขาดวัคซีนบางรายการในมุมมองนี้ แต่ยังคงผ่านเกณฑ์ตัวชี้วัด Fully Immunized ในภาพรวมได้เนื่องจากเงื่อนไขการประเมินที่ต่างกัน)
          </p>
          <DynamicVaccineGuide 
            rules={rules} 
            viewType={1} 
            title="คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 1 ปี"
            fallbackContent={
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
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">D21, D22, D23</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">OPV (โปลิโอชนิดหยอด)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">081, 082, 083</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">IPV (โปลิโอชนิดฉีด)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>IPV เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">I11, I12</code>)</span>
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
            }
          />
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
              <strong className="text-zinc-800">A:</strong> ระบบจะตรวจสอบการได้รับ IPV จำนวน 2 เข็ม คือ <strong>IPV 2 เดือน</strong> (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">I11</code>) และ <strong>IPV 4 เดือน</strong> (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">I12</code>) หากเจ้าหน้าที่ลืมลงบันทึกรหัสใดรหัสหนึ่ง ระบบจะฟ้องว่าตกหล่น เพื่อให้กลับไปบันทึกข้อมูลย้อนหลังให้ครบถ้วนครับ
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
                <li><strong>มุมมองที่ 1:</strong> เป็นการตรวจสอบ "ความสมบูรณ์ของการบันทึกข้อมูลแบบรายเข็ม" (เข้มงวด {v1RulesCount} รายการ) เช็คแม้กระทั่ง HBV เข็ม 3 (PCV ไม่นำมารวมแล้ว)</li>
                <li><strong>มุมมองที่ 2 (Fully Immunized):</strong> ประเมินเฉพาะ "วัคซีนพื้นฐาน {v2RulesCount} หมวด" ตามเกณฑ์ชี้วัดหลักระดับประเทศ หากได้วัคซีนหลักครบ ก็ถือว่าเด็กมีภูมิคุ้มกันที่เพียงพอและผ่านเกณฑ์ครับ</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

