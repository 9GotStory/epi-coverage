import { useMemo, useState } from 'react';
import { InfoIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { evaluateDynamicV1, getDataErrors } from '../../../shared/utils/vaccine/ruleEngine';
import { formatDateStr, formatDateTimeStr, getBirthDateRangeForQuarter, formatAgeStr } from '../../../shared/utils/dateUtils';
import type { EpiRecord } from '../../../shared/types';
import { EpiDataTable } from '../../../shared/components/EpiDataTable';
import { exportToExcel, exportToPdf } from '../../../shared/exportUtils';
import { useVaccineRules } from '../../../shared/hooks/useVaccineRules';
import { DynamicVaccineGuide } from '../../../shared/components/DynamicVaccineGuide';
import { VaccineHistoryModal } from '../../../shared/components/VaccineHistoryModal';
import { Button } from '../../../shared/components/ui/button';
import { getRecordDateWarnings } from '../../../shared/utils/vaccine/dateWarnings';

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

export function View1Individual3Yr({ fiscalYear, quarter, data, isLoading, error, asOfDate }: View1Props) {
  const [filterFacility, setFilterFacility] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Modal state
  const [selectedPatient, setSelectedPatient] = useState<EpiRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { rules, isLoading: rulesLoading, error: rulesError } = useVaccineRules(fiscalYear, '3yr');
  const v1RulesCount = rules.filter(r => r.view_type === 1 && r.is_active).length;

  const processedData = useMemo(() => {
    // 1. Filter cohort by Fiscal Year and Quarter
    const { start, end } = getBirthDateRangeForQuarter(fiscalYear, quarter, 3);
    const cohort = data.filter(record => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });

    const evalFn = (r: EpiRecord) => evaluateDynamicV1(r, rules);

    return cohort.map(record => {
      const evaluation = evalFn(record);
      const pending = (evaluation as any).pendingVaccines || [];
      const missing = evaluation.missingVaccines || [];
      let status: 'PASS' | 'FAIL' | 'PENDING' = 'PASS';
      if (missing.length > 0) status = 'FAIL';
      else if (pending.length > 0) status = 'PENDING';

      const dataErrors = [...new Set([...getDataErrors(record, rules), ...getRecordDateWarnings(record, rules)])];

      return {
        ...record,
        missingVaccines: missing.filter(value => !dataErrors.includes(value)),
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

  const columns = useMemo<ColumnDef<ProcessedView1Record>[]>(() => [
    { header: 'สถานบริการ', accessorKey: 'hoscode', cell: ({ row }) => <div><div>{row.original.hoscode}</div><div className="text-xs text-zinc-500">{row.original.hosname}</div></div> },
    { header: 'CID', accessorKey: 'cid' },
    { header: 'ชื่อ-สกุล', accessorFn: record => `${record.name} ${record.lname}` },
    { header: 'วันเกิด', accessorKey: 'birth', cell: ({ row }) => <div>{formatDateStr(row.original.birth)}<div className="text-xs text-zinc-500">(อายุ {formatAgeStr(row.original.birth)})</div></div> },
    { header: 'ผลการประเมินรายชนิด', id: 'status', cell: ({ row }) => {
      const { status, missingVaccines, pendingVaccines, dataErrors = [] } = row.original;
      const missing = missingVaccines.filter(value => !dataErrors.includes(value));
      return <div className="space-y-1 text-sm">
        <p>{status === 'PASS' ? `ได้รับวัคซีนครบถ้วน (${v1RulesCount} รายการ)` : status === 'PENDING' ? 'ยังไม่ถึงเกณฑ์' : missing.length === 0 ? 'ตรวจสอบประวัติวัคซีน' : 'ไม่ผ่านเกณฑ์รายชนิด'}</p>
        {missing.length > 0 && <p>ขาด: {missing.join(', ')}</p>}
        {pendingVaccines.length > 0 && <p className="text-zinc-500">ยังไม่ถึงเกณฑ์: {pendingVaccines.join(', ')}</p>}
      </div>;
    } },
    { header: 'ประวัติวัคซีน', id: 'history', cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => { setSelectedPatient(row.original); setIsModalOpen(true); }}>ดูประวัติ</Button> },
  ], [v1RulesCount]);

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
        'ผลการประเมิน (LAJE2 / JE3)': (() => {
          const text = row.status === 'PASS'
            ? 'ได้รับวัคซีนครบถ้วน'
            : (row.status === 'FAIL'
              ? (row.missingVaccines.length ? `ตกหล่น: ${row.missingVaccines.join(', ')}` : 'ตรวจสอบประวัติวัคซีน')
              : `ยังไม่ถึงเกณฑ์: ${row.pendingVaccines.join(', ')}`);

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
          const text = row.status === 'PASS'
            ? 'ครบถ้วน'
            : (row.status === 'FAIL'
              ? (row.missingVaccines.length ? `ตกหล่น: ${row.missingVaccines.join(', ')}` : 'ตรวจสอบประวัติวัคซีน')
              : `ยังไม่ถึงเกณฑ์: ${row.pendingVaccines.join(', ')}`);

          return text;
        })()
      };
    });
    const title = `ทะเบียนติดตามเด็กรายบุคคล (ความครอบคลุม LAJE/JE) - ไตรมาส ${quarter}/${fiscalYear}`;
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
          warningsStatus={rulesLoading ? 'กำลังโหลดเกณฑ์ตรวจวันที่...' : rulesError ? 'โหลดเกณฑ์ตรวจวันที่ไม่สำเร็จ' : rules.length === 0 ? 'ยังไม่มีเกณฑ์ตรวจวันที่สำหรับปีและกลุ่มอายุนี้' : undefined}
          warnings={selectedPatient ? getRecordDateWarnings(selectedPatient, rules) : []}
        />

        {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] tracking-[-0.432px]">
            ทะเบียนติดตามเด็กรายบุคคล: ความครอบคลุมการได้รับวัคซีนรายชนิด (LAJE)
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
            <option value="passed">ได้รับวัคซีนครบถ้วน (LAJE เข็ม 2 / JE เข็ม 3)</option>
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
          <p className="font-semibold text-[15px] mb-1 tracking-[-0.24px]">เกี่ยวกับมุมมองที่ 1 (ความครอบคลุมวัคซีน LAJE เข็ม 2)</p>
          <p className="mb-2 text-[14px] text-[#424245] leading-relaxed tracking-[-0.224px]">
            มุมมองนี้แสดงประวัติการได้รับวัคซีน <strong>LAJE เข็มที่ 2 หรือ JE เข็มที่ 3</strong>
            เพื่อสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ในการ <strong>ติดตามเด็กอายุครบ 3 ปีที่ยังไม่ได้รับวัคซีนสมองอักเสบเจอี</strong> ได้อย่างแม่นยำ
            (หมายเหตุ: เด็ก 1 รายอาจขาดวัคซีนในมุมมองนี้ แต่หากเคยได้รับวัคซีนตัวอื่นๆ ตอนอายุ 1-2 ปีไม่ครบ ก็อาจจะไม่ผ่านเกณฑ์ตัวชี้วัด Fully Immunized ในภาพรวมได้เช่นกัน)
          </p>
          <DynamicVaccineGuide
            rules={rules}
            viewType={1}
            title="คู่มือและเกณฑ์ประเมินรหัสวัคซีนรวม HDC (ปรับปรุงปี 2569) สำหรับเด็ก 3 ปี"
            fallbackContent={
              <div className="bg-white/70 p-4 rounded-lg border border-blue-100/50 mt-3 text-xs shadow-sm">
                <p className="font-semibold mb-3 text-blue-900 border-b border-blue-100 pb-2">
                  คู่มือและเกณฑ์ประเมินรหัสวัคซีนรวม HDC (ปรับปรุงปี 2569) สำหรับเด็ก 3 ปี
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-blue-800">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">LAJE (สมองอักเสบเจอี ชนิดเชื้อเป็น)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>LAJE เข็ม 2</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">J12 หรือ 053</code>)</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-blue-900">JE (สมองอักเสบเจอี ชนิดเชื้อตาย)</span>
                    <span className="text-[11px] text-blue-700">วิธีบันทึกใน HIS: เลือกลงเป็น <strong>JE เข็ม 3</strong> (รหัส 43 แฟ้ม: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]">JE3</code>)</span>
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
          คำถามที่พบบ่อย (FAQ) และแนวทางการลงข้อมูล - มุมมองที่ 1 (เด็กอายุ 3 ปี)
        </h3>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">

          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-900 mb-1">Q: มุมมองที่ 1 ของเด็กอายุ 3 ปี โฟกัสไปที่วัคซีนตัวไหนเป็นพิเศษ?</p>
            <p className="text-blue-800">
              <strong className="text-blue-900">A:</strong> สำหรับเด็กวัย 3 ปีบริบูรณ์ (36-47 เดือน) จะมี <strong>วัคซีนเป้าหมายเพียงตัวเดียวคือ วัคซีนสมองอักเสบเจอี (LAJE) เข็มที่ 2</strong>
              ซึ่งตามเกณฑ์ปกติเด็กจะได้รับตอนอายุ 2 ปีครึ่งครับ มุมมองนี้จึงออกแบบมาเพื่อติดตามการมารับ LAJE เข็ม 2 โดยเฉพาะ
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: เด็กได้รับวัคซีนสมองอักเสบเจอี (JE) ครบแล้ว แต่รายงานบอกว่ายังไม่ได้ LAJE เข็ม 2?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong>
              ต้องตรวจสอบประเภทวัคซีนที่เด็กได้รับครับ ถ้าเป็นมาตรฐานภาครัฐ <strong>ชนิดเชื้อเป็น (LAJE)</strong> จะต้องบันทึกให้ครบ 2 เข็ม (รหัส <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">J11, J12</code>)
              แต่ถ้าเด็กได้รับแบบ <strong>ชนิดเชื้อตาย (JE)</strong> มาจากคลินิกเอกชน จะต้องมีประวัติรับวัคซีนครบ 3 เข็ม (รหัส <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-700">JE1, JE2, JE3</code>) ระบบถึงจะยอมรับว่าฉีดครบเกณฑ์ครับ หากคีย์รหัสผิดประเภทกัน HDC จะตัดสิทธิ์ทันที
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
            <p className="font-semibold text-zinc-800 mb-1">Q: ทำไมรายงานถึงไม่แสดงสถานะของ DTP, OPV, หรือ MMR เหมือนมุมมองเด็กอายุอื่น?</p>
            <p className="text-zinc-600">
              <strong className="text-zinc-800">A:</strong> ในรายงานมุมมองที่ 1 จะโฟกัสแค่ <strong>"วัคซีนประจำช่วงอายุ"</strong> ครับ ซึ่งตอน 2 ขวบครึ่งมีแค่ LAJE เข็ม 2
              ส่วนภาพรวมว่าเด็กได้รับวัคซีนตั้งแต่แรกเกิดครบทั้งหมดหรือไม่ พี่ๆ เจ้าหน้าที่สามารถดูได้ที่ <strong>มุมมองที่ 2 (Fully Immunized)</strong> แทนครับ
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
