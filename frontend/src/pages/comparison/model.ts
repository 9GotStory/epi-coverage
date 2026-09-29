import type { DashboardSummaryRow, EpiTargetTable } from '../../shared/types/dashboardSummary';

/**
 * Ticket #46 — pure annual comparison data model for the four age-group overview.
 * Backend already chooses the canonical annual snapshot (_all before legacy).
 * This module never requests data, evaluates vaccines, or changes stored snapshots.
 */
export const COMPARISON_AGE_GROUPS = [
  { targetTable: 'Epi_1_Year', label: 'เด็กอายุ 1 ปี' },
  { targetTable: 'Epi_2_Year', label: 'เด็กอายุ 2 ปี' },
  { targetTable: 'Epi_3_Year', label: 'เด็กอายุ 3 ปี' },
  { targetTable: 'Epi_5_Year', label: 'เด็กอายุ 5 ปี' },
] as const satisfies ReadonlyArray<{ targetTable: EpiTargetTable; label: string }>;

export type ComparisonView = 1 | 2;

export type AnnualPointState =
  | 'available'
  | 'no-summary'
  | 'metric-unavailable'
  | 'not-evaluable'
  | 'legacy-denominator-unavailable';

export interface AnnualPointDelta {
  /** The actual preceding selected year with a usable value, not a guessed adjacent FY. */
  previousFiscalYear: number;
  /** Raw percentage-point difference. A future UI may format this in Thai. */
  points: number;
}

export interface AnnualComparisonPoint {
  fiscalYear: number;
  state: AnnualPointState;
  /** Stored coverage only; null means there must be no chart point. */
  coverage: number | null;
  /** View 1: vaccine doses; View 2: fully immunized children. */
  numerator: number | null;
  denominator: number | null;
  /** View 2 current-contract only. No fabricated legacy pending or failed. */
  pending: number | null;
  failed: number | null;
  /** Annual, per-FY and per-view configuration; null means not configured. */
  target: number | null;
  /** Dashboard_Summaries.updated_at — last summary computation, not upload time. */
  updatedAt: string | null;
  delta: AnnualPointDelta | null;
}

export interface AnnualComparisonAgeGroup {
  targetTable: EpiTargetTable;
  label: string;
  view1: AnnualComparisonPoint[];
  view2: AnnualComparisonPoint[];
}

export interface AnnualComparisonModel {
  selectedYears: number[];
  ageGroups: AnnualComparisonAgeGroup[];
}

export type AnnualTargetResolver = (view: ComparisonView, fiscalYear: number) => number | undefined;

const isValidCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isValidPercentage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

const normalizeYears = (years: ReadonlyArray<number>): number[] =>
  [...new Set(years.filter(year => Number.isSafeInteger(year) && year > 0))]
    .sort((left, right) => left - right);

/**
 * Use the union, not intersection, of the four age groups' actual stored-summary
 * years. An age group missing a selected FY renders an explicit no-summary point.
 * Other unrelated tables and rules-derived fiscal years never enter this list.
 */
export function getComparisonFiscalYears(
  tables: Readonly<Record<string, ReadonlyArray<number> | undefined>>,
): number[] {
  return normalizeYears(COMPARISON_AGE_GROUPS.flatMap(group => tables[group.targetTable] ?? []));
}

/** Latest two usable FYs; zero or one when the repository only has zero/one. */
export function getDefaultComparisonYears(availableYears: ReadonlyArray<number>): number[] {
  return normalizeYears(availableYears).slice(-2);
}

function basePoint(
  fiscalYear: number,
  target: number | null,
  updatedAt: string | null,
): AnnualComparisonPoint {
  return {
    fiscalYear,
    state: 'no-summary',
    coverage: null,
    numerator: null,
    denominator: null,
    pending: null,
    failed: null,
    target,
    updatedAt,
    delta: null,
  };
}

