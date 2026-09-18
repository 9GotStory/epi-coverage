import { useFacilities } from '../../../shared/hooks/useFacilities';
import { useState, useMemo } from 'react';
import { useOpenData } from '../hooks/useOpenData';
import { CumulativeCoverageChart } from './CumulativeCoverageChart';
import { formatEpiDataForChart, formatEpiAllVaccines, formatCompleteDataForChart } from '../utils/chartUtils';
import { VaccineGaugeGrid } from './VaccineGaugeGrid';
import { VaccineRadarChart } from './VaccineRadarChart';
import { RefreshCwIcon, AlertCircleIcon, DatabaseIcon, ListIcon, ShieldCheckIcon } from 'lucide-react';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { forceSyncOpenData } from '../api/openDataApi';
import { useTargetSettings } from '../../../shared/hooks/useTargetSettings';
import { useAvailableYears } from '../../../shared/hooks/useAvailableYears';
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


  const completeIdMap: Record<string, string> = {
    's_epi1': '28dd2c7955ce926456240b2ff0100bde',
    's_epi2': '35f4a8d465e6e1edc05f3d8ab658c551',
    's_epi3': 'd1fe173d08e959397adf34b1d77e88d7',
    's_epi5': 'f033ab37c30201f73f142449d037028d'
  };

