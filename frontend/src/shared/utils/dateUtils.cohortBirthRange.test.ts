/**
 * Issue #136/#137 — the Cohort Birth Range (CONTEXT.md §46) of each Age Group for a Fiscal Year.
 *
 * The backend preflight computes the same range in GAS. Both copies are pinned to these known
 * values (the backend's are in `backend/tests/hdc-import.test.cjs`) so they cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { getBirthDateRangeForQuarter } from './dateUtils';

const day = (date: Date) => date.toISOString().slice(0, 10);

describe('Issue #136 — Cohort Birth Range for the whole Fiscal Year', () => {
  it.each([
    [1, '2024-10-01', '2025-09-30'],
    [2, '2023-10-01', '2024-09-30'],
    [3, '2022-10-01', '2023-09-30'],
    [5, '2020-10-01', '2021-09-30'],
  ])('FY2569, %i-year: %s to %s', (age, start, end) => {
    const range = getBirthDateRangeForQuarter(2569, 'all', age);
    expect([day(range.start), day(range.end)]).toEqual([start, end]);
  });

  it('includes the whole of 30 September and none of 1 October', () => {
    const { end } = getBirthDateRangeForQuarter(2570, 'all', 2); // the #136 example: 2024-10-01..2025-09-30
    expect(new Date('2025-09-30T23:59:59.999Z') <= end).toBe(true);
    expect(new Date('2025-10-01T00:00:00.000Z') <= end).toBe(false);
  });
});
