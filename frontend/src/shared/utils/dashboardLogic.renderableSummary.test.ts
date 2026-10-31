/**
 * Issue #80 RED contracts — renderability gate for persisted dashboard summaries.
 *
 * `Dashboard.tsx` `getSummary` only checked that `summaryData` was truthy. A
 * parseable-but-fieldless row (e.g. `{}` or a shape from an unknown writer)
 * then reaches `AgeGroupSection`, where `summary.view2Coverage.toFixed(2)`
 * throws — a crash, not a wrong number.
 *
 * Seam under test: `isRenderableGroupSummary()` (dashboardLogic.ts) — the
 * shared predicate the Dashboard uses to decide whether a stored snapshot is
 * renderable. A non-renderable row must present as "ยังไม่มีข้อมูลสรุป"
 * (no summary), never a crash and never a fabricated 0.
 *
 * All fixtures are synthetic. No real health data or identifiers.
 */
import { describe, expect, it } from 'vitest';
import { isRenderableGroupSummary } from './dashboardLogic';

/** Every field the Dashboard cards and the expanded view dereference. */
const completeSummary = {
  total: 10,
  view1PassedDoses: 5,
  view1TotalDoses: 8,
  view1Coverage: 62.5,
  view2Passed: 3,
  view2Coverage: 30,
  view1Breakdown: [],
  view2Breakdown: [],
  facilityBreakdownV1: [],
  facilityBreakdownV2: [],
};

describe('isRenderableGroupSummary', () => {
  it('accepts a complete current-contract summary', () => {
    expect(isRenderableGroupSummary({ ...completeSummary, view2ApplicableTotal: 10, view2PendingCount: 0, view2NotEvaluableCount: 0 })).toBe(true);
  });

  it('still accepts legacy snapshots without the Issue #23/#89 denominator fields', () => {
    expect(isRenderableGroupSummary(completeSummary)).toBe(true);
  });

  it('rejects a parseable-but-fieldless row — the crash case, presented as no-data instead', () => {
    expect(isRenderableGroupSummary({})).toBe(false);
    expect(isRenderableGroupSummary({ total: 'many' })).toBe(false);
  });

  it('rejects rows whose coverage fields are missing or non-numbers (toFixed must not throw)', () => {
    const { view2Coverage, ...withoutV2 } = completeSummary;
    expect(isRenderableGroupSummary(withoutV2)).toBe(false);
    expect(isRenderableGroupSummary({ ...completeSummary, view2Coverage: undefined })).toBe(false);
    expect(isRenderableGroupSummary({ ...completeSummary, view1Coverage: '62.5' })).toBe(false);
    expect(isRenderableGroupSummary({ ...completeSummary, view2Coverage: Number.NaN })).toBe(false);
  });

  it('rejects rows without the breakdown arrays the expanded view filters over', () => {
    const { facilityBreakdownV2, ...withoutFacility } = completeSummary;
    expect(isRenderableGroupSummary(withoutFacility)).toBe(false);
    expect(isRenderableGroupSummary({ ...completeSummary, view1Breakdown: undefined })).toBe(false);
  });

  it('rejects non-object summaries outright', () => {
    expect(isRenderableGroupSummary(null)).toBe(false);
    expect(isRenderableGroupSummary(undefined)).toBe(false);
    expect(isRenderableGroupSummary('summary')).toBe(false);
  });
});
