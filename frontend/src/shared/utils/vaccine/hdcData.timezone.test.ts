/**
 * Issue #80 RED contracts — the HDC calendar day must not depend on the viewer's timezone.
 *
 * `calendarDay` converted timestamp values with `date-fns format`, which renders
 * in the VIEWER's local timezone. EPI data is Thai: a GAS-exported midnight
 * Bangkok timestamp ("2024-10-30T17:00:00.000Z") must read as 31 Oct for every
 * viewer, not just viewers at UTC+7. Outside Thailand the calendar day shifted,
 * silently changing date-check evaluation and pending-age math per viewer.
 *
 * This file deliberately pins the process timezone OUTSIDE UTC+7 before the
 * assertions (the sibling hdcData.test.ts pins Asia/Bangkok) — the identical
 * expectations in both files prove the conversion is viewer-independent and
 * permanently Asia/Bangkok (UTC+7).
 *
 * All fixtures are synthetic. No real health data or identifiers.
 */
process.env.TZ = 'America/New_York';
import { describe, expect, it } from 'vitest';
import { calendarDay, formatHdcDate } from './hdcData';

describe('calendar day is fixed to the Thai calendar (UTC+7), not the viewer', () => {
  it('reads a Bangkok-midnight UTC timestamp as the Thai calendar day', () => {
    // 17:00Z = เที่ยงคืนของ 31 ต.ค. เวลาไทย — ใน NY ยังเป็นบ่าย 30 ต.ค.
    expect(calendarDay('2024-10-30T17:00:00.000Z')).toBe('2024-10-31');
    expect(calendarDay(new Date('2024-10-30T17:00:00.000Z'))).toBe('2024-10-31');
  });

  it('formats the display date from the Thai calendar day for every viewer', () => {
    expect(formatHdcDate('2023-10-03T17:00:00.000Z')).toBe('04-10-2023');
    expect(formatHdcDate(new Date('2023-10-03T17:00:00.000Z'))).toBe('04-10-2023');
  });

  it('keeps date-only literals and invalid/empty values exactly as before', () => {
    expect(calendarDay('2024-10-31')).toBe('2024-10-31');
    expect(calendarDay('')).toBeNull();
    expect(calendarDay('2023-02-29')).toBe('');
  });
});
