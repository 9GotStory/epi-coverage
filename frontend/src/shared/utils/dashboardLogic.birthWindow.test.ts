/**
 * Issue #121 (ADR-0008) — a Vaccine Rule's Birth Window and the Inapplicable Rule.
 *
 * Seam under test: `calcGroupSummary()` fed by the REAL `evaluateDynamicV1()` /
 * `evaluateDynamicV2()` + `markSourceAware()` engine, the same pair the upload flow uses.
 * Nothing on the evaluation path is stubbed; a fixed evaluation date keeps age-based
 * results stable. Per-child outputs are asserted on the evaluators directly.
 *
 * Rule set: a cohort that straddles the 2566 polio switch, configured as two regimens
 * sharing the cut-off 2023-05-01 (CONTEXT.md §41):
 *   - IPV เข็ม 1/2: born on or after 2023-05-01 (inclusive start)
 *   - โปลิโอ เข็ม 1/2 (สูตรเดิม): born before 2023-05-01 (exclusive end)
 *   - BCG: no Birth Window (applies to everyone, as before)
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { describe, expect, it } from 'vitest';
import { calcGroupSummary } from './dashboardLogic';
import { evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from './vaccine/ruleEngine';
import type { VaccineRule } from './vaccine/ruleEngine';
import { getRecordDateWarnings } from './vaccine/dateWarnings';
import { inapplicableReason } from './vaccine/birthWindow';
import type { EpiRecord } from '../types';

const CUT_OFF = '2023-05-01';

const rule = (overrides: Partial<VaccineRule> & Pick<VaccineRule, 'rule_id' | 'display_name' | 'required_fields'>): VaccineRule => ({
  fiscal_year: 2569, age_group: '3yr', view_type: 2, vaccine_group: 'X', hdc_code: '',
  logic_type: 'ALL', is_required_for_v2: true, is_active: true, ...overrides,
});

const bcg = rule({ rule_id: 'bcg', display_name: 'BCG 1 เข็ม', vaccine_group: 'BCG', required_fields: ['bcg_date'], target_age_months: 0 });
const ipv1 = rule({ rule_id: 'ipv1', display_name: 'IPV เข็ม 1', vaccine_group: 'IPV', required_fields: ['ipv1_date'], target_age_months: 2, born_on_or_after: CUT_OFF });
const ipv2 = rule({ rule_id: 'ipv2', display_name: 'IPV เข็ม 2', vaccine_group: 'IPV', required_fields: ['ipv2_date'], target_age_months: 4, born_on_or_after: CUT_OFF });
const polio1 = rule({ rule_id: 'polio1', display_name: 'โปลิโอ เข็ม 1 (สูตรเดิม)', vaccine_group: 'OPV', required_fields: ['opv1_date'], target_age_months: 2, born_before: CUT_OFF });
const polio2 = rule({ rule_id: 'polio2', display_name: 'โปลิโอ เข็ม 2 (สูตรเดิม)', vaccine_group: 'OPV', required_fields: ['opv2_date'], target_age_months: 4, born_before: CUT_OFF });

const v2Rules = markSourceAware([bcg, ipv1, ipv2, polio1, polio2]);
const v1Rules = markSourceAware([bcg, ipv1, ipv2, polio1, polio2].map(r => ({ ...r, rule_id: `v1-${r.rule_id}`, view_type: 1 })));

const EVALUATION_DATE = new Date('2026-11-11T00:00:00');
const PRE_SWITCH = '2023-03-01';
const POST_SWITCH = '2023-08-01';

const COLUMNS = { source_columns: JSON.stringify(['birth', 'bcg_date', 'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date']) };

const child = (id: string, birth: string, extra: Partial<EpiRecord> = {}): EpiRecord => ({
  hoscode: '00000', hosname: 'สถานบริการจำลอง', pid: `P-${id}`, cid: '0000000000000',
  name: id, lname: 'ทดสอบ', birth, ...COLUMNS, ...extra,
});

const evalV1 = (r: EpiRecord) => evaluateDynamicV1(r, v1Rules, EVALUATION_DATE);
const evalV2 = (r: EpiRecord) => evaluateDynamicV2(r, v2Rules, EVALUATION_DATE);
const summarize = (data: EpiRecord[]) => calcGroupSummary(data, evalV1, evalV2, 2569, [...v1Rules, ...v2Rules]);
const v2Entry = (s: ReturnType<typeof summarize>, name: string) => s.view2Breakdown.find(item => item.name === name);
const v1Entry = (s: ReturnType<typeof summarize>, name: string) => s.view1Breakdown.find(item => item.name === name);

describe('Issue #121 — Birth Window in the shared rule engine and the summary', () => {
  it('does not count a pre-switch child without IPV as missing IPV, nor in the IPV per-rule denominator', () => {
    const pre = child('PRE-OPV', PRE_SWITCH, { bcg_date: '2023-03-02', opv1_date: '2023-05-02', opv2_date: '2023-07-02' });
    const post = child('POST-IPV', POST_SWITCH, { bcg_date: '2023-08-02', ipv1_date: '2023-10-02', ipv2_date: '2023-12-02' });

    const v2 = evalV2(pre);
    expect(v2.status).toBe('PASS');
    expect(v2.missingVaccines).toEqual([]);
    expect(v2.passedVaccines).not.toContain('IPV เข็ม 1');

    const s = summarize([pre, post]);
    expect(s.view2ApplicableTotal).toBe(2);
    expect(s.view2Passed).toBe(2);
    expect(v2Entry(s, 'IPV เข็ม 1')).toMatchObject({ passed: 1, total: 1 });
    expect(v2Entry(s, 'โปลิโอ เข็ม 1 (สูตรเดิม)')).toMatchObject({ passed: 1, total: 1 });
    expect(v2Entry(s, 'BCG 1 เข็ม')).toMatchObject({ passed: 2, total: 2 });
    // View 1: the Inapplicable Rule leaves the dose denominator and its per-rule entry
    expect(s.view1TotalDoses).toBe(6);
    expect(s.view1PassedDoses).toBe(6);
    expect(v1Entry(s, 'IPV เข็ม 2')).toMatchObject({ passed: 1, total: 1 });
  });

  it('still counts a pre-switch child without polio dose 1 as missing the old-regimen rule', () => {
    const v2 = evalV2(child('PRE-NONE', PRE_SWITCH, { bcg_date: '2023-03-02', opv2_date: '2023-07-02' }));
    expect(v2.status).toBe('FAIL');
    expect(v2.missingVaccines).toEqual(['โปลิโอ เข็ม 1 (สูตรเดิม)']);
  });

  it('still counts a post-switch child who received OPV instead of IPV as missing IPV', () => {
    const v2 = evalV2(child('POST-OPV', POST_SWITCH, { bcg_date: '2023-08-02', opv1_date: '2023-10-02', opv2_date: '2023-12-02' }));
    expect(v2.status).toBe('FAIL');
    expect(v2.missingVaccines).toEqual(['IPV เข็ม 1', 'IPV เข็ม 2']);
    expect(v2.passedVaccines).not.toContain('โปลิโอ เข็ม 1 (สูตรเดิม)');
  });

  it('places children born on the cut-off and the day before under exactly one regimen', () => {
    const onCutOff = evalV2(child('ON-CUT-OFF', '2023-05-01'));
    const dayBefore = evalV2(child('DAY-BEFORE', '2023-04-30'));
    const names = (v: ReturnType<typeof evalV2>) => [...v.missingVaccines, ...v.passedVaccines];

    expect(names(onCutOff)).toEqual(['BCG 1 เข็ม', 'IPV เข็ม 1', 'IPV เข็ม 2']);
    expect(onCutOff.inapplicableRules?.map(r => r.display_name)).toEqual(['โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)']);
    expect(names(dayBefore)).toEqual(['BCG 1 เข็ม', 'โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)']);
    expect(dayBefore.inapplicableRules?.map(r => r.display_name)).toEqual(['IPV เข็ม 1', 'IPV เข็ม 2']);
  });

  it('makes windowed rules not evaluable for a child without a valid birth date', () => {
    const noBirth = child('NO-BIRTH', '', { bcg_date: '2023-03-02', ipv1_date: '2023-05-02', ipv2_date: '2023-07-02' });

    const v2 = evalV2(noBirth);
    expect(v2.status).toBe('NOT_EVALUABLE');
    expect(v2.notEvaluableVaccines).toEqual(['IPV เข็ม 1', 'IPV เข็ม 2', 'โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)']);
    expect(v2.inapplicableRules).toEqual([]);

    const v1 = evalV1(noBirth);
    expect(v1.unknownRuleNames).toEqual(['IPV เข็ม 1', 'IPV เข็ม 2', 'โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)']);
    expect(v1.unknownVaccines?.[0]).toBe('IPV เข็ม 1: ไม่มีวันเกิดที่ถูกต้อง');
  });

  it('keeps a child without a birth date FAIL when another rule has a Confirmed Missing Dose (#103)', () => {
    const s = summarize([child('NO-BIRTH-NO-BCG', '', { bcg_date: '' })]);
    expect(s.view2ApplicableTotal).toBe(1);
    expect(s.view2NotEvaluableCount).toBe(0);
    expect(v2Entry(s, 'BCG 1 เข็ม')).toMatchObject({ passed: 0, total: 1 });
    expect(v2Entry(s, 'IPV เข็ม 1')).toMatchObject({ passed: 0, total: 0 });
  });

  it('keeps an Inapplicable Rule out of every list under HDC "ผ่าน" (Issue #101: no backfill)', () => {
    const v2 = evalV2(child('PRE-HDC-PASS', PRE_SWITCH, { result: 'ผ่าน' }));
    expect(v2.status).toBe('FAIL');
    expect(v2.passedVaccines).toEqual([]);
    expect(v2.missingVaccines).toEqual(['BCG 1 เข็ม', 'โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)']);

    const s = summarize([child('PRE-HDC-PASS', PRE_SWITCH, { result: 'ผ่าน' })]);
    expect(v2Entry(s, 'IPV เข็ม 1')).toBeUndefined();
  });

  it('raises neither a missing-column nor a date-check warning for an Inapplicable Rule', () => {
    // IPV columns absent from the file, and an IPV date before birth: both belong to a rule
    // that does not apply to this pre-switch child.
    const pre = child('PRE-NO-IPV-COLUMN', PRE_SWITCH, {
      source_columns: JSON.stringify(['birth', 'bcg_date', 'opv1_date', 'opv2_date']),
      bcg_date: '2023-03-02', opv1_date: '2023-05-02', opv2_date: '2023-07-02', ipv1_date: '2023-01-01',
    });

    const v1 = evalV1(pre);
    expect(v1.unknownRuleNames).toEqual([]);
    expect(v1.missingVaccines).toEqual([]);
    expect(evalV2(pre).status).toBe('PASS');
    expect(getRecordDateWarnings(pre, v2Rules)).toEqual([]);
  });

  it('keeps rules without a Birth Window behaving as before', () => {
    const plain = markSourceAware([bcg, { ...ipv1, born_on_or_after: '' }, { ...polio1, born_before: undefined }]);
    const v2 = evaluateDynamicV2(child('PRE-PLAIN', PRE_SWITCH, { bcg_date: '2023-03-02', opv1_date: '2023-05-02' }), plain, EVALUATION_DATE);
    expect(v2.missingVaccines).toEqual(['IPV เข็ม 1']);
    expect(v2.passedVaccines).toEqual(['BCG 1 เข็ม', 'โปลิโอ เข็ม 1 (สูตรเดิม)']);
    expect(v2.inapplicableRules).toEqual([]);
  });

  it('keeps the record-level partition exact across regimens, missing birth dates and pending children', () => {
    const data = [
      child('PRE-COMPLETE', PRE_SWITCH, { bcg_date: '2023-03-02', opv1_date: '2023-05-02', opv2_date: '2023-07-02' }),
      child('POST-MISSING', POST_SWITCH, { bcg_date: '2023-08-02' }),
      child('NO-BIRTH-BCG', '', { bcg_date: '2023-03-02' }),
      child('YOUNG-PENDING', '2026-10-01', { bcg_date: '2026-10-02' }),
    ];
    const s = summarize(data);
    expect(s.view2ApplicableTotal + s.view2PendingCount + s.view2NotEvaluableCount).toBe(s.total);
    expect([s.view2ApplicableTotal, s.view2PendingCount, s.view2NotEvaluableCount]).toEqual([2, 1, 1]);
    expect(v2Entry(s, 'IPV เข็ม 1')).toMatchObject({ passed: 0, total: 1 });
    expect(v2Entry(s, 'โปลิโอ เข็ม 1 (สูตรเดิม)')).toMatchObject({ passed: 1, total: 1 });
  });

  it('lists the Inapplicable Rules with the window side that excluded the child', () => {
    const pre = evalV2(child('PRE', PRE_SWITCH));
    expect(pre.inapplicableRules).toEqual([
      { rule_id: 'ipv1', display_name: 'IPV เข็ม 1', side: 'born_on_or_after', date: CUT_OFF },
      { rule_id: 'ipv2', display_name: 'IPV เข็ม 2', side: 'born_on_or_after', date: CUT_OFF },
    ]);
    const post = evalV1(child('POST', POST_SWITCH));
    expect(post.inapplicableRules?.map(r => [r.display_name, r.side])).toEqual([
      ['โปลิโอ เข็ม 1 (สูตรเดิม)', 'born_before'],
      ['โปลิโอ เข็ม 2 (สูตรเดิม)', 'born_before'],
    ]);
    expect(inapplicableReason(pre.inapplicableRules![0])).toBe('ไม่ใช้กับเด็กรายนี้ (เกิดก่อน 1 พ.ค. 2566)');
    expect(inapplicableReason(post.inapplicableRules![0])).toBe('ไม่ใช้กับเด็กรายนี้ (เกิดตั้งแต่ 1 พ.ค. 2566)');
  });
});

/**
 * Issue #152 — the Old Polio Regimen includes one IPV at 4 months, held in `ipv2_date`
 * (CONTEXT.md §49). The rule shares the cut-off with the other regimen rules, so it is
 * an Inapplicable Rule for every child born on or after 2023-05-01.
 */
