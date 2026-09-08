
import { useState, useEffect } from 'react';
import { SubNav } from '../../../widgets/layout/SubNav';
import { OpenDataDashboard } from '../../opendata/components/OpenDataDashboard';
import { useEpiData } from '../../../shared/hooks/useEpiData';
import { useAvailableYears } from '../../../shared/hooks/useAvailableYears';
import { View1Individual } from './View1Individual';
import { HdcRecordsView } from '../../../shared/components/HdcRecordsView';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../shared/components/ui/select';

export function EpiDashboard() {
  const [activeTab, setActiveTab] = useState<'view1' | 'view2' | 'view3'>('view1');
  
  // Global Filters for Cohort
  const currentYear = getCurrentFiscalYear();
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const [quarter, setQuarter] = useState<number | 'all'>('all');

  const { data, isLoading, error, asOfDate } = useEpiData('Epi_1_Year', fiscalYear);
  const { years: availableFiscalYears } = useAvailableYears();

  // Remove old availableFiscalYears logic

  useEffect(() => {
    if (availableFiscalYears.length > 0 && !availableFiscalYears.includes(fiscalYear)) {
      setFiscalYear(availableFiscalYears[0]);
    }
  }, [availableFiscalYears, fiscalYear]);

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f5f7]">
      <SubNav title="EPI Tracking Dashboard (เด็ก 1 ปี)" />
      
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-8">
        
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          {/* Apple-style Segmented Control */}
          <div className="bg-[#e3e3e8] p-1 rounded-xl inline-flex flex-wrap relative">
            <button
              onClick={() => setActiveTab('view1')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view1' 
                  ? 'text-[#1d1d1f] bg-white'
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              มุมมองที่ 1 (รายชนิดวัคซีน)
            </button>
            <button
              onClick={() => setActiveTab('view2')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view2'
                  ? 'text-[#1d1d1f] bg-white'
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              มุมมองที่ 2 (Fully Immunized)
            </button>
            <button
              onClick={() => setActiveTab('view3')}
              className={`relative z-10 px-6 py-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all duration-300 ${
                activeTab === 'view3'
                  ? 'text-[#1d1d1f] bg-white'
                  : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              }`}
            >
              ภาพรวม (OpenData)
            </button>
          </div>
          
          {activeTab !== 'view3' && (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-[#7a7a7a] font-medium tracking-[-0.224px] whitespace-nowrap">ปีงบประมาณ:</span>
                <Select 
                  value={fiscalYear.toString()} 
                  onValueChange={val => setFiscalYear(Number(val))}
                >
                  <SelectTrigger className="w-[120px] bg-white h-[34px] text-[14px]">
                    <SelectValue placeholder="เลือกปีงบประมาณ" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFiscalYears.map(year => (
                      <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[14px] text-[#7a7a7a] font-medium tracking-[-0.224px] whitespace-nowrap">ไตรมาส:</span>
                <Select 
                  value={quarter.toString()} 
                  onValueChange={val => setQuarter(val === 'all' ? 'all' : Number(val))}
                >
                  <SelectTrigger className="w-[200px] bg-white h-[34px] text-[14px]">
                    <SelectValue placeholder="เลือกไตรมาส" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ภาพรวมทั้งปีงบประมาณ</SelectItem>
                    <SelectItem value="1">ไตรมาส 1 (ต.ค. - ธ.ค.)</SelectItem>
                    <SelectItem value="2">ไตรมาส 2 (ม.ค. - มี.ค.)</SelectItem>
                    <SelectItem value="3">ไตรมาส 3 (เม.ย. - มิ.ย.)</SelectItem>
                    <SelectItem value="4">ไตรมาส 4 (ก.ค. - ก.ย.)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="bg-white rounded-[24px] p-4 sm:p-8 border border-[#e0e0e0] min-h-[600px]">
          {activeTab === 'view1' && <View1Individual fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view2' && <HdcRecordsView key={`${fiscalYear}-${quarter}`} age={1} fiscalYear={fiscalYear} quarter={quarter} data={data} isLoading={isLoading} error={error} asOfDate={asOfDate} />}
          {activeTab === 'view3' && <OpenDataDashboard />}
        </div>

      </main>
    </div>
  );
}
