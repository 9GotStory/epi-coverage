import { useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { DashboardSummaryRow, EpiTargetTable } from '../../shared/types/dashboardSummary';
import { formatDateTimeStr } from '../../shared/utils/dateUtils';
import { COMPARISON_AGE_GROUPS, type ComparisonView } from './model';
import {
  buildDeepDiveModel, type DeepDiveKind, type DeepDiveOptions,
  type DeepDivePoint, type DeepDiveSeries,
} from './deepDiveModel';

/**
 * The second Comparison card, not another year-level overview.
 * Three explicit axes (age, View, facility/vaccine) select ONE set of stored,
 * same-identity annual measurements. The global FYs are parent-controlled.
 */
export interface DeepDivePanelProps {
  summaries: ReadonlyArray<DashboardSummaryRow>;
  selectedYears: ReadonlyArray<number>;
  resolveTarget: DeepDiveOptions['resolveTarget'];
}

const percent = (value: number) => value.toFixed(2) + '%';
const count = (value: number) => value.toLocaleString('th-TH');
const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2);
const names: Record<DeepDiveKind, string> = {
  facility: 'หน่วยบริการ',
  vaccine: 'วัคซีน',
};
const kindButtons: Array<{ value: DeepDiveKind; label: string }> = [
  { value: 'facility', label: 'รายหน่วยบริการ' },
  { value: 'vaccine', label: 'รายวัคซีน' },
];

function pointNarrative(point: DeepDivePoint): string {
  switch (point.state) {
    case 'missing-summary': return `ปี ${point.fiscalYear}: ไม่มีข้อมูลสรุป`;
    case 'missing-entry': return `ปี ${point.fiscalYear}: ไม่มีข้อมูลรายการนี้`;
    case 'not-evaluable': return 'ยังประเมินไม่ได้';
    case 'invalid-entry': return 'ไม่มีข้อมูลรายละเอียดที่ใช้ประเมินได้';
    case 'available': return percent(point.coverage!);
  }
}

function deltaText(point: DeepDivePoint): string | null {
  if (point.coverage === null || !point.delta) return null;
  const { points, previousFiscalYear } = point.delta;
  if (Math.abs(points) < 0.005) return `ปี ${point.fiscalYear} เท่ากับปี ${previousFiscalYear}`;
  if (points > 0) return `ปี ${point.fiscalYear} สูงกว่าปี ${previousFiscalYear} อยู่ ${points.toFixed(2)} จุดร้อยละ`;
  return `ปี ${point.fiscalYear} ลดลงจากปี ${previousFiscalYear} อยู่ ${Math.abs(points).toFixed(2)} จุดร้อยละ`;
}

function CountAndTarget({ point, view }: { point: DeepDivePoint; view: ComparisonView }) {
  if (point.state !== 'available') return null;
  const unit = view === 1 ? 'โดส' : 'คน';
  return (
    <div className="mt-1 space-y-1 text-xs text-zinc-600">
      <p>{point.passed !== null && point.total !== null
        ? `${count(point.passed)} / ${count(point.total)} ${unit}`
        : 'ไม่มีข้อมูลจำนวนที่ใช้ประเมิน'}</p>
      {point.target === null ? (
        <p>ไม่ได้กำหนดเป้าหมาย</p>
      ) : (
        <>
          <p>{`เป้าหมายปี ${point.fiscalYear}: ${percent(point.target)}`}</p>
          <p>{`ส่วนต่างจากเป้าหมายปี ${point.fiscalYear}: ${signed(point.coverage! - point.target)} จุดร้อยละ`}</p>
        </>
      )}
    </div>
  );
}

