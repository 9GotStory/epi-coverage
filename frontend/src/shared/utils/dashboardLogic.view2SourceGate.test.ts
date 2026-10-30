/**
 * Issue #89 regression — View 2 (Fully Immunized) must not count rules the
 * source file cannot evaluate as failures.
 *
 * Seam under test: `calcGroupSummary()` (dashboardLogic.ts) fed by the REAL
 * `evaluateDynamicV2()` + `markSourceAware()` engine — the same pair the upload
 * flow uses (useUploadManager.ts). No engine is stubbed on the View 2 path.
 *
 * Reported symptom (mirror image of #78): a 1-yr file lacking `mmr1_date`
 * (and/or `rv3*`) columns marked every child past `target_age_months` as
 * locally missing that vaccine — `calcGroupSummary` counted them as
 * applicable-but-failed, so the stored `view2Coverage` / `view2Breakdown` /
 * `facilityBreakdownV2` collapsed even when most children were fully immunized.
 *
 * Contract after the fix (owner decisions 2026-10-30):
 *   - A child with any required V2 rule not evaluable from the source columns is
 *     ประเมินไม่ได้: excluded from the View 2 denominator, counted separately
 *     (`view2NotEvaluableCount`), never listed as missing (data-quality follow-up,
 *     not a vaccination chase list).
 *   - Precedence: HDC verdict > local rules > not evaluable. `result = ผ่าน`
 *     stays PASS; `result = ไม่ผ่าน` stays FAIL; blank result + full columns
 *     keeps today's local evaluation.
 *   - Exact partition: applicable + pending + notEvaluable === total.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import type { EpiRecord, VaccineStatus } from '../types';

/** กฎ V2 จำลองจาก seed 1 ปี: BCG (ALL) + MMR เข็ม 1 (ALL) */
const bcgRule: VaccineRule = {
  rule_id: 'v2-bcg', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'BCG',
  display_name: 'BCG 1 เข็ม', hdc_code: '010',
  required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
  target_age_months: 0,
};
const mmrRule: VaccineRule = {
  rule_id: 'v2-mmr', fiscal_year: 2569, age_group: '1yr', view_type: 2, vaccine_group: 'MMR',
  display_name: 'MMR เข็ม 1', hdc_code: '061',
  required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true,
  target_age_months: 9,
};
const rules = markSourceAware([bcgRule, mmrRule]);

/** Synthetic child past every target age (birth 2022-01-01); identifier-shaped fields are fake. */
const child = (id: string, extra: Partial<EpiRecord>): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth: '2022-01-01', ...extra,
});

/** View 1 is out of scope for #89 — a deterministic stub keeps assertions on the V2 path. */
const evalV1 = () => evaluateDynamicV1(
  { hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: 'P-x', cid: '0000000000000', name: 'x', lname: 'ทดสอบ', birth: '2022-01-01' } as EpiRecord,
  [],
);

const FULL_COLUMNS = { source_columns: JSON.stringify(['birth', 'bcg_date', 'mmr1_date']) };
const NO_MMR_COLUMNS = { source_columns: JSON.stringify(['birth', 'bcg_date']) }; // ไฟล์ไม่เคยมีคอลัมน์ mmr1_date

const summarize = (data: EpiRecord[]) =>
  calcGroupSummary(data, evalV1, (r: EpiRecord): VaccineStatus => evaluateDynamicV2(r, rules));

