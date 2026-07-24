import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';

export interface VaccineCoverageData {
  vaccine: string;
  label: string;
  target: number;
  result: number;
  coverage: number;
  goal?: number;
}

interface VaccineGaugeGridProps {
  data: VaccineCoverageData[];
  goalTarget?: number; // % เป้าหมาย (default: 90) — ใช้เทียบสีเขียว/แดง
}

export function VaccineGaugeGrid({ data, goalTarget = 90 }: VaccineGaugeGridProps) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {data.map((item) => {
        // ✅ ใช้เป้าหมายเฉพาะวัคซีน (item.goal) หรือเป้าหมายรวมถ้าไม่ได้กำหนด
        const targetToUse = item.goal || goalTarget;
        const isTargetMet = item.coverage >= targetToUse;
        const color = isTargetMet ? '#10B981' : '#EF4444'; // Success Green vs Danger Red
        
        const chartData = [
          { name: item.label, value: item.coverage, fill: color }
        ];

        return (
          <div key={item.vaccine} className="bg-white p-4 rounded-xl border border-zinc-200 flex flex-col items-center w-full sm:w-[48%] md:w-[160px]">
            <h4 className="text-sm font-semibold text-zinc-700 text-center h-10 flex items-center justify-center">
              {item.label}
            </h4>
            
            <div className="w-24 h-24 relative mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart 
                  innerRadius="70%" 
                  outerRadius="100%" 
                  data={chartData} 
                  startAngle={90} 
                  endAngle={-270}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar 
                    background={{ fill: '#F4F4F5' }}
                    dataKey="value" 
                    cornerRadius={10} 
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className={`text-lg font-bold ${isTargetMet ? 'text-green-600' : 'text-red-600'}`}>
                  {item.coverage.toFixed(0)}%
                </span>
              </div>
            </div>
            
            <div className="mt-3 text-center">
              <p className="text-xs text-zinc-500">ผลงาน / เป้าหมาย</p>
              <p className="text-sm font-medium text-zinc-800">
                {item.result.toLocaleString()} <span className="text-zinc-400">/</span> {item.target.toLocaleString()}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">เป้า {targetToUse}%</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
