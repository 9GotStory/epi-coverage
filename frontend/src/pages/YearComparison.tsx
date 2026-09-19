import { useState } from 'react';
import { useDashboardSummariesMultiYear } from '../shared/hooks/useDashboardSummariesMultiYear';
import { useDashboardSummaryYears } from '../shared/hooks/useDashboardSummaryYears';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../shared/components/ui/card';
import { getCurrentFiscalYear } from '../shared/utils/dateUtils';

export const YearComparison = () => {
  const currentYear = getCurrentFiscalYear();
  const [selectedYears, setSelectedYears] = useState<number[]>([currentYear - 1, currentYear]);
  const [ageGroup, setAgeGroup] = useState<string>('Epi_1_Year');
  
  const { data, isLoading, error } = useDashboardSummariesMultiYear(selectedYears);
  // Issue #22: comparison year options come from usable annual summaries for the
  // selected age group — not from the generic available-years source.
  const { tables: summaryYearsByTable } = useDashboardSummaryYears();
  const availableYears = summaryYearsByTable[ageGroup] ?? [];

  const handleYearToggle = (year: number) => {
    setSelectedYears(prev => 
      prev.includes(year) 
        ? prev.filter(y => y !== year)
        : [...prev, year].sort((a, b) => a - b)
    );
  };

  // Prepare chart data — a selected year without an annual summary stays null and is
  // surfaced as "ไม่มีข้อมูลสรุป"; it is never fabricated as 0 (0 is a valid real value).
  // Backend owns canonical annual precedence — no frontend updated_at sorting (Issue #22).
  const missingYears: number[] = [];
  const chartData = selectedYears.map(year => {
    const summaryItem = data.find(d => d.targetTable === ageGroup && Number(d.fiscalYear) === year) ?? null;
    const summaryData = summaryItem ? summaryItem.summaryData : null;
    if (!summaryData) missingYears.push(year);

    return {
      name: `ปี ${year}`,
      total: summaryData ? summaryData.total : null,
      passedV1: summaryData ? (summaryData.view1PassedDoses ?? null) : null,
      passedV2: summaryData ? summaryData.view2Passed : null,
      percentV1: typeof summaryData?.view1Coverage === 'number' ? summaryData.view1Coverage.toFixed(2) : null,
      percentV2: typeof summaryData?.view2Coverage === 'number' ? summaryData.view2Coverage.toFixed(2) : null,
    };
  });

  return (
    <div className="bg-slate-50 font-sans">
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">เปรียบเทียบความครอบคลุมวัคซีนข้ามปี</h1>
            <p className="text-slate-500 mt-1">วิเคราะห์แนวโน้มผลงานการให้บริการวัคซีนรายปีงบประมาณ</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={ageGroup} onValueChange={(val) => setAgeGroup(val)}>
              <SelectTrigger className="w-[180px] bg-white">
                <SelectValue placeholder="เลือกกลุ่มอายุ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Epi_1_Year">เด็กอายุ 1 ปี</SelectItem>
                <SelectItem value="Epi_2_Year">เด็กอายุ 2 ปี</SelectItem>
                <SelectItem value="Epi_3_Year">เด็กอายุ 3 ปี</SelectItem>
                <SelectItem value="Epi_5_Year">เด็กอายุ 5 ปี</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-8">
          <p className="text-sm font-medium text-slate-700 mb-3">เลือกปีงบประมาณที่ต้องการเปรียบเทียบ:</p>
          <div className="flex flex-wrap gap-2 mb-6">
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => handleYearToggle(year)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedYears.includes(year)
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ปี {year}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-2xl shadow-sm border border-slate-100">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg">
            {error}
          </div>
        ) : selectedYears.length === 0 ? (
          <div className="bg-amber-50 text-amber-700 p-4 rounded-lg text-center">
            กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล
          </div>
        ) : (
          <div className="space-y-6">
            {missingYears.length > 0 && (
              <div className="bg-amber-50 text-amber-700 p-4 rounded-lg" role="status">
                ไม่มีข้อมูลสรุป ปีงบประมาณ {missingYears.join(', ')} — ปีที่ไม่มีข้อมูลสรุปจะไม่ถูกนำมาแสดงเป็น 0%
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <Card className="shadow-sm border-slate-100">
              <CardHeader>
                <CardTitle className="text-lg">อัตราความครอบคลุมวัคซีน (View 2 - Fully Immunized)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} />
                      <Tooltip 
                        formatter={(value) => [`${value}%`, 'ความครอบคลุม']}
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                      />
                      <Legend wrapperStyle={{paddingTop: '20px'}} />
                      <Bar dataKey="percentV2" name="ความครอบคลุม (ร้อยละ)" fill="#0066cc" radius={[4, 4, 0, 0]} maxBarSize={60} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-100">
              <CardHeader>
                <CardTitle className="text-lg">จำนวนเด็กที่ได้รับวัคซีนครบถ้วน (คน)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip 
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                      />
                      <Legend wrapperStyle={{paddingTop: '20px'}} />
                      <Bar dataKey="total" name="เป้าหมายทั้งหมด" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="passedV2" name="ผ่านเกณฑ์" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            </div>
          </div>
        )}
      </main>
    </div>
  );
};