function toAnnualPoint(
  summary: DashboardSummaryRow | undefined,
  view: ComparisonView,
  fiscalYear: number,
  target: number | null,
): AnnualComparisonPoint {
  const point = basePoint(fiscalYear, target, summary?.updated_at ?? null);
  if (!summary) return point;

  const data = summary.summaryData;
  if (view === 1) {
    const numerator = isValidCount(data.view1PassedDoses) ? data.view1PassedDoses : null;
    const denominator = isValidCount(data.view1TotalDoses) ? data.view1TotalDoses : null;
    point.numerator = numerator;
    point.denominator = denominator;

    if (numerator === null || denominator === null || numerator > denominator) {
      point.state = 'metric-unavailable';
    } else if (denominator === 0) {
      point.state = 'not-evaluable';
    } else if (!isValidPercentage(data.view1Coverage)) {
      point.state = 'metric-unavailable';
    } else {
      point.state = 'available';
      point.coverage = data.view1Coverage;
    }
    return point;
  }

  // View 2 covers people, not doses. A legacy snapshot can hold valid coverage
  // without the later applicable/pending fields; it must not invent a denominator.
  const numerator = isValidCount(data.view2Passed) ? data.view2Passed : null;
  point.numerator = numerator;
  const hasDenominator = data.view2ApplicableTotal !== undefined;
  const hasPending = data.view2PendingCount !== undefined;

  if (!hasDenominator && !hasPending) {
    if (numerator === null || !isValidPercentage(data.view2Coverage)) {
      point.state = 'metric-unavailable';
    } else {
      point.state = 'legacy-denominator-unavailable';
      point.coverage = data.view2Coverage;
    }
    return point;
  }

  // Partially evolved/invalid data is not a valid current or legacy contract.
  const denominator = isValidCount(data.view2ApplicableTotal) ? data.view2ApplicableTotal : null;
  const pending = isValidCount(data.view2PendingCount) ? data.view2PendingCount : null;
  point.denominator = denominator;
  point.pending = pending;
  if (
    !hasDenominator || !hasPending ||
    numerator === null || denominator === null || pending === null ||
    numerator > denominator
  ) {
    point.state = 'metric-unavailable';
  } else if (denominator === 0) {
    point.state = 'not-evaluable';
  } else if (!isValidPercentage(data.view2Coverage)) {
    point.state = 'metric-unavailable';
  } else {
    point.state = 'available';
    point.coverage = data.view2Coverage;
    point.failed = denominator - numerator;
  }
  return point;
}

function withPriorYearDeltas(points: AnnualComparisonPoint[]): AnnualComparisonPoint[] {
  let previous: AnnualComparisonPoint | null = null;
  return points.map(point => {
    if (point.coverage === null) return point;
    const delta = previous && previous.coverage !== null
      ? { previousFiscalYear: previous.fiscalYear, points: point.coverage - previous.coverage }
      : null;
    previous = point;
    return { ...point, delta };
  });
}

/**
 * Prepare all 4 age groups for chart-first annual comparison without mutating
 * summaries. Input FYs are normalized, never synthesized from the browser clock.
 *
 * The caller supplies the same annual target authority as the Dashboard:
 *   (view, year) => getTarget('all', view, undefined, year)
 */
export function buildAnnualComparisonModel(
  summaries: ReadonlyArray<DashboardSummaryRow>,
  selectedYears: ReadonlyArray<number>,
  resolveTarget: AnnualTargetResolver,
): AnnualComparisonModel {
  const years = normalizeYears(selectedYears);
  if (years.length > 5) {
    throw new Error('Annual comparison allows at most five selected fiscal years');
  }

  const annualByGroupAndYear = new Map<string, DashboardSummaryRow>();
  for (const summary of summaries) {
    const key = summary.targetTable + '|' + summary.fiscalYear;
    if (annualByGroupAndYear.has(key)) {
      // The backend must return one canonical annual snapshot per group/FY.
      // Refuse to arbitrarily select among conflicting authoritative rows.
      throw new Error('Duplicate annual comparison summary: ' + key);
    }
    annualByGroupAndYear.set(key, summary);
  }

  const ageGroups: AnnualComparisonAgeGroup[] = COMPARISON_AGE_GROUPS.map(group => {
    const buildSeries = (view: ComparisonView): AnnualComparisonPoint[] =>
      withPriorYearDeltas(years.map(fiscalYear => {
        const resolved = resolveTarget(view, fiscalYear);
        const target = isValidPercentage(resolved) ? resolved : null;
        const summary = annualByGroupAndYear.get(group.targetTable + '|' + fiscalYear);
        return toAnnualPoint(summary, view, fiscalYear, target);
      }));

    return {
      targetTable: group.targetTable,
      label: group.label,
      view1: buildSeries(1),
      view2: buildSeries(2),
    };
  });

  return { selectedYears: years, ageGroups };
}
