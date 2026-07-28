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
  dataErrors: string[];
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

export function View1Individual2Yr({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View1Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Modal state
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { rules } = useVaccineRules(fiscalYear, '2yr');
  const v1RulesCount = rules && rules.length > 0 ? rules.filter(r => r.view_type === 1 && r.is_active).length : 5;

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, 2);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    const evalFn = (r: EpiRecord) => evaluateDynamicV1(r, rules || []);

    return cohort.map(record => {
      const evaluation = evalFn(record);
      const pending = (evaluation as any).pendingVaccines || [];
      const missing = evaluation.missingVaccines || [];
      let status: 'PASS' | 'FAIL' | 'PENDING' = 'PASS';
      if (missing.length > 0) status = 'FAIL';
      else if (pending.length > 0) status = 'PENDING';
      
      const v1Rules = rules ? rules.filter(r => r.view_type === 1 && r.is_active) : [];
      const dataErrors = getDataErrors(record, v1Rules.length > 0 ? v1Rules : []);
      
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
      header: 'ผลการประเมินรายชนิด',
      id: 'status',
      size: 500,
      cell: ({ row }) => {
        const status = row.original.status;
        const dataErrors = row.original.dataErrors || [];
        
        return (
          <div className="flex flex-col gap-1 items-start">
            {/* Main Status Pill */}
            {status === 'PASS' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#e3f4e1] text-[#1e7e26]">
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ได้รับวัคซีนครบถ้วน ({v1RulesCount} รายการ)
              </span>
            ) : status === 'FAIL' ? (
              <div className="flex flex-col gap-1 items-start">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#ffe2e5] text-[#d91f2a]">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                  ไม่ผ่านเกณฑ์ (ตกหล่น)
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {row.original.missingVaccines.map((v, i) => (
                    <span key={i} className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe2e5] text-[#d91f2a]">
                      ขาด {v}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1 items-start">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium tracking-[-0.12px] bg-[#fff0d6] text-[#b06100]">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM11 5a1 1 0 10-2 0v4.586l-2.707 2.707a1 1 0 101.414 1.414l3-3A1 1 0 0011 10.586V5z" clipRule="evenodd" /></svg>
                  ยังไม่ถึงเกณฑ์ (รอรับบริการ)
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {row.original.pendingVaccines.map((v, i) => (
                    <span key={i} className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#e3e3e8] text-[#424245]">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Data Error Badges (Orange Badges) */}
            {dataErrors.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {dataErrors.map((err, i) => (
                  <span key={`err-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium tracking-[-0.1px] bg-[#ffe8d6] text-[#c95d00]" title="พบความผิดปกติของข้อมูลวันที่ (เช่น ฉีดก่อนวันเกิด, หรือฉีดพร้อมกันเกินกำหนด) - ข้อมูลอาจไม่ถูกนำไปคำนวณใน HDC">
                    {err} (ข้อมูลวันที่ผิด)
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
        <p className="mt-4 text-zinc-500">กำลังประมวลผลข้อมูลเด็กรายบุคคล...</p>
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
    const title = `ทะเบียนติดตามเด็กรายบุคคล (ความครอบคลุม ${v1RulesCount} รายการ) - ไตรมาส ${quarter}/${fiscalYear}`;
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
          <p className="font-semibold text-[15px] mb-1 tracking-[-0.24px]">เกี่ยวกับมุมมองที่ 1 (ความครอบคลุมรายชนิดวัคซีนเข็มกระตุ้น)</p>
          <p className="mb-2 text-[14px] text-[#424245] leading-relaxed tracking-[-0.224px]">
            มุมมองนี้แสดงประวัติการได้รับวัคซีนแบบ <strong>แยกตามชนิดและเข็ม (รวม {v1RulesCount} รายการ)</strong> 
            เพื่อสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ในการ <strong>ติดตามเด็กที่ได้รับวัคซีนไม่ครบถ้วน</strong> ได้อย่างแม่นยำ 
            (หมายเหตุ: เด็ก 1 รายอาจขาดวัคซีนบางรายการในมุมมองนี้ แต่ยังคงผ่านเกณฑ์ตัวชี้วัด Fully Immunized ในภาพรวมได้เนื่องจากเงื่อนไขการประเมินที่ต่างกัน)
          </p>
          <DynamicVaccineGuide 
            rules={rules} 
            viewType={1} 
            title="คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับความครอบคลุมรายชนิดเด็กอายุ 2 ปี"
            fallbackContent={
              <div className="bg-white/70 p-4 rounded-lg border border-blue-100/50 mt-3 text-xs shadow-sm">
                <p className="font-semibold mb-3 text-blue-900 border-b border-blue-100 pb-2">
                  คู่มือและเกณฑ์ประเมินรหัสวัคซีน HDC (ปรับปรุงปี 2569) สำหรับความครอบคลุมรายชนิดเด็กอายุ 2 ปี
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-blue-800">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">LAJE/JE (ไข้สมองอักเสบเจอี)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>LAJE เข็ม 1</strong> หรือ <strong>JE เข็ม 1-2</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">J11</code> หรือ <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">051, 052</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">DTP (คอตีบ บาดทะยัก ไอกรน)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>DTP เข็ม 4</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">034, D14, D24, D34, D44, D54</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">OPV (โปลิโอชนิดหยอด)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>OPV เข็ม 4</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">084, I14, D34, D44, D54</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">MMR (หัด หัดเยอรมัน คางทูม) - เก็บตก</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 1</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">061, M11</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">MMR (หัด หัดเยอรมัน คางทูม) - เข็ม 2</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>MMR เข็ม 2</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">073, M12</code>)</span>
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
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 1 (เด็กอายุ 2 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: มุมมองที่ 1 ของเด็กอายุ 2 ปี ตรวจสอบวัคซีนกลุ่มไหนบ้าง?</p>
            <p className="text-blue-800">
              <strong className="text-blue-900">A:</strong> สำหรับเด็กอายุ 2 ปีบริบูรณ์ (24-35 เดือน) มุมมองที่ 1 จะโฟกัสไปที่ <strong>วัคซีนเข็มกระตุ้นช่วง 1 ขวบครึ่ง</strong> ครับ 
              ได้แก่ DTP เข็มที่ 4 (คอตีบ-บาดทะยัก-ไอกรน), OPV เข็มที่ 4 (โปลิโอหยอด), MMR เข็มที่ 2 (หัด-หัดเยอรมัน-คางทูม), และวัคซีนสมองอักเสบเจอี (LAJE) เข็มแรก นอกจากนี้ยังมีการตรวจสอบ MMR เข็ม 1 (เก็บตก) ด้วยครับ รวมเป็น {v1RulesCount} รายการ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: เด็กได้รับวัคซีนสมองอักเสบเจอี (JE) แล้ว แต่ในระบบยังแจ้งว่าตกหล่น?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> 
              กรณีวัคซีนเจอี ระบบจะตรวจสอบ 2 รูปแบบครับ หากเด็กรับ <strong>วัคซีนชนิดเชื้อเป็น (LAJE)</strong> จะต้องมีข้อมูลการรับ 1 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-200/60 px-1.5 py-0.5 rounded-md font-mono text-[11px] text-zinc-700 border border-zinc-300/50">J11</code>) 
              แต่ถ้าไปฉีดคลินิก/รพ.เอกชน เป็น <strong>ชนิดเชื้อตาย (JE)</strong> เด็กจะต้องมีข้อมูลครบ 2 เข็ม (รหัส 43 แฟ้ม: <code className="bg-zinc-200/60 px-1.5 py-0.5 rounded-md font-mono text-[11px] text-zinc-700 border border-zinc-300/50">051, 052</code>) หากคีย์รหัสสลับประเภทกัน หรือได้ชนิดเชื้อตายแค่เข็มเดียว ระบบจะแจ้งว่าตกหล่นทันทีครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมระบบถึงตรวจสอบ DTP เข็มที่ 4 และ OPV เข็มที่ 4 (ไม่ใช่เข็มอื่น)?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> ในเด็กช่วงอายุ 1 ปีครึ่ง ถึง 2 ปี เป็นช่วงเวลาตามแผนงานสร้างเสริมภูมิคุ้มกันโรคของประเทศ ที่เด็กต้องได้รับ <strong>วัคซีนเข็มกระตุ้น (Booster dose)</strong> 
              ซึ่งก็คือ DTP และ OPV เข็มที่ 4 ครับ (รหัส 43 แฟ้ม: <code className="bg-zinc-200/60 px-1.5 py-0.5 rounded-md font-mono text-[11px] text-zinc-700 border border-zinc-300/50">034</code> สำหรับ DTP และ <code className="bg-zinc-200/60 px-1.5 py-0.5 rounded-md font-mono text-[11px] text-zinc-700 border border-zinc-300/50">084</code> สำหรับ OPV) 
              หากระบบแจ้งว่าขาด ให้ตรวจสอบการลงรหัสเข็มกระตุ้นใน HIS ว่าถูกต้องและผูกกับรหัสมาตรฐาน HDC ครบถ้วนหรือไม่ครับ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: หากพบว่าเด็กตกหล่นเข็มกระตุ้นช่วง 1 ขวบครึ่ง ต้องดำเนินการอย่างไร?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> สามารถโทรติดตามผู้ปกครองให้นำเด็กมารับวัคซีนเก็บตก (Catch-up) ที่หน่วยบริการได้เลยครับ 
              หรือถ้าผู้ปกครองแจ้งว่าพาไปฉีดที่อื่นมาแล้ว ให้ขอดูภาพสมุดสีชมพูเพื่อนำมาบันทึกประวัติวัคซีนย้อนหลัง (Historical Data) ในโปรแกรม HIS ของเรา ข้อมูลก็จะเข้า HDC ในรอบส่งออกถัดไปครับ
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
