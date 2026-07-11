import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface ChartData {
  name: string;
  target: number;
  result: number;
  coverage: number;
}

interface CoverageBarChartProps {
  data: ChartData[];
  title?: string;
}

export function CoverageBarChart({ data, title }: CoverageBarChartProps) {
  return (
    <div className="w-full h-80 bg-white p-4 rounded-xl border border-zinc-200">
      {title && <h3 className="text-lg font-semibold text-zinc-800 mb-4 text-center">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
          <XAxis 
            dataKey="name" 
            tick={{ fill: '#71717A', fontSize: 12 }} 
            axisLine={{ stroke: '#E4E4E7' }} 
            tickLine={false} 
          />
          <YAxis 
            yAxisId="left" 
            orientation="left" 
            stroke="#71717A"
            tick={{ fill: '#71717A', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis 
            yAxisId="right" 
            orientation="right" 
            domain={[0, 100]} 
            tickFormatter={(val) => `${val}%`}
            stroke="#10B981"
            tick={{ fill: '#10B981', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            formatter={(value: any, name: any) => {
              if (name === 'coverage') return [`${value}%`, 'ความครอบคลุม'];
              if (name === 'target') return [value, 'เป้าหมาย'];
              if (name === 'result') return [value, 'ผลงาน'];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          
          <ReferenceLine y={90} yAxisId="right" stroke="#EF4444" strokeDasharray="3 3" label={{ position: 'top', value: 'เป้า 90%', fill: '#EF4444', fontSize: 12 }} />
          
          <Bar yAxisId="left" dataKey="target" name="เป้าหมาย (คน)" fill="#CBD5E1" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Bar yAxisId="left" dataKey="result" name="ผลงาน (คน)" fill="#0066CC" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Bar yAxisId="right" dataKey="coverage" name="ความครอบคลุม (%)" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