describe('Issue #89 — View 2 denominator with a partial-column file', () => {
  it('excludes unevaluable children from the denominator (deflated-but-honest), never as failures', () => {
    // ไฟล์ 1 ปีไม่มีคอลัมน์ mmr1_date: เด็กทุกคนที่อายุเกิน 9 เดือนประเมิน Fully Immunized ไม่ได้
    // เด็ก A ครบทุกเข็มที่มองเห็น — พฤติกรรมเดิม (#89 ก่อนแก้) นับเป็น applicable-but-failed
    const s = summarize([
      child('A', { bcg_date: '2022-01-02', ...NO_MMR_COLUMNS }),
      child('B', { bcg_date: '2022-01-02', ...NO_MMR_COLUMNS }),
    ]);

    expect(s.total).toBe(2);
    expect(s.view2NotEvaluableCount).toBe(2);
    expect(s.view2ApplicableTotal).toBe(0);
    expect(s.view2PendingCount).toBe(0);
    // ตัวหาร 0 → UI แสดง "ยังประเมินไม่ได้" (Dashboard.tsx) ไม่ใช่ 0.00% ที่ดูเหมือนวัดจริง
    expect(s.view2Coverage).toBe(0);
    expect(s.view2Passed).toBe(0);
    // หน่วยบริการไม่รับเด็กประเมินไม่ได้เข้าตัวหารรายหน่วย
    expect(s.facilityBreakdownV2[0]).toMatchObject({ hoscode: '00000', total: 0, passed: 0 });
    // กฎ MMR แสดงใน breakdown ที่ total 0 → UI แสดง "ยังประเมินไม่ได้" รายกฎ (เหมือน View 1)
    const mmr = s.view2Breakdown.find(item => item.name === 'MMR เข็ม 1');
    expect(mmr).toMatchObject({ passed: 0, total: 0, coverage: 0 });
  });

  it('keeps a full-column cohort unchanged and partitions it exactly', () => {
    const s = summarize([
      child('PASS', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', ...FULL_COLUMNS }),
      child('MISS', { bcg_date: '2022-01-02', mmr1_date: '', ...FULL_COLUMNS }),
    ]);

    expect(s.view2NotEvaluableCount).toBe(0);
    expect(s.view2ApplicableTotal).toBe(2);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2Passed).toBe(1);
    expect(s.view2Coverage).toBe(50);
    const mmr = s.view2Breakdown.find(item => item.name === 'MMR เข็ม 1');
    expect(mmr).toMatchObject({ passed: 1, total: 2, coverage: 50 });
  });

  it('mixed cohort: honest denominator counts only decidable children (ผ่าน override included)', () => {
    // เด็ก 4 คน: 2 คนไฟล์ครบ (1 ผ่าน 1 ขาดจริง), 1 คนไฟล์ไม่ครบแต่ HDC ตัดสิน ผ่าน, 1 คนไฟล์ไม่ครบและ result ว่าง
    const s = summarize([
      child('LOCAL-PASS', { bcg_date: '2022-01-02', mmr1_date: '2022-10-05', ...FULL_COLUMNS }),
      child('LOCAL-FAIL', { bcg_date: '2022-01-02', mmr1_date: '', ...FULL_COLUMNS }),
      child('HDC-PASS', { bcg_date: '2022-01-02', result: 'ผ่าน', ...NO_MMR_COLUMNS }),
      child('BLOCKED', { bcg_date: '2022-01-02', ...NO_MMR_COLUMNS }),
    ]);

    // ตัวหาร = 3 (LOCAL-PASS, LOCAL-FAIL, HDC-PASS) — เด็ก BLOCKED ออกและถูกนับแยก
    expect(s.view2ApplicableTotal).toBe(3);
    expect(s.view2PendingCount).toBe(0);
    expect(s.view2NotEvaluableCount).toBe(1);
    expect(s.view2ApplicableTotal + s.view2PendingCount + s.view2NotEvaluableCount).toBe(s.total);
    expect(s.view2Passed).toBe(2); // LOCAL-PASS + HDC override
    expect(s.view2Coverage).toBeCloseTo((2 / 3) * 100, 5);
    // HDC ผ่านยังชนะประตูคอลัมน์ (ข้อ 2) — กฎที่ block ถูก backfill เข้า passed ให้ breakdown สอดคล้อง headline
    const mmr = s.view2Breakdown.find(item => item.name === 'MMR เข็ม 1');
    expect(mmr).toMatchObject({ passed: 2, total: 3 });
  });

  it('HDC "ไม่ผ่าน" children stay applicable failures even from a partial file', () => {
    const s = summarize([
      child('HDC-FAIL', { bcg_date: '2022-01-02', result: 'ไม่ผ่าน', ...NO_MMR_COLUMNS }),
    ]);

    expect(s.view2NotEvaluableCount).toBe(0);
    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2Passed).toBe(0);
    expect(s.view2Coverage).toBe(0); // ตัวหาร 1 จริง — ไม่ใช่ตัวหาร 0
    expect(s.view2ApplicableTotal + s.view2PendingCount + s.view2NotEvaluableCount).toBe(s.total);
  });

  it('persists the new field in the JSON contract and keeps it a safe zero for an empty cohort', () => {
    const s = summarize([]);
    const persisted = JSON.parse(JSON.stringify(s));
    expect(persisted.view2NotEvaluableCount).toBe(0);
    expect(persisted.view2ApplicableTotal).toBe(0);
    expect(persisted.view2PendingCount).toBe(0);
  });
});
