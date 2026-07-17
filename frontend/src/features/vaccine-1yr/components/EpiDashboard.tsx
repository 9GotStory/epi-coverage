import { useState, useMemo, useEffect } from 'react';
import { SubNav } from '../../../widgets/layout/SubNav';
import { View1Individual } from './View1Individual';
import { View2FullyImmunized } from './View2FullyImmunized';
import { OpenDataDashboard } from '../../opendata/components/OpenDataDashboard';
import { useEpiData } from '../../../shared/hooks/useEpiData';

export function EpiDashboard() {
  const [activeTab, setActiveTab] = useState<'view1' | 'view2' | 'view3'>('view1');
  
  // Global Filters for Cohort
  const currentYear = new Date().getFullYear() + 543;
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const [quarter, setQuarter] = useState<number | 'all'>('all');

  const { data, isLoading, error, asOfDate } = useEpiData();

  const availableFiscalYears = useMemo(() => {
    const years = new Set<number>();
    data.forEach(record => {
      if (record.fiscal_year) {
        years.add(Number(record.fiscal_year));
      }
    });
    const sorted = Array.from(years).sort((a, b) => b - a);
    return sorted.length > 0 ? sorted : [currentYear];
  }, [data, currentYear]);

  useEffect(() => {
    if (availableFiscalYears.length > 0 && !availableFiscalYears.includes(fiscalYear)) {
      setFiscalYear(availableFiscalYears[0]);
    }
  }, [availableFiscalYears, fiscalYear]);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50/50">
      <SubNav title="EPI Tracking Dashboard (เด็ก 1 ปี)" />
      
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          {/* Apple-style Segmented Control */}
          <div className="bg-zinc-200/60 p-1 rounded-xl inline-flex relative shadow-inner">
            <button
              onClick={() => setActiveTab('view1')}
              className={`relative z-10 px-6 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
                activeTab === 'view1' 
                  ? 'text-zinc-900 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]' 
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              มุมมองที่ 1: ความครอบคลุมรายชนิด (17 รายการ)
            </button>
            <button
              onClick={() => setActiveTab('view2')}
              className={`relative z-10 px-6 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
                activeTab === 'view2'
                  ? 'text-zinc-900 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              มุมมองที่ 2: Fully Immunized (1 ปี)
            </button>
            <button
              onClick={() => setActiveTab('view3')}
              className={`relative z-10 px-6 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
                activeTab === 'view3'
                  ? 'text-zinc-900 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              มุมมองที่ 3: ภาพรวม (OpenData)
            </button>
          </div>
          
          {activeTab !== 'view3' && (
            <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500 font-medium">ปีงบประมาณ:</span>
            <select 
              value={fiscalYear}
              onChange={e => setFiscalYear(Number(e.target.value))}
              className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {availableFiscalYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            <span className="text-sm text-zinc-500 font-medium ml-2">ไตรมาส:</span>
            <select 
              value={quarter}
              onChange={e => setQuarter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="all">ภาพรวมทั้งปีงบประมาณ</option>
              <option value={1}>ไตรมาส 1 (ต.ค. - ธ.ค.)</option>
              <option value={2}>ไตรมาส 2 (ม.ค. - มี.ค.)</option>
              <option value={3}>ไตรมาส 3 (เม.ย. - มิ.ย.)</option>
              <option value={4}>ไตรมาส 4 (ก.ค. - ก.ย.)</option>
            </select>
          </div>
          )}
        </div>

        {/* Content Area */}
        <div className="bg-white rounded-2xl p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] ring-1 ring-zinc-200/50 min-h-[500px]">
          {activeTab === 'view1' && <View1Individual fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view2' && <View2FullyImmunized fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view3' && <OpenDataDashboard />}
        </div>

      </main>
    </div>
  );
}
