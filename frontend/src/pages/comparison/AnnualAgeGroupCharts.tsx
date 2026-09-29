import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatDateTimeStr } from '../../shared/utils/dateUtils';
import type { AnnualComparisonAgeGroup, AnnualComparisonPoint, ComparisonView } from './model';

/**
 * Ticket #48: chart-first, read-only presentation of *stored* annual summaries.
 * Parent controls the selected FYs / target authority; this component has no
 * network access and never changes evaluation logic or computes new coverage.
 */
interface AnnualAgeGroupChartsProps {
  group: AnnualComparisonAgeGroup;
}

interface AnnualChartDatum {
  fiscalYear: string;
  coverage: number | null;
  target: number | null;
}

const percentage = (value: number): string => value.toFixed(2) + '%';
const formatCount = (value: number): string => value.toLocaleString('th-TH');

function deltaDescription(point: AnnualComparisonPoint): string | null {
  if (point.coverage === null || point.delta === null) return null;
  const { points, previousFiscalYear } = point.delta;
  if (Math.abs(points) < 0.005) {
    return `ปี ${point.fiscalYear} เท่ากับปี ${previousFiscalYear}`;
  }
  if (points > 0) {
    return `ปี ${point.fiscalYear} สูงกว่าปี ${previousFiscalYear} อยู่ ${Math.abs(points).toFixed(2)} จุดร้อยละ`;
  }
  return `ปี ${point.fiscalYear} ลดลงจากปี ${previousFiscalYear} อยู่ ${Math.abs(points).toFixed(2)} จุดร้อยละ`;
}

function pointDescription(point: AnnualComparisonPoint, view: ComparisonView): string {
  switch (point.state) {
    case 'no-summary':
      return 'ไม่มีข้อมูลสรุป';
    case 'not-evaluable':
      return 'ยังประเมินไม่ได้';
    case 'metric-unavailable':
      return 'ไม่มีข้อมูลรายละเอียดสำหรับสรุปนี้';
    case 'legacy-denominator-unavailable':
      return `${point.coverage === null ? '—' : percentage(point.coverage)} · ผ่านเกณฑ์ ${point.numerator === null ? '—' : formatCount(point.numerator)} คน · ไม่ทราบจำนวนเข้าเกณฑ์ (ข้อมูลสรุปรุ่นเก่า)`;
    case 'available': {
      if (point.coverage === null || point.numerator === null || point.denominator === null) {
        return 'ไม่มีข้อมูลรายละเอียดสำหรับสรุปนี้';
      }
      const unit = view === 1 ? 'โดส' : 'คน';
      return `${percentage(point.coverage)} · ${formatCount(point.numerator)} / ${formatCount(point.denominator)} ${unit}`;
    }
  }
}

function ViewAnnualChart({
  points,
  view,
}: {
  points: AnnualComparisonPoint[];
  view: ComparisonView;
}) {
  const title = view === 1
    ? 'มุมมองที่ 1 (รายชนิดวัคซีน)'
    : 'มุมมองที่ 2 (Fully Immunized)';
  const description = view === 1
    ? 'ความครอบคลุมรายโดสวัคซีน'
    : 'ความครอบคลุมเด็กที่ผ่านเกณฑ์ Fully Immunized';
  const chartData: AnnualChartDatum[] = points.map(point => ({
    fiscalYear: String(point.fiscalYear),
    coverage: point.coverage,
    target: point.target,
  }));
  const comparableYears = points.filter(point => point.coverage !== null);
  const barColor = view === 1 ? '#0066cc' : '#059669';

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4" aria-label={title}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </div>

      {points.length === 0 ? (
        <p className="rounded-lg bg-white p-4 text-sm text-zinc-600">
          กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี
        </p>
      ) : (
        <>
          <div
            className="h-56 w-full min-w-0"
            role="img"
            aria-label={`${description} เปรียบเทียบปีงบประมาณ ${points.map(point => point.fiscalYear).join(', ')} โดยแสดงเปอร์เซ็นต์จริงและเป้าหมายรายปี`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 15, right: 15, bottom: 5, left: -15 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="fiscalYear" tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value, name) => [typeof value === 'number' ? percentage(value) : '—', String(name)]} />
                <Bar
                  dataKey="coverage"
                  name="ความครอบคลุม"
                  fill={barColor}
                  maxBarSize={58}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="target"
                  name="เป้าหมายรายปี"
                  stroke="#71717a"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={{ r: 4 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {comparableYears.length < 2 && (
            <p className="mb-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-600">
              ยังไม่มีปีงบประมาณอื่นสำหรับเปรียบเทียบ
            </p>
          )}

          <div role="list" className="space-y-2">
            {points.map(point => {
              const delta = deltaDescription(point);
              return (
                <div
                  role="listitem"
                  key={point.fiscalYear}
                  className="rounded-lg border border-zinc-100 bg-white p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <strong className="text-xs text-zinc-900">
                      ปีงบประมาณ {point.fiscalYear}
                    </strong>
                    <span className="text-xs font-medium text-zinc-800">
                      {pointDescription(point, view)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {point.target === null
                      ? 'ไม่ได้กำหนดเป้าหมาย'
                      : `เป้าหมาย ${percentage(point.target)}`}
                  </p>
                  {delta !== null && (
                    <p className="mt-1 text-xs font-medium text-zinc-700">{delta}</p>
                  )}
                  {point.updatedAt !== null && (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      ข้อมูลสรุป ณ วันที่ {formatDateTimeStr(point.updatedAt)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Parent renders one instance per age group, in model order 1,2,3,5.
 * Always keeps the dose-level and child-level comparison chart separate.
 */
export function AnnualAgeGroupCharts({ group }: AnnualAgeGroupChartsProps) {
  return (
    <section
      aria-labelledby={`annual-comparison-${group.targetTable}`}
      className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6"
    >
      <h2
        id={`annual-comparison-${group.targetTable}`}
        className="mb-4 text-lg font-semibold text-zinc-900"
      >
        {group.label}
      </h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ViewAnnualChart view={1} points={group.view1} />
        <ViewAnnualChart view={2} points={group.view2} />
      </div>
    </section>
  );
}