function DeepDiveTrend({ series, view, selectedYears }: {
  series: DeepDiveSeries; view: ComparisonView; selectedYears: ReadonlyArray<number>;
}) {
  const unit = view === 1 ? 'รายโดสวัคซีน' : 'รายคน Fully Immunized';
  const chartData = series.points.map(point => ({
    fiscalYear: String(point.fiscalYear),
    coverage: point.coverage,
    target: point.target,
  }));
  const hasMultiple = selectedYears.length >= 2;

  return (
    <section aria-label={`แนวโน้มรายปี ${series.label}`} className="min-w-0 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-zinc-900">ความครอบคลุมรายปี</h3>
        <p className="text-xs text-zinc-500">
          {series.label} · {unit} · เปรียบเทียบปีงบประมาณที่เลือกในมุมมองเดียวกัน
        </p>
      </div>
      <div className="h-60 w-full min-w-0" role="img"
        aria-label={`ผลรายปี ${unit} ${series.label} ปีงบประมาณ ${selectedYears.join(', ')} พร้อมเส้นเป้าหมายรายปี`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 16, right: 18, bottom: 3, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
            <XAxis dataKey="fiscalYear" tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tickFormatter={(value: number) => value + '%'}
              tickLine={false} axisLine={false} />
            <Tooltip formatter={(value, name) => [typeof value === 'number' ? percent(value) : '—', String(name)]} />
            <Bar dataKey="coverage" name="ความครอบคลุม" fill="#0066cc"
              maxBarSize={62} isAnimationActive={false} />
            <Line type="linear" dataKey="target" name="เป้าหมายรายปี"
              stroke="#71717a" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 4 }}
              connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!hasMultiple && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">
          ยังไม่มีปีงบประมาณอื่นสำหรับเปรียบเทียบ
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {series.points.map(point => {
          const delta = deltaText(point);
          return (
            <article key={point.fiscalYear} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
              <h4 className="text-xs font-semibold text-zinc-700">ปีงบประมาณ {point.fiscalYear}</h4>
              <p className={`mt-1 font-semibold ${point.state === 'available' ? 'text-xl text-zinc-900' : 'text-sm text-amber-700'}`}>
                {pointNarrative(point)}
              </p>
              <CountAndTarget point={point} view={view} />
              {delta !== null && <p className="mt-2 text-xs font-semibold text-zinc-800">{delta}</p>}
              {point.updatedAt !== null && (
                <p className="mt-2 text-xs text-zinc-500">
                  ข้อมูลสรุป ณ วันที่ {formatDateTimeStr(point.updatedAt)}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DeepDiveAnnualTable({ series, view }: { series: DeepDiveSeries; view: ComparisonView }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[640px] text-left text-xs text-zinc-700">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">ปีงบประมาณ</th>
            <th className="px-3 py-2 font-medium">ความครอบคลุม</th>
            <th className="px-3 py-2 font-medium">ผ่าน / เข้าเกณฑ์ ({view === 1 ? 'โดส' : 'คน'})</th>
            <th className="px-3 py-2 font-medium">เป้าหมายปีนั้น</th>
            <th className="px-3 py-2 font-medium">เปลี่ยนแปลงจากปีที่มีข้อมูลก่อนหน้า (จุดร้อยละ)</th>
            <th className="px-3 py-2 font-medium">ข้อมูลสรุป ณ วันที่</th>
          </tr>
        </thead>
        <tbody>
          {series.points.map(point => (
            <tr key={point.fiscalYear} className="border-t border-zinc-100">
              <td className="px-3 py-2 font-medium">{point.fiscalYear}</td>
              <td className="px-3 py-2">{pointNarrative(point)}</td>
              <td className="px-3 py-2">
                {point.state === 'available' && point.passed !== null && point.total !== null
                  ? `${count(point.passed)} / ${count(point.total)}` : '—'}
              </td>
              <td className="px-3 py-2">{point.target === null ? 'ไม่ได้กำหนดเป้าหมาย' : percent(point.target)}</td>
              <td className="px-3 py-2">{deltaText(point) ?? '—'}</td>
              <td className="px-3 py-2">{point.updatedAt !== null ? formatDateTimeStr(point.updatedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeepDivePanel({ summaries, selectedYears, resolveTarget }: DeepDivePanelProps) {
  const [ageGroup, setAgeGroup] = useState<EpiTargetTable>('Epi_1_Year');
  const [view, setView] = useState<ComparisonView>(1);
  const [kind, setKind] = useState<DeepDiveKind>('facility');
  const [entityKey, setEntityKey] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [search, setSearch] = useState('');

  const model = buildDeepDiveModel({ summaries, selectedYears, ageGroup, view, kind, resolveTarget });
  const selected = model.series.find(item => item.key === entityKey) ?? model.series[0] ?? null;
  const latestYear = model.selectedYears.at(-1);
  const matchingSeries = model.series.filter(item =>
    (item.label + ' ' + item.key).toLocaleLowerCase('th-TH').includes(search.trim().toLocaleLowerCase('th-TH')),
  );

  const reset = () => {
    setEntityKey(null);
    setSearch('');
    setShowTable(false);
  };
  const chooseAge = (next: EpiTargetTable) => { setAgeGroup(next); reset(); };
  const chooseView = (next: ComparisonView) => { setView(next); reset(); };
  const chooseKind = (next: DeepDiveKind) => { setKind(next); reset(); };

  const axisClass = (active: boolean) =>
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ' +
    (active ? 'bg-primary text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200');

  return (
    <section aria-label="ส่วนเจาะลึกผลการดำเนินงาน" className="space-y-5">
      <p className="text-sm text-zinc-600">
        เลือกกลุ่มอายุ มุมมอง และหัวข้อวิเคราะห์ เพื่อเปรียบเทียบผลของรายการเดียวกันข้ามปี
        โดยไม่ใช้ View 1 ลบกับ View 2
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-800">1. กลุ่มอายุ</h3>
          <div role="group" aria-label="เลือกกลุ่มอายุสำหรับเจาะลึก" className="flex flex-wrap gap-2">
            {COMPARISON_AGE_GROUPS.map(group => (
              <button key={group.targetTable} type="button" aria-pressed={ageGroup === group.targetTable}
                className={axisClass(ageGroup === group.targetTable)}
                onClick={() => chooseAge(group.targetTable)}>{group.label}</button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-800">2. มุมมอง</h3>
          <div role="group" aria-label="เลือกมุมมองสำหรับเจาะลึก" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={view === 1} className={axisClass(view === 1)}
              onClick={() => chooseView(1)}>View 1 — รายโดส</button>
            <button type="button" aria-pressed={view === 2} className={axisClass(view === 2)}
              onClick={() => chooseView(2)}>View 2 — รายคน</button>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-800">3. หัวข้อวิเคราะห์</h3>
          <div role="group" aria-label="เลือกหัวข้อวิเคราะห์" className="flex flex-wrap gap-2">
            {kindButtons.map(item => (
              <button key={item.value} type="button" aria-pressed={kind === item.value}
                className={axisClass(kind === item.value)}
                onClick={() => chooseKind(item.value)}>{item.label}</button>
            ))}
          </div>
        </div>
      </div>

      {model.missingBreakdownYears.length > 0 && (
        <p role="status" className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
          ปี {model.missingBreakdownYears.join(', ')}: ไม่มีข้อมูลรายละเอียด{kind === 'facility' ? 'รายหน่วยบริการ' : 'รายวัคซีน'}ในข้อมูลสรุปรุ่นนี้
        </p>
      )}
      {model.legacyUnjoinableYears.map(fiscalYear => (
        <p role="status" key={fiscalYear} className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
          ปี {fiscalYear}: ไม่มีรหัสเชื่อมโยงวัคซีนสำหรับการเปรียบเทียบข้ามปี
        </p>
      ))}

      {model.selectedYears.length === 0 ? (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          กรุณาเลือกปีงบประมาณอย่างน้อย 1 ปี เพื่อดูข้อมูล
        </p>
      ) : model.series.length === 0 ? (
        <p role="status" className="rounded-xl bg-zinc-50 p-5 text-sm text-zinc-600">
          ไม่มีข้อมูล{kind === 'facility' ? 'รายหน่วยบริการ' : 'รายวัคซีนที่มีรหัสเชื่อมโยง'}สำหรับกลุ่มอายุ มุมมอง และปีงบประมาณที่เลือก
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
            <h3 className="text-sm font-semibold text-zinc-900">
              ผล{names[kind]}ปีงบประมาณ {latestYear} (เรียงจากน้อยไปมาก)
            </h3>
            <p className="mt-1 text-xs text-zinc-500">รายการที่ไม่มีข้อมูลปีล่าสุดแสดงท้ายสุด ไม่ถือเป็น 0%</p>
            <label className="mt-3 block space-y-1">
              <span className="text-xs font-medium text-zinc-600">ค้นหา{names[kind]}หรือรหัส</span>
              <input type="search" value={search} onChange={event => setSearch(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                placeholder={kind === 'facility' ? 'ชื่อหรือรหัสหน่วยบริการ' : 'ชื่อหรือรหัสวัคซีน'} />
            </label>
            <div role="group" aria-label={`เลือก${names[kind]}จากผลปี ${latestYear}`}
              className="mt-3 max-h-[380px] space-y-2 overflow-y-auto pr-1">
              {matchingSeries.map(item => {
                const point = item.points.at(-1);
                const value = point?.coverage ?? null;
                const active = selected?.key === item.key;
                return (
                  <button key={item.key} type="button" aria-pressed={active}
                    aria-label={kind === 'facility'
                      ? `เลือกหน่วยบริการ ${item.key} ${item.label}`
                      : `เลือกวัคซีน ${item.label} รหัส ${item.key}`}
                    onClick={() => { setEntityKey(item.key); setShowTable(false); }}
                    className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-primary ${
                      active ? 'border-primary bg-blue-50' : 'border-zinc-200 bg-white hover:bg-zinc-100'
                    }`}>
                    <span className="block text-xs font-semibold text-zinc-900">{item.label}</span>
                    <span className="block text-[11px] text-zinc-500">{item.key}</span>
                    <span className="mt-1 block text-xs text-zinc-700">
                      {value === null ? 'ไม่มีข้อมูลที่ประเมินได้' : `ปี ${latestYear}: ${percent(value)}`}
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                      {value !== null && <span className="block h-full rounded-full bg-primary"
                        style={{ width: percent(value) }} />}
                    </span>
                  </button>
                );
              })}
              {matchingSeries.length === 0 && (
                <p className="text-xs text-zinc-500">ไม่พบรายการตามคำค้นหา</p>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {selected !== null && (
              <>
                <DeepDiveTrend series={selected} view={view} selectedYears={model.selectedYears} />
                <section className="rounded-xl border border-zinc-200 p-4">
                  <button type="button" aria-expanded={showTable}
                    onClick={() => setShowTable(open => !open)}
                    className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-zinc-900 focus-visible:outline-2 focus-visible:outline-primary">
                    <span>{showTable ? 'ซ่อนตารางข้อมูลรายปี' : 'แสดงตารางข้อมูลรายปี'}</span>
                    <span aria-hidden="true">{showTable ? '−' : '+'}</span>
                  </button>
                  {showTable && <div className="mt-4"><DeepDiveAnnualTable series={selected} view={view} /></div>}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
