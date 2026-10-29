import type {
  DashboardSummaryRow, EpiTargetTable, FacilityBreakdownEntry, VaccineBreakdownEntry,
} from '../../shared/types/dashboardSummary';
import type { ComparisonView } from './model';

/**
 * Read-only data preparation for the secondary annual Comparison drill-down.
 * The backend has already resolved canonical annual (_all > legacy) precedence.
 * No person-level records, evaluation rules, API calls, or snapshot writes here.
 */
export type DeepDiveKind = 'facility' | 'vaccine';
export type DeepDivePointState =
  | 'available'
  | 'missing-summary'
  | 'missing-entry'
  | 'not-evaluable'
  | 'invalid-entry';

export interface DeepDiveDelta {
  previousFiscalYear: number;
  /** Difference in percentage points, not relative percent growth. */
  points: number;
}

export interface DeepDivePoint {
  fiscalYear: number;
  state: DeepDivePointState;
  /** Persisted snapshot coverage, null means no plottable chart value. */
  coverage: number | null;
  /** View 1: doses; View 2: persons. Counts are never cross-view substituted. */
  passed: number | null;
  total: number | null;
  target: number | null;
  updatedAt: string | null;
  delta: DeepDiveDelta | null;
}

export interface DeepDiveSeries {
  /** Facility: exact hoscode; vaccine: exact metric_key. */
  key: string;
  /** Most recent selected non-empty snapshot display name, never join identity. */
  label: string;
  points: DeepDivePoint[];
}

export interface DeepDiveModel {
  ageGroup: EpiTargetTable;
  view: ComparisonView;
  kind: DeepDiveKind;
  selectedYears: number[];
  series: DeepDiveSeries[];
  /** View/kind breakdown field was entirely absent from a stored annual snapshot. */
  missingBreakdownYears: number[];
  /** Legacy vaccine entries lack the stable metric_key needed for cross-year joins. */
  legacyUnjoinableYears: number[];
}

export interface DeepDiveOptions {
  summaries: ReadonlyArray<DashboardSummaryRow>;
  selectedYears: ReadonlyArray<number>;
  ageGroup: EpiTargetTable;
  view: ComparisonView;
  kind: DeepDiveKind;
  /** Bind to getTarget('all', view, vaccineGroup, fiscalYear); group absent for facilities. */
  resolveTarget: (view: ComparisonView, fiscalYear: number, vaccineGroup?: string) => number | undefined;
}

interface EntityEntry {
  label: string;
  coverage: number;
  passed: number;
  total: number;
  vaccineGroup?: string;
}

const normalizeYears = (years: ReadonlyArray<number>): number[] =>
  [...new Set(years.filter(year => Number.isSafeInteger(year) && year > 0))]
    .sort((a, b) => a - b);

const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validCoverage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const validIdentity = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function noEntry(fiscalYear: number, state: 'missing-summary' | 'missing-entry', updatedAt: string | null): DeepDivePoint {
  return { fiscalYear, state, coverage: null, passed: null, total: null, target: null, updatedAt, delta: null };
}

function entryPoint(
  fiscalYear: number,
  updatedAt: string,
  entry: EntityEntry,
  view: ComparisonView,
  resolver: DeepDiveOptions['resolveTarget'],
): DeepDivePoint {
  const configuredTarget = resolver(view, fiscalYear, entry.vaccineGroup);
  const target = validCoverage(configuredTarget) ? configuredTarget : null;
  const passed = validCount(entry.passed) ? entry.passed : null;
  const total = validCount(entry.total) ? entry.total : null;
  const point: DeepDivePoint = {
    fiscalYear, state: 'invalid-entry', coverage: null,
    passed, total, target, updatedAt, delta: null,
  };
  if (passed === null || total === null || passed > total) return point;
  if (total === 0) return { ...point, state: 'not-evaluable' };
  if (!validCoverage(entry.coverage)) return point;
  return { ...point, state: 'available', coverage: entry.coverage };
}

function withDeltas(points: DeepDivePoint[]): DeepDivePoint[] {
  let previous: DeepDivePoint | null = null;
  return points.map(point => {
    if (point.coverage === null) return point;
    const delta: DeepDiveDelta | null =
      previous && previous.coverage !== null
        ? { previousFiscalYear: previous.fiscalYear, points: point.coverage - previous.coverage }
        : null;
    previous = point;
    return { ...point, delta };
  });
}

