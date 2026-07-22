import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { evaluateView2 } from '../../../shared/utils/vaccine/vaccine-1yr';
import { evaluateDynamicV2, getDataErrors } from '../../../shared/utils/vaccine/ruleEngine';
import type { VaccineStatus } from '../../../shared/types';
import { formatDateTimeStr, getBirthDateRangeForQuarter, getAgeInMonths, formatAgeStr } from '../../../shared/utils/dateUtils';
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
  dataErrors?: string[];
};

interface View2Props {
  fiscalYear: number;
  quarter: number | 'all';
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

export function View2FullyImmunized({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View2Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Modal state
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { rules } = useVaccineRules(fiscalYear, '1yr');
  const v2RulesCount = rules && rules.length > 0 ? rules.filter(r => r.view_type === 2 && r.is_active && r.is_required_for_v2).length : 8;

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, 1);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    // 2. Evaluate criteria for fully immunized
    const evalFn = rules && rules.length > 0 ? (r: EpiRecord) => evaluateDynamicV2(r, rules) : evaluateView2;
    
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
      if (filterStatus === 'passed' && row.evaluation.status !== 'PASS') return false;
      if (filterStatus === 'pending' && row.evaluation.status !== 'PENDING') return false;
      if (filterStatus === 'failed' && row.evaluation.status !== 'FAIL') return false;
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
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ผ่านเกณฑ์
              </span>
            ) : ev.status === 'FAIL' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                ไม่ผ่านเกณฑ์ (ตกหล่น)
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ยังไม่ถึงเกณฑ์
              </span>
            )}
            
            {/* Badges Container */}
            {(dataErrors.length > 0 || pureMissing.length > 0 || purePending.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {/* 1. Data Errors (Orange) */}
                {dataErrors.map((v, i) => (
                  <span key={`err-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-[10px] font-medium border border-orange-200 shadow-sm" title="ข้อมูลวันที่ผิดปกติ (เช่น ก่อนวันเกิด หรือคีย์ซ้ำซ้อน)">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {v} (ข้อมูลวันที่ผิด)
                  </span>
                ))}
                
                {/* 2. Pure Missing (Red) */}
                {pureMissing.map((v, i) => (
                  <span key={`m-${i}`} className="inline-flex px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium border border-red-100 shadow-sm">
                    {v}
                  </span>
                ))}

                {/* 3. Pure Pending (Gray) */}
                {purePending.map((v, i) => (
                  <span key={`p-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-600 text-[10px] font-medium border border-zinc-200 shadow-sm">
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

  // Handle Export
  const handleExportExcel = () => {
    const exportData = filteredData.map(row => {
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
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
    exportToExcel(exportData, `EPI_View2_FullyImmunized1Yr_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = filteredData.map(row => {
      const age = getAgeInMonths(row.birth);
      const ageStr = age >= 12 ? `${Math.floor(age / 12)} ปี ${age % 12} เดือน` : `${age} เดือน`;
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
    const quarterLabel = quarter === 'all' ? `ภาพรวมทั้งปีงบประมาณ ${fiscalYear}` : `ไตรมาส ${quarter}/${fiscalYear}`;
    const title = `ทะเบียนเด็กความครบถ้วนของวัคซีน (Fully Immunized 1 ปี) - ${quarterLabel}`;
    exportToPdf(exportData, `EPI_View2_FullyImmunized1Yr_${new Date().getTime()}`, title);
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
          <h2 className="text-lg font-semibold text-zinc-900">
            ทะเบียนเด็กความครบถ้วนของวัคซีน (Fully Immunized เด็กอายุ 1 ปี)
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
            <option value="all">ผลการประเมินทั้งหมด</option>
            <option value="passed">ผ่านเกณฑ์ Fully Immunized</option>
            <option value="pending">ยังไม่ถึงเกณฑ์ (รอรับบริการ)</option>
            <option value="failed">ไม่ผ่านเกณฑ์ (ตกหล่น)</option>
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
          <p className="font-semibold mb-1">เกี่ยวกับมุมมองที่ 2 (Fully Immunized เด็กอายุ 1 ปี)</p>
          <p className="mb-2 text-indigo-800 leading-relaxed">
            มุมมองนี้แสดงผลการประเมิน <strong>ภาพรวมการได้รับวัคซีนของเด็กรายบุคคล</strong> ตามเกณฑ์ตัวชี้วัดความครอบคลุม (Fully Immunized) 
            การประเมินผลจะใช้เงื่อนไขแบบองค์รวม (Strict AND Condition) หากขาดวัคซีนในหมวดใดหมวดหนึ่ง จะถือว่า <strong>"ไม่ผ่านเกณฑ์"</strong> ทันที
          </p>
          <DynamicVaccineGuide 
            rules={rules} 
            viewType={2} 
            theme="indigo"
            title="คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็ก 1 ปี"
            fallbackContent={
              <div className="bg-white/60 p-4 rounded-lg border border-indigo-100/50 text-xs">
                <p className="font-semibold mb-3 text-indigo-900 border-b border-indigo-100 pb-2">
                  คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับเด็กอายุ 1 ปี
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-indigo-800">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">BCG (ป้องกันวัณโรค) - 1 เข็ม</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>BCG</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">011</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">HBV (ไวรัสตับอักเสบบี) - 3 เข็ม (แรกเกิด, 2, 6 เดือน)</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>HBV เข็ม 1-3 (แรกเกิด, 2 ด., 6 ด.)</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">041, 042, 043</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">DTP (คอตีบ บาดทะยัก ไอกรน) - ครบ 3 เข็ม</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">031, 032, 033</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">Hib (ฮิบ) - ครบ 3 เข็ม</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>วัคซีนรวม (Pentavalent)</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">D21, D22, D23</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">IPV (โปลิโอชนิดฉีด) - เข็ม 1 และ 2</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>IPV เข็ม 1, 2</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">I11, I12</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">OPV (โปลิโอชนิดหยอด) - 1 เข็ม (ตอน 6 เดือน)</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV เข็ม 3</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">083</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">MMR (หัด หัดเยอรมัน คางทูม) - 1 เข็ม</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 1</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">061</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-indigo-900">Rota (ไวรัสโรต้า) - ครบตามเกณฑ์</span>
                    <span className="text-[11px] text-indigo-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>Rota เข็ม 1-3</strong> (รหัส 43 แฟ้ม: <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">R11, R12, R13</code> หรือ <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]">R21, R22</code>)</span>
                  </div>
                </div>
              </div>
            }
          />
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
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 2 (เด็กอายุ 1 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: มุมมอง Fully Immunized ของเด็กอายุ 1 ปี ตรวจสอบวัคซีนตัวไหนบ้างครับ?</p>
            <p className="text-blue-800">
              <strong className="text-blue-900">A:</strong> สำหรับเด็กอายุ 1 ปี (12-23 เดือน) ระบบประเมิน <strong>ความครบถ้วนของวัคซีนพื้นฐาน {v2RulesCount} หมวดครับ</strong> 
              ได้แก่ BCG (วัณโรค), HBV (ตับอักเสบบี 3 เข็ม), DTP (คอตีบ-บาดทะยัก-ไอกรน 3 เข็ม), Hib (ฮิบ 3 เข็ม), OPV (โปลิโอหยอด 1 เข็ม ที่อายุ 6 เดือน), IPV (โปลิโอฉีด 2 เข็ม), MMR (หัด-หัดเยอรมัน-คางทูม เข็มแรก), และ Rota (ไวรัสโรต้าครบตามเกณฑ์)
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมเกณฑ์ Fully Immunized (มุมมองที่ 2) ถึงตรวจสอบ HBV (ไวรัสตับอักเสบบี) แค่ 3 เข็ม แล้วเข็มตอนอายุ 4 เดือนหายไปไหน?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> 
              เป็นไปตาม <strong>มาตรฐานชี้วัดของ HDC</strong> ครับ ที่ระบุให้เช็ค HBV เพียง 3 ครั้ง คือ แรกเกิด (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">041</code>), 2 เดือน (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">042</code>), และ 6 เดือน (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">044</code>) โดยจะข้ามเข็มที่อายุ 4 เดือนไปในการประเมินมุมมองนี้ครับ (แต่เข็ม 4 เดือนจะยังถูกตรวจสอบความสมบูรณ์อยู่ในมุมมองที่ 1 ครับ)
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมบางคนได้วัคซีน OPV ครบแล้วตอน 2 และ 4 เดือน แต่ในมุมมองที่ 2 ยังบอกว่าตกหล่น?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> 
              ตามเกณฑ์ HDC ปัจจุบันที่มีการปรับการให้ IPV ร่วมด้วย <strong>การประเมิน OPV สำหรับ Fully Immunized จะเช็คเฉพาะเข็มที่ได้รับตอนอายุ 6 เดือน</strong> ครับ (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">083</code>) ดังนั้นถ้าเด็กได้แค่ OPV ตอน 2 หรือ 4 เดือน แต่ขาดหยอดตอน 6 เดือน ก็จะไม่ผ่านเกณฑ์นี้ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: หากผลประเมิน Fully Immunized ขึ้นว่า "ไม่ผ่าน" จากวัคซีน Rota ควรตรวจสอบอย่างไร?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> 
              ประการแรก หากเจ้าหน้าที่ลงวันที่รับวัคซีน Rota เข็ม 1 และ 2 เป็นวันเดียวกัน ระบบจะถือว่าข้อมูลไม่ถูกต้องและตัดสิทธิ์ทันที ประการที่สอง ควรตรวจสอบชนิดของวัคซีนที่บันทึกว่าเป็นแบบ 2 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">R11, R12</code> หรือ <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">R21, R22</code>) หรือ 3 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">R31, R32, R33</code>) ว่าบันทึกรหัสถูกต้องตรงตามที่ฉีดจริงหรือไม่ครับ
            </p>
          </div>
          
        </div>
      </div>
    </div>
  );
}