export function OpenDataDashboard({ targetTable = 's_epi1' }: OpenDataDashboardProps) {
  const { user } = useAuth();
  const { getTarget } = useTargetSettings();
  
  // Calculate current fiscal year and generate options
  const currentFY = getCurrentFiscalYear();
  const { years: availableYears } = useAvailableYears();
  const [year, setYear] = useState(currentFY);
  const [province] = useState('54'); // แพร่
  const isEpi1 = targetTable === 's_epi1';
  const isEpi3 = targetTable === 's_epi3';
  const isEpi5 = targetTable === 's_epi5';
  const [vaccine, setVaccine] = useState(isEpi1 ? 'bcg' : (isEpi3 ? 'je3' : (isEpi5 ? 'dtp5' : 'dtp4')));
  const [quarter, setQuarter] = useState<1|2|3|4|'all'>('all');
  const [viewMode, setViewMode] = useState<'individual' | 'complete'>('individual');
  const [isSyncing, setIsSyncing] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.hoscode === '00588';
  const { data: facilities = [] } = useFacilities();
  const [selectedHosp, setSelectedHosp] = useState<string>(isAdmin ? 'all' : (user?.hoscode || 'all'));

  // Use dynamically fetched years instead of hardcoded 5 years
  const yearOptions = availableYears.map(y => y.toString());

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
    tableName: viewMode === 'complete' ? 's_epi_complete' : targetTable,
    year,
    province
  });

  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const filteredData = selectedHosp === 'all' 
      ? data.filter(d => d.areacode && String(d.areacode).startsWith('5406'))
      : data.filter(d => d.hospcode === selectedHosp);

    if (viewMode === 'complete') {
      const filterId = completeIdMap[targetTable];
      return formatCompleteDataForChart(filteredData, filterId);
    }
    return formatEpiDataForChart(filteredData, vaccine);
  }, [data, selectedHosp, vaccine, viewMode, targetTable]);

  // Aggregate stats for gauge and radar (ALL vaccines)
  const allVaccinesData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const filteredData = selectedHosp === 'all' 
      ? data.filter(d => d.areacode && String(d.areacode).startsWith('5406'))
      : data.filter(d => d.hospcode === selectedHosp);
    
    if (viewMode === 'complete') {
      const filterId = completeIdMap[targetTable];
      const monthlyData = formatCompleteDataForChart(filteredData, filterId);
      const totalTarget = monthlyData.reduce((sum: number, item: any) => sum + item.target, 0);
      const totalResult = monthlyData.reduce((sum: number, item: any) => sum + item.result, 0);
      const coverage = totalTarget > 0 ? (totalResult / totalTarget) * 100 : 0;
      
      return [{
        vaccine: 'complete',
        label: 'รับวัคซีนครบชุด (Fully Immunized)',
        target: totalTarget,
        result: totalResult,
        coverage: parseFloat(coverage.toFixed(2)),
        goal: getTarget(quarter, 2, undefined, Number(year)) // Use View 2 target
      }];
    }
    
    return formatEpiAllVaccines(filteredData, targetTable).map(item => {
      const vaccineKeyForTarget = item.vaccine === 'mmr' || item.vaccine === 'mmr1' || item.vaccine === 'mmr2' ? 'mmr' : item.vaccine;
      return {
        ...item,
        goal: getTarget(quarter, 1, vaccineKeyForTarget, Number(year))
      };
    });
  }, [data, selectedHosp, targetTable, quarter, getTarget, year, viewMode]);

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
      const fac = facilities.find((f: any) => f.hoscode === code);
      return {
        hoscode: code,
        hosname: fac ? fac.hosname : code
      };
    })
    .sort((a, b) => a.hosname.localeCompare(b.hosname));

  const selectedVaccineLabel = viewMode === 'complete' ? 'รับวัคซีนครบชุด (Fully Immunized)' : (vaccineOptions.find(v => v.value === vaccine)?.label || vaccine);

  // คำนวณเป้าหมายแบบ Dynamic ตามไตรมาส + ชนิดวัคซีน (มุมมอง 1 = view1)
  const vaccineKeyForTarget = vaccine === 'mmr' || vaccine === 'mmr1' || vaccine === 'mmr2' ? 'mmr' : undefined;
  const dynamicTarget = getTarget(quarter, viewMode === 'complete' ? 2 : 1, viewMode === 'complete' ? undefined : vaccineKeyForTarget, Number(year));
  // เป้าหมายสำหรับ Radar (ใช้ค่าพื้นฐานของไตรมาส ไม่แยกวัคซีน)
  const radarTarget = getTarget(quarter, 1, undefined, Number(year));

  // สำหรับ Hero KPI (tab ครบชุด): สถานะเทียบเป้า + เดือนล่าสุดที่มีข้อมูล
  const heroMet = dynamicTarget !== undefined && summary.coverage >= dynamicTarget;
  const lastActiveMonth = [...chartData].reverse().find((m: any) => m.target > 0 || m.result > 0)?.name as string | undefined;

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
            ความครอบคลุมการได้รับวัคซีนตามเกณฑ์ในเด็ก อายุครบ {isEpi1 ? '1' : (isEpi3 ? '3' : (isEpi5 ? '5' : '2'))} ปี {viewMode === 'complete' ? 'แบบรับวัคซีนครบชุด' : 'แบบแยกรายชนิด'} (ดึงข้อมูลจาก HDC OpenData) <br/>
            <span className="text-blue-600 font-medium">* หมายเหตุ: ข้อมูลสถิติในหน้านี้ใช้เกณฑ์การประเมินแบบเดียวกับ "{viewMode === 'complete' ? 'มุมมองที่ 2' : 'มุมมองที่ 1'}"</span>
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
                onClick={async () => {
                  try {
                    setIsSyncing(true);
                    await forceSyncOpenData();
                    await refetch();
                  } catch (e) {
                    console.error("Sync failed:", e);
                    alert("ซิงค์ข้อมูลล้มเหลว กรุณาลองใหม่");
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                disabled={isLoading || isSyncing}
                className="p-2 text-zinc-500 hover:text-primary hover:bg-zinc-50 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
                title="ดึงข้อมูลจากกระทรวงใหม่ล่าสุด"
              >
                <RefreshCwIcon className={`w-5 h-5 ${(isLoading || isSyncing) ? 'animate-spin' : ''}`} />
                {isSyncing ? 'กำลังซิงค์ (ใช้เวลาประมาณ 10-20 วินาที)...' : 'ซิงค์ข้อมูลใหม่'}
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

      
        <div className="flex bg-zinc-100 p-1 rounded-lg mb-6 w-fit">
          <button
            onClick={() => setViewMode('individual')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'individual' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <ListIcon className="w-4 h-4" />
            รายชนิดวัคซีน (View 1)
          </button>
          <button
            onClick={() => setViewMode('complete')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'complete' ? 'bg-white shadow-sm text-primary' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <ShieldCheckIcon className="w-4 h-4" />
            รับวัคซีนครบชุด (View 2)
          </button>
        </div>

      {isLoading ? (
        <div className="h-96 w-full flex flex-col items-center justify-center text-zinc-400 bg-white rounded-xl shadow-sm border border-zinc-200">
          <RefreshCwIcon className="w-8 h-8 animate-spin mb-4" />
          <p>กำลังดึงข้อมูลจาก OpenData...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {viewMode === 'complete' ? (
            /* ── Hero KPI: ตัวเลขเดี่ยวเป็นพระเอกของ tab รับวัคซีนครบชุด ── */
            <div className="bg-white p-6 rounded-xl border border-zinc-200">
              <div className="flex flex-col lg:flex-row lg:items-center gap-8">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-500 font-medium">ความครอบคลุมรับวัคซีนครบชุด (สะสม{lastActiveMonth ? `ถึง ${lastActiveMonth}` : ''})</p>
                  <p className={`text-5xl font-bold tracking-tight mt-1 ${heroMet ? 'text-green-600' : 'text-red-600'}`}>
                    {summary.coverage.toFixed(2)}%
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {dynamicTarget !== undefined
                      ? `เทียบเป้า ${dynamicTarget}% · ${heroMet ? 'ผ่านเป้าหมายแล้ว' : `ยังขาดอีก ${(dynamicTarget - summary.coverage).toFixed(1)} จุด`}`
                      : 'ยังไม่ได้กำหนดเป้าหมาย'}
                  </p>
                  <div className="relative h-2 bg-zinc-100 rounded-full mt-4">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${heroMet ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(summary.coverage, 100)}%` }}
                    />
                    {dynamicTarget !== undefined && dynamicTarget > 0 && (
                      <div className="absolute -top-1 h-4 w-0.5 bg-zinc-400 rounded" style={{ left: `${Math.min(dynamicTarget, 100)}%` }} title={`เป้า ${dynamicTarget}%`} />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 lg:grid-cols-1 lg:gap-3 lg:text-right lg:border-l lg:pl-8 min-w-0">
                  <div>
                    <p className="text-xs text-zinc-400 font-medium">เป้าหมายรวม (คน)</p>
                    <p className="text-2xl font-bold text-zinc-900 mt-0.5">{summary.target.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 font-medium">ได้รับครบชุด (คน)</p>
                    <p className="text-2xl font-bold text-blue-600 mt-0.5">{summary.result.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 font-medium">ยังขาดอีก (คน)</p>
                    <p className="text-2xl font-bold text-amber-600 mt-0.5">{Math.max(0, summary.target - summary.result).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
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
          )}
          
          <div className="pt-8 border-t border-zinc-200 mt-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                <h3 className="text-xl font-bold text-zinc-900 tracking-tight">{viewMode === 'complete' ? 'แนวโน้มรายเดือน' : 'เจาะลึกรายวัคซีน'}</h3>
                <p className="text-sm text-zinc-500 mt-1">{viewMode === 'complete' ? 'ความครอบคลุมสะสมของการรับวัคซีนครบชุด' : 'ดูแนวโน้มความครอบคลุมสะสมของแต่ละวัคซีน'}</p>
              </div>
              
              {viewMode === 'individual' && (
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
              )
            }
            </div>

            {viewMode === 'individual' && (
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
                <p className={`text-3xl font-bold mt-1 ${dynamicTarget !== undefined && summary.coverage >= dynamicTarget ? 'text-green-600' : (dynamicTarget !== undefined ? 'text-red-600' : 'text-zinc-600')}`}>
                  {summary.coverage.toFixed(2)}%
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">เทียบเป้า {dynamicTarget !== undefined ? `${dynamicTarget}%` : 'ยังไม่ได้กำหนดเป้าหมาย'} (Q{quarter})</p>
                <div className={`absolute bottom-0 left-0 h-1 transition-all ${dynamicTarget !== undefined && summary.coverage >= dynamicTarget ? 'bg-green-500' : (dynamicTarget !== undefined ? 'bg-red-500' : 'bg-zinc-300')}`} style={{ width: `${Math.min(summary.coverage, 100)}%` }}></div>
              </div>
            </div>
            )}

            <CumulativeCoverageChart
              data={chartData}
              title={`แนวโน้มความครอบคลุมสะสม ${viewMode === 'complete' ? 'รับวัคซีนครบชุด' : `วัคซีน ${selectedVaccineLabel}`} (อ้างอิง HDC OpenData)`}
              targetLine={dynamicTarget}
            />
          </div>
        </div>
      )}
    </div>
  );
}
