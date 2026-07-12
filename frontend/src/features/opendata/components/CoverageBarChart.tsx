import { useMemo } from 'react';
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  createHorizontalChart,
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

const Typed = createHorizontalChart<ChartData, string, number>()({
  XAxis,
  YAxis,
  Bar,
});

// Static style objects ที่ไม่เปลี่ยนแปลง — วางนอก component เพื่อป้องกัน
// object identity เปลี่ยนทุก render (Recharts มักทำ shallow compare)
const TOOLTIP_STYLE = {
  borderRadius: '8px',
  border: 'none',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
};
const LEGEND_STYLE = { paddingTop: '20px' };
const CHART_MARGIN = { top: 10, right: 30, left: 0, bottom: 0 };

// Formatter ที่ไม่ขึ้นกับ props → ย้ายออกนอก component
function tooltipFormatter(value: number | string, name: string): [string | number, string] {
  if (name === 'coverage') return [`${value}%`, 'ความครอบคลุม'];
  if (name === 'target') return [value, 'เป้าหมาย'];
  if (name === 'result') return [value, 'ผลงาน'];
  return [value, name];
}

function pctTickFormatter(val: number) {
  return `${val}%`;
}

export function CoverageBarChart({ data, title, targetLine = 90 }: CoverageBarChartProps) {
  // ✅ Memoize label object เพื่อป้องกัน Recharts re-render เกินจำเป็น
  // (Recharts ตรวจ identity ของ label prop ใน ReferenceLine)
  const referenceLabel = useMemo(
    () => ({ position: 'top' as const, value: `เป้า ${targetLine}%`, fill: '#EF4444', fontSize: 12 }),
    [targetLine],
  );

  return (
    <div className="w-full h-80 bg-white p-4 rounded-xl border border-zinc-200">
      {title && <h3 className="text-lg font-semibold text-zinc-800 mb-4 text-center">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <Typed.BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
          <Typed.XAxis
            dataKey="name"
            tick={{ fill: '#71717A', fontSize: 12 }}
            axisLine={{ stroke: '#E4E4E7' }}
            tickLine={false}
          />
          <Typed.YAxis
            yAxisId="left"
            orientation="left"
            stroke="#71717A"
            tick={{ fill: '#71717A', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Typed.YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={pctTickFormatter}
            stroke="#10B981"
            tick={{ fill: '#10B981', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
          <Legend wrapperStyle={LEGEND_STYLE} />

          <ReferenceLine
            y={targetLine}
            yAxisId="right"
            stroke="#EF4444"
            strokeDasharray="3 3"
            label={referenceLabel}
          />

          <Typed.Bar yAxisId="left" dataKey="target" name="เป้าหมาย (คน)" fill="#CBD5E1" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Typed.Bar yAxisId="left" dataKey="result" name="ผลงาน (คน)" fill="#0066CC" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Typed.Bar yAxisId="right" dataKey="coverage" name="ความครอบคลุม (%)" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </Typed.BarChart>
      </ResponsiveContainer>
    </div>
  );
}
