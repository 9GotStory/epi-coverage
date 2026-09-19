/**
 * Shared dashboard-summary consumption contract (Issue #22).
 *
 * Source: `Dashboard_Summaries` rows returned by `getDashboardSummaries` and
 * `getDashboardSummariesMultiYear` — canonical annual precedence (`_all` over
 * legacy) is resolved by the backend; the frontend consumes the resolved row.
 * See docs/schema.md (`Dashboard_Summaries`).
 *
 * Base fields (`total`, `view2Coverage`, `view2Passed`) are guaranteed by both
 * the legacy and the current summary writers. Everything else is optional:
 * legacy snapshots may lack it, and `view2ApplicableTotal` / `view2PendingCount`
 * are the forward Ticket #23 contract — optional here and NOT persisted yet.
 */
export type EpiTargetTable = 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';

export interface VaccineBreakdownEntry {
  name: string;
  passed: number;
  total: number;
  coverage: number;
}

/** Facility identifiers are strings — never numerically normalized (CLAUDE.md §5). */
export interface FacilityBreakdownEntry {
  hoscode: string;
  hosname: string;
  total: number;
  passed: number;
  coverage: number;
}

export interface DashboardSummaryData {
  total: number;

  view1Coverage?: number;
  view1PassedDoses?: number;
  view1TotalDoses?: number;
  view1UnknownDoses?: number;

  view2Coverage: number;
  view2Passed: number;

  /** Ticket #23 forward contract — optional until #23 persists them. */
  view2ApplicableTotal?: number;
  view2PendingCount?: number;

  view1Breakdown?: VaccineBreakdownEntry[];
  view2Breakdown?: VaccineBreakdownEntry[];
  facilityBreakdownV1?: FacilityBreakdownEntry[];
  facilityBreakdownV2?: FacilityBreakdownEntry[];
}

export interface DashboardSummaryRow {
  id: string;
  targetTable: EpiTargetTable;
  fiscalYear: number;
  summaryData: DashboardSummaryData;
  updated_at: string;
}
