/**
 * Issue #78 regression — BRANCH rules must not shrink the View 1 denominator
 * to a pass-only population when the source file lacks one branch's columns.
 *
 * Seam under test: `calcGroupSummary()` (dashboardLogic.ts) fed by the REAL
 * `evaluateDynamicV1()` + `markSourceAware()` engine — the same pair the upload
 * flow uses (useUploadManager.ts). No engine is stubbed on the View 1 path.
 *
 * Reported symptom: a file with rv21/rv22 but no rv3* columns made every child
 * who did not complete the visible branch "unknown" (dropped from the
 * denominator) while children who completed it counted as passed — so the
 * per-vaccine breakdown displayed "Rota (ครบ) 100.0%" from a self-selected
 * denominator. Contract after the fix: the vaccine is NOT EVALUABLE for records
 * whose known source columns cannot decide the rule (denominator 0 → the UI
 * renders "ยังประเมินไม่ได้"), and a fully confirmed file keeps non-passers in
 * the denominator.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, markSourceAware } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

const rotaRule: VaccineRule = {
  rule_id: 'rota-full', fiscal_year: 2569, age_group: '1yr', view_type: 1, vaccine_group: 'Rota',
  display_name: 'Rota (ครบ)', hdc_code: 'R12/R23',
  required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'],
  logic_type: 'BRANCH', is_required_for_v2: true, is_active: true, target_age_months: 6,
};
const rules = markSourceAware([rotaRule]);

/** Synthetic child; identifier-shaped fields are fake. */
const child = (id: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth: '2022-01-01', ...extra,
});

/** V2 is out of scope for #78 — a deterministic non-pending stub keeps the partition simple. */
const evalV2 = (): VaccineStatus => ({
  isFullyImmunized: false, status: 'FAIL', missingVaccines: ['BCG'], pendingVaccines: [], passedVaccines: [],
});

const partialFileColumns = { source_columns: JSON.stringify(['birth', 'rv21_date', 'rv22_date']) };
const fullFileColumns = { source_columns: JSON.stringify(['birth', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date']) };

describe('Issue #78 — View 1 BRANCH denominator with a partial-column file', () => {
  const cohort = (columns: Partial<EpiRecord>): EpiRecord[] => [
    // เด็ก 1 คนครบชุด 2 เข็มในไฟล์ — อีก 2 คนไม่มีวันที่ Rota เลย
    child('A', { rv21_date: '2022-03-01', rv22_date: '2022-05-01', ...columns }),
    child('B', columns),
    child('C', columns),
  ];

  it('reports the vaccine as not evaluable (total 0) instead of a pass-only 100% denominator', () => {
    const s = calcGroupSummary(cohort(partialFileColumns), r => evaluateDynamicV1(r, rules), evalV2);
    const rota = s.view1Breakdown.find(item => item.name === 'Rota (ครบ)');

    // ตัวหาร 0 → UI แสดง "ยังประเมินไม่ได้" (AgeGroupExpandedView) — ไม่ใช่ 100.0%
    expect(rota).toBeDefined();
    expect(rota!.passed).toBe(0);
    expect(rota!.total).toBe(0);
    expect(rota!.coverage).toBe(0);
    // ทุกแถวถูกระบุว่าข้อมูลไม่พอ ตามสถานะเดียวกัน ไม่เหลือเฉพาะคนผ่าน
    expect(s.view1UnknownDoses).toBe(3);
    expect(s.view1PassedDoses).toBe(0);
    expect(s.view1TotalDoses).toBe(0);
  });

  it('keeps non-passers in the denominator when the file confirms both branches', () => {
    const s = calcGroupSummary(cohort(fullFileColumns), r => evaluateDynamicV1(r, rules), evalV2);
    const rota = s.view1Breakdown.find(item => item.name === 'Rota (ครบ)');

    // 1 ผ่านจาก 3 ในเกณฑ์ = 33.3% (ปัดเศษที่ตำแหน่งที่สอง) — ไม่ใช่ 100%
    expect(rota).toBeDefined();
    expect(rota!.passed).toBe(1);
    expect(rota!.total).toBe(3);
    expect(rota!.coverage).toBeCloseTo(100 / 3, 1);
    expect(s.view1UnknownDoses).toBe(0);
  });
});
