import { useState, useEffect } from 'react';
import { SubNav } from '../../../widgets/layout/SubNav';
import { View1Individual3Yr } from './View1Individual3Yr';
import { View2FullyImmunized3Yr } from './View2FullyImmunized3Yr';
import { OpenDataDashboard } from '../../opendata/components/OpenDataDashboard';
import { useEpiData } from '../../../shared/hooks/useEpiData';
import { useAvailableYears } from '../../../shared/hooks/useAvailableYears';
import { useVaccineRules } from '../../../shared/hooks/useVaccineRules';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';

export function EpiDashboard3Yr() {
  const [activeTab, setActiveTab] = useState<'view1' | 'view2' | 'view3'>('view1');
  
  // Global Filters for Cohort
  const currentYear = getCurrentFiscalYear();
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const [quarter, setQuarter] = useState<number | 'all'>('all');

  const { data, isLoading, error, asOfDate } = useEpiData('Epi_3_Year', fiscalYear);
  const { years: availableFiscalYears } = useAvailableYears();
  const { rules } = useVaccineRules(fiscalYear, '3yr');
  const v1RulesCount = rules && rules.length > 0 ? rules.filter(r => r.view_type === 1 && r.is_active).length : 1;

  useEffect(() => {
    if (availableFiscalYears.length > 0 && !availableFiscalYears.includes(fiscalYear)) {
      setFiscalYear(availableFiscalYears[0]);
    }
  }, [availableFiscalYears, fiscalYear]);

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f5f7]">
      <SubNav title="EPI Tracking Dashboard (เด็ก 3 ปี)" />
      
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-8">
        
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          {/* Apple-style Segmented Control */}
          <div className="bg-[#e3e3e8] p-1 rounded-xl inline-flex relative">
            <button
              onClick={() => setActiveTab('view1')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view1' 
                  ? 'text-[#1d1d1f] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]' 
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              มุมมองที่ 1: ความครอบคลุมรายชนิด ({v1RulesCount} รายการ)
            </button>
            <button
              onClick={() => setActiveTab('view2')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view2'
                  ? 'text-[#1d1d1f] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              มุมมองที่ 2: Fully Immunized (3 ปี)
            </button>
            <button
              onClick={() => setActiveTab('view3')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view3'
                  ? 'text-[#1d1d1f] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              มุมมองที่ 3: ภาพรวม (OpenData)
            </button>
          </div>
          
          {activeTab !== 'view3' && (
            <div className="flex items-center gap-2">
            <span className="text-[14px] text-[#7a7a7a] font-medium tracking-[-0.224px]">ปีงบประมาณ:</span>
            <select 
              value={fiscalYear}
              onChange={e => setFiscalYear(Number(e.target.value))}
              className="px-3 py-1.5 bg-white border border-[#e0e0e0] rounded-lg text-[14px] text-[#1d1d1f] focus:ring-2 focus:ring-[#0066cc] focus:border-[#0066cc] focus:outline-none transition-colors"
            >
              {availableFiscalYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            <span className="text-[14px] text-[#7a7a7a] font-medium tracking-[-0.224px] ml-3">ไตรมาส:</span>
            <select 
              value={quarter}
              onChange={e => setQuarter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-3 py-1.5 bg-white border border-[#e0e0e0] rounded-lg text-[14px] text-[#1d1d1f] focus:ring-2 focus:ring-[#0066cc] focus:border-[#0066cc] focus:outline-none transition-colors"
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
        <div className="bg-white rounded-[24px] p-8 border border-[#e0e0e0] min-h-[600px]">
          {activeTab === 'view1' && <View1Individual3Yr fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view2' && <View2FullyImmunized3Yr fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view3' && <OpenDataDashboard targetTable="s_epi3" />}
        </div>

      </main>
    </div>
  );
}
