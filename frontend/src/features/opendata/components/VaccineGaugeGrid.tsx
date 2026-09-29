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
  goalTarget?: number; // Optional: never invent a default for an unconfigured target.
}

export function VaccineGaugeGrid({ data, goalTarget }: VaccineGaugeGridProps) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {data.map((item) => {
        // The vaccine's own View 1 goal takes precedence. Missing goal or
        // denominator is neutral, never implicitly a failed target.
        const targetToUse = item.goal ?? goalTarget;
        const hasTarget = targetToUse !== undefined && Number.isFinite(targetToUse);
        const hasCoverage = Number.isFinite(item.target) && item.target > 0 && Number.isFinite(item.coverage);
        const isTargetMet = hasTarget && hasCoverage && item.coverage >= targetToUse;
        const color = !hasTarget || !hasCoverage ? '#A1A1AA' : isTargetMet ? '#10B981' : '#EF4444';
        
        const chartData = [
          { name: item.label, value: hasCoverage ? Math.max(0, Math.min(item.coverage, 100)) : 0, fill: color }
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
                <span className={`text-lg font-bold ${!hasTarget || !hasCoverage ? 'text-zinc-500' : isTargetMet ? 'text-green-600' : 'text-red-600'}`}>
                  {hasCoverage ? `${item.coverage.toFixed(0)}%` : '—'}
                </span>
              </div>
            </div>
            
            <div className="mt-3 text-center">
              <p className="text-xs text-zinc-500">ผลงาน / เป้าหมาย</p>
              <p className="text-sm font-medium text-zinc-800">
                {item.result.toLocaleString()} <span className="text-zinc-400">/</span> {item.target.toLocaleString()}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {hasTarget ? `เป้า ${targetToUse}%` : 'ยังไม่ได้กำหนดเป้าหมาย'}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
