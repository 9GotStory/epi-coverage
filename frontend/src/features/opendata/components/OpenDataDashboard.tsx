import { useState, useEffect, useMemo } from 'react';
import { useOpenData } from '../hooks/useOpenData';
import { fetchApi } from '../../../shared/lib/api';
import { CoverageBarChart } from './CoverageBarChart';
import { formatEpiDataForChart, formatEpiAllVaccines } from '../utils/chartUtils';
import { VaccineGaugeGrid } from './VaccineGaugeGrid';
import { VaccineRadarChart } from './VaccineRadarChart';
import { RefreshCwIcon, AlertCircleIcon, DatabaseIcon } from 'lucide-react';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { useTargetSettings } from '../../../shared/hooks/useTargetSettings';
import { ExportButtonGroup } from '../../../shared/components/ExportButtonGroup';
import { exportToExcel, exportToPdf } from '../../../shared/exportUtils';
function getCurrentFiscalYear() {
  const today = new Date();
  const year = today.getFullYear() + 543;
  // Fiscal year starts in October (month 9 in 0-indexed Date)
  if (today.getMonth() >= 9) {
    return (year + 1).toString();
  }
  return year.toString();
}

export interface OpenDataDashboardProps {
  targetTable?: 's_epi1' | 's_epi2' | 's_epi3' | 's_epi5';
}

