/**
 * Issue #102 (ADR-0006 ข้อ 4) — a date-check warning is "ตรวจสอบประวัติ", not a missing dose.
 *
 * Seam under test: `calcGroupSummary()` fed by the REAL `evaluateDynamicV1()` / `evaluateDynamicV2()`.
 *
 * Contract (owner decisions 2026-11-12):
 *   - View 2: a REVIEW child is excluded from the denominator and counted in `view2ReviewCount`;
 *     applicable + pending + notEvaluable + review === total.
 *   - A FAIL child stays applicable; its review rules are reported per rule at total 0.
 *   - View 1: a review dose rule is excluded from the per-dose denominator and counted in `view1ReviewDoses`.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2 } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { EpiRecord } from '../types';

const noChecks = { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] };
const rule = (overrides: Partial<VaccineRule>): VaccineRule => ({
  rule_id: 'r', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'DTP',
  display_name: 'DTP เข็ม 1', hdc_code: '', required_fields: ['dtp1_date'],
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, date_checks: noChecks, ...overrides,
});
const rules = [
  rule({ rule_id: 'v1-dtp1' , view_type: 1 }),
  rule({ rule_id: 'v1-mmr', view_type: 1, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', required_fields: ['mmr1_date'] }),
  rule({ rule_id: 'v2-dtp1' }),
  rule({ rule_id: 'v2-mmr', vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', required_fields: ['mmr1_date'] }),
];
const child = (id: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00001', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000', name: id, lname: 'ทดสอบ',
  birth: '2024-01-01', dtp1_date: '2024-03-01', mmr1_date: '2024-10-01', ...extra,
});
const asOf = new Date('2025-02-01');
const summarize = (data: EpiRecord[]) => calcGroupSummary(
  data, r => evaluateDynamicV1(r, rules, asOf), r => evaluateDynamicV2(r, rules, asOf), 2569, rules,
);

describe('calcGroupSummary — ตรวจสอบประวัติ (Issue #102)', () => {
  const clean = child('clean', {});
  const reviewOnly = child('review', { dtp1_date: '2023-12-31', result: 'ผ่าน' });
  const missingAndReview = child('missing', { dtp1_date: '2023-12-31', mmr1_date: '' });

  it('View 2: a review-only child leaves the denominator and is counted in view2ReviewCount', () => {
    const summary = summarize([clean, reviewOnly, missingAndReview]);
    expect(summary).toMatchObject({
      total: 3, view2Passed: 1, view2ApplicableTotal: 2, view2Coverage: 50,
      view2PendingCount: 0, view2NotEvaluableCount: 0, view2ReviewCount: 1,
    });
    expect(summary.facilityBreakdownV2).toEqual([{ hoscode: '00001', hosname: 'สถานบริการจำลอง', total: 2, passed: 1, coverage: 50 }]);
    // DTP เข็ม 1: เด็กที่ขาด MMR อยู่ในตัวหาร View 2 แต่กฎ DTP ของเขาเป็นตรวจสอบประวัติ จึงไม่อยู่ในตัวหารรายกฎ
    const dtp = summary.view2Breakdown.find(entry => entry.name === 'DTP เข็ม 1');
    const mmr = summary.view2Breakdown.find(entry => entry.name === 'MMR เข็ม 1');
    expect(dtp).toMatchObject({ passed: 1, total: 1 });
    expect(mmr).toMatchObject({ passed: 1, total: 2 });
  });

  it('View 1: review doses leave the per-dose denominator and are counted in view1ReviewDoses', () => {
    const summary = summarize([clean, reviewOnly, missingAndReview]);
    expect(summary).toMatchObject({ view1ReviewDoses: 2, view1PassedDoses: 3, view1TotalDoses: 4, view1Coverage: 75 });
    expect(summary.view1Breakdown.find(entry => entry.name === 'DTP เข็ม 1')).toMatchObject({ passed: 1, total: 1 });
  });
});