export function buildDeepDiveModel({
  summaries,
  selectedYears,
  ageGroup,
  view,
  kind,
  resolveTarget,
}: DeepDiveOptions): DeepDiveModel {
  const years = normalizeYears(selectedYears);
  if (years.length > 5) throw new Error('Deep-dive annual comparison allows at most 5 selected fiscal years');

  const selected = new Set(years);
  const annual = new Map<number, DashboardSummaryRow>();
  for (const row of summaries) {
    if (row.targetTable !== ageGroup || !selected.has(row.fiscalYear)) continue;
    if (annual.has(row.fiscalYear)) {
      throw new Error('Duplicate canonical deep-dive summary for ' + ageGroup + '/' + row.fiscalYear);
    }
    annual.set(row.fiscalYear, row);
  }

  // Stable exact identifiers. Each FY carries at most one breakdown entry for
  // one identity; duplicate identities fail closed rather than overwrite data.
  const entriesByIdentity = new Map<string, Map<number, EntityEntry>>();
  const displayNameByIdentity = new Map<string, string>();
  const missingBreakdownYears: number[] = [];
  const legacyUnjoinableYears: number[] = [];

  const add = (key: string, fiscalYear: number, entry: EntityEntry) => {
    let yearly = entriesByIdentity.get(key);
    if (!yearly) {
      yearly = new Map();
      entriesByIdentity.set(key, yearly);
    }
    if (yearly.has(fiscalYear)) throw new Error('Duplicate deep-dive entity: ' + key + '/' + fiscalYear);
    yearly.set(fiscalYear, entry);
    if (validIdentity(entry.label)) displayNameByIdentity.set(key, entry.label);
  };

  for (const fiscalYear of years) {
    const row = annual.get(fiscalYear);
    if (!row) continue;
    const data = row.summaryData;
    if (kind === 'facility') {
      const breakdown: FacilityBreakdownEntry[] | undefined =
        view === 1 ? data.facilityBreakdownV1 : data.facilityBreakdownV2;
      if (breakdown === undefined) {
        missingBreakdownYears.push(fiscalYear);
        continue;
      }
      for (const entry of breakdown) {
        if (!validIdentity(entry.hoscode)) continue;
        add(entry.hoscode, fiscalYear, {
          label: entry.hosname, coverage: entry.coverage,
          passed: entry.passed, total: entry.total,
        });
      }
    } else {
      const breakdown: VaccineBreakdownEntry[] | undefined =
        view === 1 ? data.view1Breakdown : data.view2Breakdown;
      if (breakdown === undefined) {
        missingBreakdownYears.push(fiscalYear);
        continue;
      }
      let hasUnjoinable = false;
      for (const entry of breakdown) {
        if (!validIdentity(entry.metric_key)) {
          hasUnjoinable = true;
          continue;
        }
        add(entry.metric_key, fiscalYear, {
          label: entry.name, coverage: entry.coverage,
          passed: entry.passed, total: entry.total,
          vaccineGroup: entry.vaccine_group,
        });
      }
      if (hasUnjoinable) legacyUnjoinableYears.push(fiscalYear);
    }
  }

  const series: DeepDiveSeries[] = [...entriesByIdentity].map(([key, entries]) => ({
    key,
    label: displayNameByIdentity.get(key) || key,
    points: withDeltas(years.map(fiscalYear => {
      const summary = annual.get(fiscalYear);
      if (!summary) return noEntry(fiscalYear, 'missing-summary', null);
      const entry = entries.get(fiscalYear);
      if (!entry) return noEntry(fiscalYear, 'missing-entry', summary.updated_at);
      return entryPoint(fiscalYear, summary.updated_at, entry, view, resolveTarget);
    })),
  }));

  const latest = years.at(-1);
  series.sort((a, b) => {
    const va = latest === undefined ? null : a.points.find(p => p.fiscalYear === latest)?.coverage ?? null;
    const vb = latest === undefined ? null : b.points.find(p => p.fiscalYear === latest)?.coverage ?? null;
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return va - vb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { ageGroup, view, kind, selectedYears: years, series, missingBreakdownYears, legacyUnjoinableYears };
}