describe('Issue #152 — the Old Polio Regimen requires its 4-month IPV', () => {
  const oldIpv = rule({ rule_id: 'old-ipv', display_name: 'IPV 4 เดือน (สูตรเดิม)', vaccine_group: 'IPV', required_fields: ['ipv2_date'], target_age_months: 4, born_before: CUT_OFF });
  const rules = markSourceAware([bcg, ipv1, ipv2, polio1, polio2, oldIpv]);
  const evalOld = (r: EpiRecord) => evaluateDynamicV2(r, rules, EVALUATION_DATE);
  const summarizeOld = (data: EpiRecord[]) => calcGroupSummary(data, evalV1, evalOld, 2569, [...v1Rules, ...rules]);
  const oldRegimen = { bcg_date: '2023-03-02', opv1_date: '2023-05-02', opv2_date: '2023-07-02' };

  it('counts a pre-switch child without the 4-month IPV as a Confirmed Missing Dose in the rule denominator', () => {
    const noIpv = child('PRE-NO-IPV', PRE_SWITCH, oldRegimen);
    const v2 = evalOld(noIpv);
    expect(v2.status).toBe('FAIL');
    expect(v2.missingVaccines).toEqual(['IPV 4 เดือน (สูตรเดิม)']);

    const s = summarizeOld([noIpv, child('PRE-IPV', PRE_SWITCH, { ...oldRegimen, ipv2_date: '2023-07-02' })]);
    expect(s.view2Passed).toBe(1);
    expect(v2Entry(s, 'IPV 4 เดือน (สูตรเดิม)')).toMatchObject({ passed: 1, total: 2 });
  });

  it('passes a pre-switch child who received the 4-month IPV', () => {
    const v2 = evalOld(child('PRE-IPV', PRE_SWITCH, { ...oldRegimen, ipv2_date: '2023-07-02' }));
    expect(v2.status).toBe('PASS');
    expect(v2.passedVaccines).toContain('IPV 4 เดือน (สูตรเดิม)');
  });

  it('is an Inapplicable Rule for a post-switch child, outside the rule denominator', () => {
    const post = child('POST-IPV', POST_SWITCH, { bcg_date: '2023-08-02', ipv1_date: '2023-10-02', ipv2_date: '2023-12-02' });
    const v2 = evalOld(post);
    expect(v2.status).toBe('PASS');
    expect(v2.passedVaccines).not.toContain('IPV 4 เดือน (สูตรเดิม)');
    expect(v2.inapplicableRules?.map(r => r.display_name)).toEqual(['โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)', 'IPV 4 เดือน (สูตรเดิม)']);
    expect(v2Entry(summarizeOld([post]), 'IPV 4 เดือน (สูตรเดิม)')).toBeUndefined();
  });

  it('places children born on the cut-off and the day before under exactly one regimen', () => {
    const names = (v: ReturnType<typeof evalOld>) => [...v.missingVaccines, ...v.passedVaccines];
    expect(names(evalOld(child('ON-CUT-OFF', '2023-05-01')))).toEqual(['BCG 1 เข็ม', 'IPV เข็ม 1', 'IPV เข็ม 2']);
    expect(names(evalOld(child('DAY-BEFORE', '2023-04-30')))).toEqual(['BCG 1 เข็ม', 'โปลิโอ เข็ม 1 (สูตรเดิม)', 'โปลิโอ เข็ม 2 (สูตรเดิม)', 'IPV 4 เดือน (สูตรเดิม)']);
  });

  it('is not evaluable without a valid birth date, and the child stays FAIL on another Confirmed Missing Dose (#103)', () => {
    const v2 = evalOld(child('NO-BIRTH-NO-BCG', '', { ipv2_date: '2023-07-02' }));
    expect(v2.status).toBe('FAIL');
    expect(v2.missingVaccines).toEqual(['BCG 1 เข็ม']);
    expect(v2.notEvaluableVaccines).toContain('IPV 4 เดือน (สูตรเดิม)');
  });

  it('flags an HDC Result Mismatch when a pre-switch child with only the 4-month IPV passes but HDC says ไม่ผ่าน', () => {
    const v2 = evalOld(child('PRE-IPV-HDC-FAIL', PRE_SWITCH, { ...oldRegimen, ipv2_date: '2023-07-02', result: 'ไม่ผ่าน' }));
    expect(v2.status).toBe('PASS');
    expect(v2.hdcMismatch).toBe(true);
  });

  it('raises no mismatch when the child misses the 4-month IPV and HDC also says ไม่ผ่าน', () => {
    const v2 = evalOld(child('PRE-NO-IPV-HDC-FAIL', PRE_SWITCH, { ...oldRegimen, result: 'ไม่ผ่าน' }));
    expect(v2.status).toBe('FAIL');
    expect(v2.hdcMismatch).toBe(false);
  });
});
