import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from 'recharts';

interface MonthlyPoint {
  name: string;
  target: number;
  result: number;
  coverage: number;
}

interface CumulativeCoverageChartProps {
  data: MonthlyPoint[];
  title: string;
  /** % เป้าหมาย — วาดเป็นเส้นประ ถ้าไม่ระบุจะไม่มีเส้นเป้า */
  targetLine?: number;
}

/** Tooltip แบบ crosshair: แสดงทั้งรายเดือนและยอดสะสม */
const CumulativeTooltip = ({ active, payload, targetLine }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const met = targetLine !== undefined && d.cumCoverage !== null && d.cumCoverage >= targetLine;
  return (
    <div className="bg-white p-3 border border-zinc-200 rounded-lg shadow-sm text-sm">
      <p className="font-semibold text-zinc-800 mb-2">{d.name}</p>
      <div className="space-y-1">
        <p className="text-zinc-500">ผลงานเดือนนี้: <span className="font-medium text-zinc-900">{d.result.toLocaleString()}</span> คน</p>
        <p className="text-zinc-500">สะสม: <span className="font-medium text-zinc-900">{d.cumResult.toLocaleString()}</span> / {d.cumTarget.toLocaleString()} คน</p>
        <p className="text-zinc-500 pt-2 mt-1 border-t border-zinc-100">
          ครอบคลุมสะสม:{' '}
          <span className={`font-bold ${d.cumCoverage === null ? 'text-zinc-400' : met ? 'text-green-600' : 'text-red-600'}`}>
            {d.cumCoverage === null ? 'ไม่มีเป้าหมาย' : `${d.cumCoverage.toFixed(2)}%`}
          </span>
          {targetLine !== undefined && d.cumCoverage !== null && <span className="text-zinc-400"> (เป้า {targetLine}%)</span>}
        </p>
      </div>
    </div>
  );
};

/**
 * เส้นแนวโน้มความครอบคลุม "สะสม" รายเดือน (YTD) เทียบเส้นเป้าหมาย
 * — งานของข้อมูลคือดูว่า "กำลังไปถึงเป้าไหม" จึงใช้เส้นสะสมแทน % รายเดือนที่กระโดด
 *    ซีรีส์เดียว → ไม่ต้องมี legend (ชื่ออยู่ในหัวเรื่อง) + ป้ายค่าจุดสุดท้ายแบบ direct label
 */
export function CumulativeCoverageChart({ data, title, targetLine }: CumulativeCoverageChartProps) {
  const rows = useMemo(() => {
    let cumTarget = 0;
    let cumResult = 0;
    return data.map(month => {
      cumTarget += month.target;
      cumResult += month.result;
      return {
        ...month,
        cumTarget,
        cumResult,
        cumCoverage: cumTarget > 0 ? parseFloat(((cumResult / cumTarget) * 100).toFixed(2)) : null,
      };
    });
  }, [data]);

  const lastPoint = useMemo(() => [...rows].reverse().find(row => row.cumCoverage !== null), [rows]);
  const lastCoverage = lastPoint?.cumCoverage ?? null;

  return (
    <div className="w-full h-80 bg-white p-4 rounded-xl border border-zinc-200">
      <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
      <p className="text-xs text-zinc-400 mt-0.5 mb-2">เส้นสะสมตั้งแต่ต้นปีงบประมาณ{targetLine !== undefined ? ` · เส้นประ = เป้า ${targetLine}%` : ''}</p>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={rows} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cumCoverageFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E4E4E7" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#71717A' }} axisLine={{ stroke: '#E4E4E7' }} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 12, fill: '#71717A' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<CumulativeTooltip targetLine={targetLine} />} />
          {targetLine !== undefined && (
            <ReferenceLine
              y={targetLine}
              stroke="#EF4444"
              strokeDasharray="6 4"
              label={{ position: 'insideTopLeft', value: `เป้า ${targetLine}%`, fill: '#DC2626', fontSize: 12 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="cumCoverage"
            stroke="#2563EB"
            strokeWidth={2}
            fill="url(#cumCoverageFill)"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          />
          {lastPoint && lastCoverage !== null && (
            <ReferenceDot
              x={lastPoint.name}
              y={lastCoverage}
              r={3.5}
              fill="#2563EB"
              stroke="#fff"
              strokeWidth={2}
              label={{ position: 'top', value: `${lastCoverage.toFixed(1)}%`, fill: '#1D4ED8', fontSize: 12, fontWeight: 600 }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
