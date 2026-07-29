import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { evaluateDynamicV2, getDataErrors } from '../../../shared/utils/vaccine/ruleEngine';
import type { VaccineStatus } from '../../../shared/types';
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

type ProcessedFullyImmunizedRecord = EpiRecord & {
  evaluation: VaccineStatus;
  dataErrors: string[];
};

interface View2Props {
  fiscalYear: number;
  quarter: number | 'all';
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

export function View2FullyImmunized5Yr({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View2Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Modal state
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { rules } = useVaccineRules(fiscalYear, '5yr');
  const v2RulesCount = rules && rules.length > 0 ? rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2).length : 9;

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, 5);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    const evalFn = (r: EpiRecord) => evaluateDynamicV2(r, rules || []);
    
    return cohort.map(record => {
      const v2Rules = rules ? rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2) : [];
      return {
        ...record,
        evaluation: evalFn(record),
        dataErrors: getDataErrors(record, v2Rules.length > 0 ? v2Rules : [])
      };
    });
  }, [data, fiscalYear, quarter, rules]);

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
        const dStr = info.getValue() as string;
        if (!dStr) return <span className="text-zinc-400">-</span>;
        const d = new Date(dStr);
        const ageStr = formatAgeStr(dStr);
        return (
          <div className="flex flex-col">
            <span className="text-zinc-600">{d.toLocaleDateString('th-TH')}</span>
            <span className="text-zinc-400 text-[11px]">(อายุ {ageStr})</span>
          </div>
        );
      },
    },
    {
      header: 'HDC Result (Debug)',
      accessorKey: 'result',
      size: 140,
      cell: info => {
        const val = info.getValue() as string;
        return <span className="text-blue-600 font-mono text-xs">{val || 'MISSING'}</span>;
      },
    },
    {
      header: 'ผลการประเมิน Fully Immunized',
      id: 'status',
      size: 500,
      cell: ({ row }) => {
        const ev = row.original.evaluation;
        const dataErrors = row.original.dataErrors || [];
        
        // Filter missing and pending to NOT include dataErrors
        const pureMissing = ev.missingVaccines.filter(v => !dataErrors.includes(v));
        const purePending = (ev.pendingVaccines || []).filter(v => !dataErrors.includes(v));

        return (
          <div className="flex flex-col gap-1 items-start">
            {ev.status === 'PASS' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#e3f4e1] text-[#1e7e26]">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ผ่านเกณฑ์
              </span>
            ) : ev.status === 'FAIL' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#ffe2e5] text-[#d91f2a]">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                ไม่ผ่านเกณฑ์ (ตกหล่น)
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#fff0d6] text-[#b06100]">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ยังไม่ถึงเกณฑ์ (รอรับบริการ)
              </span>
            )}
            
            {/* Badges Container */}
            {(dataErrors.length > 0 || pureMissing.length > 0 || purePending.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {/* 1. Data Errors (Orange) */}
                {dataErrors.map((v, i) => (
                  <span key={`err-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe8d6] text-[#c95d00]" title="พบความผิดปกติของข้อมูลวันที่ (เช่น ฉีดก่อนวันเกิด, หรือฉีดพร้อมกันเกินกำหนด) - ข้อมูลอาจไม่ถูกนำไปคำนวณใน HDC">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {v} (ข้อมูลวันที่ผิด)
                  </span>
                ))}
                
                {/* 2. Pure Missing (Red) */}
                {pureMissing.map((v, i) => (
                  <span key={`m-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe2e5] text-[#d91f2a]">
                    ขาด {v}
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
        'ผลการประเมิน (Fully Immunized)': (() => {
          let text = row.evaluation.status === 'PASS' 
            ? 'ผ่านเกณฑ์' 
            : (row.evaluation.status === 'FAIL' 
              ? `ตกหล่น: ${row.evaluation.missingVaccines.join(', ')}` 
              : `ยังไม่ถึงเกณฑ์: ${(row.evaluation.pendingVaccines || []).join(', ')}`);
          if (row.dataErrors && row.dataErrors.length > 0) {
            text += `\n[ข้อมูลวันที่ผิดปกติ: ${row.dataErrors.join(', ')}]`;
          }
          return text;
        })()
      };
    });
    exportToExcel(exportData, `EPI_View2_FullyImmunized5Yr_${new Date().getTime()}`);
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
          let text = row.evaluation.status === 'PASS' 
            ? 'ผ่านเกณฑ์' 
            : (row.evaluation.status === 'FAIL' 
              ? `ตกหล่น: ${row.evaluation.missingVaccines.join(', ')}` 
              : `ยังไม่ถึงเกณฑ์: ${(row.evaluation.pendingVaccines || []).join(', ')}`);
          if (row.dataErrors && row.dataErrors.length > 0) {
            text += `\n[ข้อมูลวันที่ผิดปกติ: ${row.dataErrors.join(', ')}]`;
          }
          return text;
        })()
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
        <VaccineHistoryModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          record={selectedPatient}
          rules={rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2)}
        />
        
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] tracking-[-0.432px]">
            ทะเบียนเด็กความครบถ้วนของวัคซีน (Fully Immunized เด็กอายุ 5 ปี)
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
            <option value="all">ผลการประเมินทั้งหมด</option>
            <option value="passed">ผ่านเกณฑ์ (Fully Immunized)</option>
            <option value="failed">ยังไม่ผ่านเกณฑ์ (ตกหล่น)</option>
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
      <div className="bg-[#f5f5fc] rounded-[16px] p-5 flex gap-4 text-[#1d1d1f]">
        <InfoIcon className="w-6 h-6 text-[#5856d6] shrink-0" />
        <div className="w-full">
          <p className="font-semibold text-[15px] mb-1 tracking-[-0.24px]">เกี่ยวกับมุมมองที่ 2 (Fully Immunized เด็กอายุ 5 ปี)</p>
          <p className="mb-2 text-[14px] text-[#424245] leading-relaxed tracking-[-0.224px]">
            มุมมองนี้แสดงผลการประเมิน <strong>ภาพรวมการได้รับวัคซีนของเด็กรายบุคคล</strong> ตามเกณฑ์ตัวชี้วัดความครอบคลุม (Fully Immunized) 
            การประเมินผลจะใช้เงื่อนไขแบบองค์รวม (Strict AND Condition) หากขาดวัคซีนในหมวดใดหมวดหนึ่ง จะถือว่า <strong>"ไม่ผ่านเกณฑ์"</strong> ทันที
          </p>
          <DynamicVaccineGuide 
            rules={rules} 
            viewType={2} 
            theme="indigo"
            title="คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 5 ปี"
            fallbackContent={
              <div className="bg-white/60 p-4 rounded-lg border border-[#e5e5ea] text-xs">
                <p className="font-semibold mb-3 text-[#1d1d1f] border-b border-[#e5e5ea] pb-2">
                  คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 5 ปี
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[#424245]">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">BCG (ป้องกันวัณโรค) - 1 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>BCG</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">011</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">HBV (ไวรัสตับอักเสบบี) - ครบ 3 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>HBV เข็ม 1-3</strong> (แรกเกิด, 2 ด., 6 ด.) (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">041, 042, 043</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">DTP (คอตีบ บาดทะยัก ไอกรน) - ครบ 5 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 1-5</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">031, 032, 033, 034, 035</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">Hib (ฮิบ) - ครบ 3 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">D21, D22, D23</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">IPV (โปลิโอชนิดฉีด) - ครบ 2 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>IPV เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">I11, I12</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">OPV (โปลิโอชนิดหยอด) - ครบ 3 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV ครั้งที่ 1-3 ตามเกณฑ์ใหม่</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">083, 084, 085</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">MMR (หัด หัดเยอรมัน คางทูม) - ครบ 2 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">061, 073</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">Rota (ไวรัสโรต้า) - ครบ 2 หรือ 3 เข็ม</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>Rota เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">R11, R12, R13</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[#1d1d1f]">LAJE / JE (ไข้สมองอักเสบเจอี) - ครบตามเกณฑ์</span>
                    <span className="text-[11px] text-[#7a7a7a]">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>LAJE เข็ม 1-2</strong> หรือ <strong>JE เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">J11, J12</code> หรือ <code className="bg-[#e3e3e8] px-1 py-0.5 rounded font-mono text-[10px] text-[#1d1d1f]">051, 052, 053</code>)</span>
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white p-5 rounded-[16px] border border-[#e0e0e0] flex flex-col">
          <span className="text-[14px] font-medium text-[#7a7a7a] tracking-[-0.224px]">จำนวนเด็กทั้งหมด (คน)</span>
          <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1 tracking-[-0.56px]">{total.toLocaleString()}</span>
        </div>
        <div className="bg-[#e3f4e1] p-5 rounded-[16px] border-0 flex flex-col">
          <span className="text-[14px] font-medium text-[#1e7e26] tracking-[-0.224px]">จำนวนเด็กที่ผ่านเกณฑ์ (คน)</span>
          <span className="text-[28px] font-semibold text-[#1e7e26] mt-1 tracking-[-0.56px]">{passed.toLocaleString()}</span>
        </div>
        <div className="bg-[#ffe2e5] p-5 rounded-[16px] border-0 flex flex-col">
          <span className="text-[14px] font-medium text-[#d91f2a] tracking-[-0.224px]">จำนวนเด็กที่ไม่ผ่านเกณฑ์ (คน)</span>
          <span className="text-[28px] font-semibold text-[#d91f2a] mt-1 tracking-[-0.56px]">{failed.toLocaleString()}</span>
        </div>
        <div className="bg-[#f0f9ff] p-5 rounded-[16px] border-0 flex flex-col">
          <span className="text-[14px] font-medium text-[#0066cc] tracking-[-0.224px]">ร้อยละความครอบคลุม</span>
          <span className="text-[28px] font-semibold text-[#0066cc] mt-1 tracking-[-0.56px]">{coverageRate} <span className="text-[18px] font-normal">%</span></span>
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
              <strong className="text-blue-900">A:</strong> สำหรับเด็กอายุ 5 ปี (ก่อนเข้าเรียน) ระบบจะ <strong>ประเมินวัคซีนสะสมทั้งหมดตั้งแต่แรกเกิดจนถึงปัจจุบัน รวม {v2RulesCount} หมวดครับ</strong> 
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