export function OpenDataDashboard({ targetTable = 's_epi1' }: OpenDataDashboardProps) {
  const { user } = useAuth();
  const { getTarget } = useTargetSettings();
  
  // Calculate current fiscal year and generate options
  const currentFY = getCurrentFiscalYear();
  const [year, setYear] = useState(currentFY);
  const [province] = useState('54'); // แพร่
  const [amp] = useState('06'); // สอง
  const isEpi1 = targetTable === 's_epi1';
  const isEpi3 = targetTable === 's_epi3';
  const isEpi5 = targetTable === 's_epi5';
  const [vaccine, setVaccine] = useState(isEpi1 ? 'bcg' : (isEpi3 ? 'je3' : (isEpi5 ? 'dtp5' : 'dtp4')));
  const [quarter, setQuarter] = useState<1|2|3|4|'all'>('all');

  const isAdmin = user?.role === 'admin' || user?.hoscode === '00588';
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedHosp, setSelectedHosp] = useState<string>(isAdmin ? 'all' : (user?.hoscode || 'all'));

  useEffect(() => {
    if (isAdmin) {
      fetchApi('getFacilities').then(res => {
        if (res.data) setFacilities(res.data);
      }).catch(console.error);
    }
  }, [isAdmin]);

  // Generate year options (3 years back, 1 year forward)
  const currentFYNum = parseInt(currentFY, 10);
  const yearOptions = Array.from({ length: 5 }, (_, i) => (currentFYNum - 3 + i).toString());

  const vaccineOptions = isEpi1 ? [
    { value: 'bcg', label: 'BCG (1 เข็ม)' },
    { value: 'hbv4', label: 'HBV (3 เข็ม)' },
    { value: 'dtp_hb3', label: 'DTP (3 เข็ม)' },
    { value: 'hib3', label: 'Hib (3 เข็ม)' },
    { value: 'opv3', label: 'OPV (1 เข็ม ตอน 6 ด.)' },
    { value: 'ipv', label: 'IPV (2 เข็ม)' },
    { value: 'rota', label: 'Rota (ครบตามเกณฑ์)' },
    { value: 'mmr', label: 'MMR (1 เข็ม)' }
  ] : isEpi3 ? [
    { value: 'je3', label: 'LAJE เข็ม 2 / JE เข็ม 3' }
  ] : isEpi5 ? [
    { value: 'dtp5', label: 'DTP (เข็ม 5)' },
    { value: 'opv5', label: 'OPV (เข็ม 5)' }
  ] : [
    { value: 'je2', label: 'LAJE/JE (1 เข็ม หรือ ครบ 2 เข็ม)' },
    { value: 'dtp4', label: 'DTP (เข็ม 4)' },
    { value: 'opv4', label: 'OPV (เข็ม 4)' },
    { value: 'mmr1', label: 'MMR (เก็บตกเข็ม 1)' },
    { value: 'mmr2', label: 'MMR (เข็ม 2)' }
  ];

  const { data, isLoading, isError, error, refetch } = useOpenData({
    tableName: targetTable,
    year,
    province,
    amp
  });

  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const filteredData = selectedHosp === 'all' 
      ? data 
      : data.filter(d => d.hospcode === selectedHosp);

    return formatEpiDataForChart(filteredData, vaccine);
  }, [data, selectedHosp, vaccine]);

  // Aggregate stats for gauge and radar (ALL vaccines)
  const allVaccinesData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const filteredData = selectedHosp === 'all' 
      ? data 
      : data.filter(d => d.hospcode === selectedHosp);
    
    const baseData = formatEpiAllVaccines(filteredData, targetTable);
    
    // Map specific dynamic targets for each vaccine gauge
    return baseData.map(item => {
      const vaccineKeyForTarget = item.vaccine === 'mmr' || item.vaccine === 'mmr1' || item.vaccine === 'mmr2' ? 'mmr' : item.vaccine;
      return {
        ...item,
        goal: getTarget(quarter, 1, vaccineKeyForTarget)
      };
    });
  }, [data, selectedHosp, targetTable, quarter, getTarget]);

  // Calculate total summary for the selected year
  const summary = useMemo(() => {
    const totalTarget = chartData.reduce((sum: number, item: any) => sum + item.target, 0);
    const totalResult = chartData.reduce((sum: number, item: any) => sum + item.result, 0);
    return {
      target: totalTarget,
      result: totalResult,
      coverage: totalTarget > 0 ? (totalResult / totalTarget) * 100 : 0
    };
  }, [chartData]);

  // Extract active facilities from OpenData dynamically
  const activeHospcodes = new Set<string>();
  if (data && Array.isArray(data)) {
    data.forEach(d => {
      if (d.hospcode && d.areacode && String(d.areacode).startsWith('5406')) {
        activeHospcodes.add(d.hospcode);
      }
    });
  }
  const activeFacilities = Array.from(activeHospcodes)
    .map(code => {
      const fac = facilities.find(f => f.hoscode === code);
      return {
        hoscode: code,
        hosname: fac ? fac.hosname : code
      };
    })
    .sort((a, b) => a.hosname.localeCompare(b.hosname));

  const selectedVaccineLabel = vaccineOptions.find(v => v.value === vaccine)?.label || vaccine;

  // คำนวณเป้าหมายแบบ Dynamic ตามไตรมาส + ชนิดวัคซีน (มุมมอง 1 = view1)
  const vaccineKeyForTarget = vaccine === 'mmr' || vaccine === 'mmr1' || vaccine === 'mmr2' ? 'mmr' : undefined;
  const dynamicTarget = getTarget(quarter, 1, vaccineKeyForTarget);
  // เป้าหมายสำหรับ Radar (ใช้ค่าพื้นฐานของไตรมาส ไม่แยกวัคซีน)
  const radarTarget = getTarget(quarter, 1);

  // Handle Export
  const handleExportExcel = () => {
    const exportData = chartData.map((row: any) => ({
      'สถานบริการ': row.hospname,
      'เป้าหมาย (คน)': row.target,
      'ผลงาน (คน)': row.result,
      'ความครอบคลุม (%)': row.coverage.toFixed(2)
    }));
    exportToExcel(exportData, `OpenData_Dashboard_${vaccine}_${new Date().getTime()}`);
  };

  const handleExportPdf = () => {
    const exportData = chartData.map((row: any) => ({
      'สถานบริการ': row.hospname,
      'เป้าหมาย (คน)': row.target,
      'ผลงาน (คน)': row.result,
      'ความครอบคลุม (%)': row.coverage.toFixed(2)
    }));
    const quarterLabel = quarter === 'all' ? `ภาพรวมทั้งปีงบประมาณ ${year}` : `ไตรมาส ${quarter}/${year}`;
    const title = `รายงาน OpenData วัคซีน ${selectedVaccineLabel} - ${quarterLabel}`;
    exportToPdf(exportData, `OpenData_Dashboard_${vaccine}_${new Date().getTime()}`, title);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <DatabaseIcon className="w-6 h-6 text-primary" />
            ภาพรวมข้อมูล HDC (เด็ก {isEpi1 ? '1' : (isEpi3 ? '3' : (isEpi5 ? '5' : '2'))} ปี)
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            ความครอบคลุมการได้รับวัคซีนตามเกณฑ์ในเด็ก อายุครบ {isEpi1 ? '1' : (isEpi3 ? '3' : (isEpi5 ? '5' : '2'))} ปี แบบแยกรายชนิด (ดึงข้อมูลจาก HDC OpenData) <br/>
            <span className="text-blue-600 font-medium">* หมายเหตุ: ข้อมูลสถิติในหน้านี้ใช้เกณฑ์การประเมินแบบเดียวกับ "มุมมองที่ 1"</span>
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-zinc-200">
          <div className="px-3">
            <label className="text-xs text-zinc-500 block mb-1">ปีงบประมาณ</label>
            <select 
              value={year} 
              onChange={(e) => setYear(e.target.value)}
              className="text-sm border-none bg-transparent font-medium text-zinc-900 focus:ring-0 p-0 cursor-pointer"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          
          <div className="h-8 w-px bg-zinc-200"></div>

          {/* ── Quarter Selector สำหรับ Dynamic Target ── */}
          <div className="px-3">
            <label className="text-xs text-zinc-500 block mb-1">ไตรมาส (เป้าหมาย)</label>
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value === 'all' ? 'all' : Number(e.target.value) as 1 | 2 | 3 | 4)}
              className="text-sm border-none bg-transparent font-medium text-zinc-900 focus:ring-0 p-0 cursor-pointer"
            >
              <option value="all">ภาพรวมทั้งปีงบประมาณ</option>
              <option value={1}>Q1 (ต.ค. - ธ.ค.)</option>
              <option value={2}>Q2 (ม.ค. - มี.ค.)</option>
              <option value={3}>Q3 (เม.ย. - มิ.ย.)</option>
              <option value={4}>Q4 (ก.ค. - ก.ย.)</option>
            </select>
          </div>

          <div className="h-8 w-px bg-zinc-200"></div>
          
          <div className="px-3">
            <label className="text-xs text-zinc-500 block mb-1">สถานบริการ</label>
            <select 
              value={selectedHosp} 
              onChange={(e) => setSelectedHosp(e.target.value)}
              disabled={!isAdmin}
              className={`text-sm border-none bg-transparent font-medium text-zinc-900 focus:ring-0 p-0 ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
            >
              {isAdmin && <option value="all">ภาพรวมอำเภอ (ทั้งหมด)</option>}
              {activeFacilities.length > 0 ? (
                activeFacilities.map(f => (
                  <option key={f.hoscode} value={f.hoscode}>{f.hosname}</option>
                ))
              ) : (
                <option value={selectedHosp}>{selectedHosp === 'all' ? (isLoading ? 'กำลังโหลด...' : 'ไม่มีข้อมูลสถานบริการ') : selectedHosp}</option>
              )}
            </select>
          </div>

          {(user?.role === 'admin' || user?.hoscode === '00588') && (
            <>
              <div className="h-8 w-px bg-zinc-200"></div>
              <button 
                onClick={() => refetch()}
                disabled={isLoading}
                className="p-2 text-zinc-500 hover:text-primary hover:bg-zinc-50 rounded-lg transition-colors disabled:opacity-50"
                title="รีเฟรชข้อมูล (ดึงใหม่แบบไม่ผ่าน Cache)"
              >
                <RefreshCwIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}

          <div className="h-8 w-px bg-zinc-200 mx-2"></div>
          <ExportButtonGroup onExportExcel={handleExportExcel} onExportPdf={handleExportPdf} />
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircleIcon className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold">เกิดข้อผิดพลาดในการดึงข้อมูล</h4>
            <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-96 w-full flex flex-col items-center justify-center text-zinc-400 bg-white rounded-xl shadow-sm border border-zinc-200">
          <RefreshCwIcon className="w-8 h-8 animate-spin mb-4" />
          <p>กำลังดึงข้อมูลจาก OpenData...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className={`grid grid-cols-1 ${allVaccinesData.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-1 max-w-4xl mx-auto'} gap-6 mb-8`}>
            {allVaccinesData.length >= 3 && (
              <div className="lg:col-span-1 h-full">
                <VaccineRadarChart data={allVaccinesData} goalTarget={radarTarget} />
              </div>
            )}
            <div className={allVaccinesData.length >= 3 ? "lg:col-span-2" : "col-span-1"}>
              <VaccineGaugeGrid data={allVaccinesData} goalTarget={radarTarget} />
            </div>
          </div>
          
          <div className="pt-8 border-t border-zinc-200 mt-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                <h3 className="text-xl font-bold text-zinc-900 tracking-tight">เจาะลึกรายวัคซีน</h3>
                <p className="text-sm text-zinc-500 mt-1">ดูแนวโน้มความครอบคลุมรายเดือนของแต่ละวัคซีน</p>
              </div>
              
              <div className="bg-white p-2 rounded-xl border border-zinc-200">
                <div className="px-3">
                  <label className="text-xs text-zinc-500 block mb-1">เลือกวัคซีนที่ต้องการดู</label>
                  <select 
                    value={vaccine} 
                    onChange={(e) => setVaccine(e.target.value)}
                    className="text-sm border-none bg-transparent font-medium text-zinc-900 focus:ring-0 p-0 cursor-pointer w-48"
                  >
                    {vaccineOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-white p-5 rounded-xl border border-zinc-200">
                <p className="text-sm text-zinc-500 font-medium">เป้าหมายรวม {selectedVaccineLabel} (คน)</p>
                <p className="text-3xl font-bold text-zinc-900 mt-1">{summary.target.toLocaleString()}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-zinc-200">
                <p className="text-sm text-zinc-500 font-medium">ได้รับวัคซีนครบถ้วน (คน)</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{summary.result.toLocaleString()}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-zinc-200 relative overflow-hidden">
                <p className="text-sm text-zinc-500 font-medium">ความครอบคลุมสะสม</p>
                <p className={`text-3xl font-bold mt-1 ${summary.coverage >= dynamicTarget ? 'text-green-600' : 'text-red-600'}`}>
                  {summary.coverage.toFixed(2)}%
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">เทียบเป้า {dynamicTarget}% (Q{quarter})</p>
                <div className={`absolute bottom-0 left-0 h-1 transition-all ${summary.coverage >= dynamicTarget ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${Math.min(summary.coverage, 100)}%` }}></div>
              </div>
            </div>

            <CoverageBarChart 
              data={chartData} 
              title={`ร้อยละความครอบคลุมวัคซีน ${selectedVaccineLabel} รายเดือน (อ้างอิง HDC OpenData)`} 
              targetLine={dynamicTarget}
            />
          </div>
        </div>
      )}
    </div>
  );
}
