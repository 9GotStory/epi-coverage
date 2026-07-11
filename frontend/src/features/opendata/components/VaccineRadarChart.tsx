import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { type VaccineCoverageData } from './VaccineGaugeGrid';

interface VaccineRadarChartProps {
  data: VaccineCoverageData[];
}

export function VaccineRadarChart({ data }: VaccineRadarChartProps) {
  return (
    <div className="bg-white p-6 rounded-xl border border-zinc-200 h-96 flex flex-col items-center justify-center relative">
      <h3 className="text-lg font-semibold text-zinc-800 mb-2 absolute top-6 left-6">
        ความครอบคลุมวัคซีนรวมทุกชนิด
      </h3>
      
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="55%" outerRadius="70%" data={data}>
          <PolarGrid strokeDasharray="3 3" />
          <PolarAngleAxis 
            dataKey="label" 
            tick={{ fill: '#4F46E5', fontSize: 13, fontWeight: 500 }} 
          />
          <PolarRadiusAxis 
            angle={90} 
            domain={[0, 100]} 
            tick={{ fill: '#A1A1AA', fontSize: 11 }} 
            tickCount={6}
          />
          <Radar 
            name="ผลงานปัจจุบัน (%)" 
            dataKey="coverage" 
            stroke="#0066CC" 
            fill="#0066CC" 
            fillOpacity={0.6} 
          />
          <Radar 
            name="เป้าหมาย (90%)" 
            dataKey="goal" 
            stroke="#EF4444" 
            fill="none" 
            strokeDasharray="5 5" 
            strokeWidth={2}
          />
          <Tooltip 
            formatter={(value: any, name: any) => [`${Number(value).toFixed(1)}%`, name]}
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Legend wrapperStyle={{ bottom: 0 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
