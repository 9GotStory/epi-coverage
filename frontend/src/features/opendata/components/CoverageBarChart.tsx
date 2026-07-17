import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts';

interface ChartData {
  name: string;
  target: number;
  result: number;
  coverage: number;
}

interface CoverageBarChartProps {
  data: ChartData[];
  title?: string;
  targetLine?: number; // % เป้าหมาย (default: 90)
}

const CHART_MARGIN = { top: 20, right: 30, left: 0, bottom: 0 };

function pctTickFormatter(val: number) {
  return `${val}%`;
}

// Custom Tooltip component to show all data
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-zinc-200 rounded-lg shadow-sm text-sm">
        <p className="font-semibold text-zinc-800 mb-2">{label}</p>
        <div className="space-y-1">
          <p className="text-zinc-500">เป้าหมาย: <span className="font-medium text-zinc-900">{data.target}</span> คน</p>
          <p className="text-zinc-500">ผลงาน: <span className="font-medium text-blue-600">{data.result}</span> คน</p>
          <p className="text-zinc-500 mt-2 pt-2 border-t border-zinc-100">
            ความครอบคลุม: <span className={`font-bold ${data.coverage >= 90 ? 'text-green-600' : 'text-red-600'}`}>{data.coverage}%</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export function CoverageBarChart({ data, title, targetLine = 90 }: CoverageBarChartProps) {
  const referenceLabel = useMemo(
    () => ({ position: 'top' as const, value: `เป้า ${targetLine}%`, fill: '#EF4444', fontSize: 12 }),
    [targetLine],
  );

  return (
    <div className="w-full h-80 bg-white p-4 rounded-xl border border-zinc-200">
      {title && <h3 className="text-lg font-semibold text-zinc-800 mb-4 text-center">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#71717A', fontSize: 12 }}
            axisLine={{ stroke: '#E4E4E7' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={pctTickFormatter}
            stroke="#71717A"
            tick={{ fill: '#71717A', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />

          <ReferenceLine
            y={targetLine}
            stroke="#EF4444"
            strokeDasharray="3 3"
            label={referenceLabel}
          />

          <Bar dataKey="coverage" name="ความครอบคลุม" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.coverage >= targetLine ? '#10B981' : '#F59E0B'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
