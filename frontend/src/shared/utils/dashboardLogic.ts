import type { EpiRecord, VaccineStatus } from '../types';
import type { VaccineBreakdownEntry } from '../types/dashboardSummary';
import type { View1Evaluation, VaccineRule } from './vaccine/ruleEngine';
// We can define the return type for better type safety
export interface GroupSummary {
  total: number;
  view1UnknownDoses?: number;
  /** Issue #102: dose rules whose dates are present but carry a date warning (ตรวจสอบประวัติ) — excluded from the View 1 denominator */
  view1ReviewDoses?: number;
  view1PassedDoses: number;
  view1TotalDoses: number;
  view1Coverage: number;
  /** Issue #97: breakdown entries share the persisted entry contract (incl. category) */
  view1Breakdown: VaccineBreakdownEntry[];
  facilityBreakdownV1: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];

  view2Passed: number;
  view2Coverage: number;
  view2Breakdown: VaccineBreakdownEntry[];
  facilityBreakdownV2: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];

  /** Issue #23: records included in the View 2 coverage denominator for this snapshot (required on every newly generated summary). */
  view2ApplicableTotal: number;
  /** Issue #23: View 2 Pending records (a Pending Rule and no Confirmed Missing Dose, #119), excluded from the View 2 denominator — counted directly (required on every newly generated summary). */
  view2PendingCount: number;
  /** Issue #89: records excluded from the View 2 denominator because a required V2 rule cannot be
   * evaluated from the source columns (ประเมินไม่ได้) — counted directly (required on every newly generated summary). */
  view2NotEvaluableCount: number;
  /** Issue #102: records whose only problem is a date warning (ตรวจสอบประวัติ) — excluded from the
   * View 2 denominator and counted directly (required on every newly generated summary). */
  view2ReviewCount: number;
}

/**
 * Persisted-summary presentation shape (Issue #23): every newly generated summary carries the
 * denominator contract above, but historical snapshots may predate it — the denominator fields
 * are OPTIONAL here so legacy rows stay consumable without fabricating values.
 */
export type LegacyCompatibleGroupSummary = Omit<GroupSummary, 'view2ApplicableTotal' | 'view2PendingCount' | 'view2NotEvaluableCount' | 'view2ReviewCount' | 'facilityBreakdownV1' | 'facilityBreakdownV2'> &
  Partial<Pick<GroupSummary, 'view2ApplicableTotal' | 'view2PendingCount' | 'view2NotEvaluableCount' | 'view2ReviewCount'>> &
  /** Issue #200 (ADR-0014): the server sends the Facility Breakdown only to a signed-in caller. */
  Partial<Pick<GroupSummary, 'facilityBreakdownV1' | 'facilityBreakdownV2'>>;

/**
 * Issue #80: renderability gate for a stored snapshot before the Dashboard cards
 * dereference it. `getSummary` previously checked only truthiness, so a
 * parseable-but-fieldless `summaryData` row made `view2Coverage.toFixed` throw
 * (a crash, not a wrong number). A snapshot is renderable when every field the
 * cards and the expanded view dereference is present with the right type —
 * legacy snapshots qualify (the denominator fields are optional and handled
 * defensively downstream). Anything else presents as "ยังไม่มีข้อมูลสรุป".
 */
export function isRenderableGroupSummary(value: unknown): value is LegacyCompatibleGroupSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  const numericFields = ['total', 'view1PassedDoses', 'view1TotalDoses', 'view1Coverage', 'view2Passed', 'view2Coverage'];
  if (!numericFields.every(field => typeof summary[field] === 'number' && Number.isFinite(summary[field]))) return false;
  const arrayFields = ['view1Breakdown', 'view2Breakdown'];
  if (!arrayFields.every(field => Array.isArray(summary[field]))) return false;
  // Issue #200: an anonymous caller receives no Facility Breakdown; when present it must be an array.
  return ['facilityBreakdownV1', 'facilityBreakdownV2'].every(field => summary[field] === undefined || Array.isArray(summary[field]));
}

/**
 * คำนวณ Summary แยกมุมมองที่ 1 และ 2 สำหรับกลุ่มอายุ
 *
 * Issue #26 (Decision E — locked seam): the OPTIONAL fifth argument carries the
 * snapshot-time VaccineRule[] used for THIS computation. When provided, breakdown
 * entries are enriched with metric_key (the established key, else the rule's own
 * rule_id) and snapshot-time vaccine_group, looked up by display_name WITHIN the
 * same rule set the evaluators used (intra-snapshot association only — display_name
 * is never a cross-year identity). Existing four-argument calls are unchanged.
 */
export function calcGroupSummary(
  data: EpiRecord[],
  evalView1Fn: (r: EpiRecord) => View1Evaluation,
  evalView2Fn: (r: EpiRecord) => VaccineStatus,
  _fiscalYear?: number, // ไม่ได้ใช้ — HDC นับ active ทุก record ไม่กรองปี
  rules?: VaccineRule[],
): GroupSummary {
  // HDC นับทุก Active record ในชีต โดยไม่กรองปีงบประมาณ
  const filtered = data;
  
  const total = filtered.length;
  let view1UnknownDoses = 0;
  let view1ReviewDoses = 0;
  let view1PassedDoses = 0;
  let view1TotalDoses = 0;
  let view2Passed = 0;
  let view2ApplicableTotal = 0; // Issue #23: the View 2 coverage denominator, counted directly
  let view2PendingCount = 0;    // Issue #23/#119: View 2 Pending records, excluded from that denominator
  let view2NotEvaluableCount = 0; // Issue #89: records excluded because a required V2 rule is not evaluable from the source columns
  let view2ReviewCount = 0; // Issue #102: records excluded because their only problem is a date warning (ตรวจสอบประวัติ)
  
  const view1Details: Record<string, number> = {};
  const view1TargetDetails: Record<string, number> = {}; // NEW: track applicable target per vaccine
  const view2Details: Record<string, number> = {};
  const view2TargetDetails: Record<string, number> = {}; // NEW: track applicable target per vaccine
  const facilityMap: Record<string, { hosname: string; totalV2: number; passedV2: number; totalV1: number; passedV1: number }> = {};
  // กฎที่ไม่นับในตัวหารรายกฎ (ประเมินไม่ได้ #89 / ตรวจสอบประวัติ #102) ยังอยู่ใน breakdown ที่ total 0
  // เพื่อให้ UI แสดง "ยังประเมินไม่ได้" รายกฎ (เหมือน View 1)
  const listV2RulesAtZero = (names: string[] | undefined) => {
    for (const vac of names ?? []) {
      if (view2Details[vac] === undefined) view2Details[vac] = 0;
      if (view2TargetDetails[vac] === undefined) view2TargetDetails[vac] = 0;
    }
  };

  for (const r of filtered) {
    const v1 = evalView1Fn(r);
    view1UnknownDoses += v1.unknownRuleNames?.length || 0;
    view1ReviewDoses += v1.reviewRuleNames?.length || 0;
    const hoscode = r.hoscode || 'unknown';
    if (!facilityMap[hoscode]) {
      facilityMap[hoscode] = { hosname: r.hosname || hoscode, totalV2: 0, passedV2: 0, totalV1: 0, passedV1: 0 };
    }

    if (v1.passedCount !== undefined && v1.results) {
      view1PassedDoses += v1.passedCount;
      // ตัด rule ที่ pending/ประเมินไม่ได้/ตรวจสอบประวัติ (#102) ออกจากตัวหาร — เทียบ display_name กับ key ของ results ให้ตรงกัน
      const applicableCount = Object.keys(v1.results).length - (v1.pendingRuleNames?.length || 0) - (v1.unknownRuleNames?.length || 0) - (v1.reviewRuleNames?.length || 0);
      view1TotalDoses += applicableCount;
      facilityMap[hoscode].passedV1 += v1.passedCount;
      facilityMap[hoscode].totalV1 += applicableCount;
      
      // Aggregate each individual vaccine in View 1
      for (const [vac, passed] of Object.entries(v1.results)) {
        if (!view1Details[vac]) view1Details[vac] = 0;
        if (!view1TargetDetails[vac]) view1TargetDetails[vac] = 0;
        
        // pending/ประเมินไม่ได้/ตรวจสอบประวัติไม่เอามาคิดเป็นตัวหาร (เทียบด้วย display_name ให้ตรง key ของ results)
        if (v1.pendingRuleNames?.includes(vac) || v1.unknownRuleNames?.includes(vac) || v1.reviewRuleNames?.includes(vac)) continue;
        
        view1TargetDetails[vac]++;
        if (passed) view1Details[vac]++;
      }
    } else {
      view1PassedDoses += v1.missingVaccines.length === 0 ? 1 : 0;
      view1TotalDoses += 1;
      facilityMap[hoscode].passedV1 += v1.missingVaccines.length === 0 ? 1 : 0;
      facilityMap[hoscode].totalV1 += 1;
    }

    const v2 = evalView2Fn(r);

    // Issue #89/#102: แบ่งกลุ่มต่อ record เป็น 4 ส่วนไม่ซ้ำกัน — View 2 Pending (#23) / not evaluable
    // (กฎ V2 ที่ไฟล์ยืนยันคอลัมน์ไม่ได้) / ตรวจสอบประวัติ (คำเตือนวันที่) / applicable (ตัวหาร coverage)
    // Issue #119 (design #117, ADR-0006): จัดกลุ่มจาก status ของ engine จุดเดียว — ลำดับ
    // Confirmed Missing Dose > ตรวจสอบประวัติ > Pending Rule > ประเมินไม่ได้ ตัดสินใน evaluateDynamicV2 (`result` ของ HDC ไม่มีผล, #101)
    // เด็กที่ขาดจริงแม้มี Pending Rule หรือคำเตือนวันที่จึงเป็น applicable ไม่ผ่าน;
    // status อื่นหรือไม่มี status (evaluator รุ่นเดิม) → applicable
    if (v2.status === 'PENDING') {
      // Issue #23: count View 2 Pending records directly in the loop — the loop itself creates the
      // exact partition (no post-loop derivation); the other buckets live in the branches below.
      view2PendingCount++;
    } else if (v2.status === 'REVIEW') {
      // Issue #102: คำเตือนวันที่ไม่ใช่เข็มขาด — ออกจากตัวหาร นับแยก (งานคุณภาพข้อมูล ไม่ใช่รายชื่อตามฉีด)
      view2ReviewCount++;
      listV2RulesAtZero(v2.reviewVaccines);
    } else if (v2.status === 'NOT_EVALUABLE') {
      // Issue #89: กฎ V2 ที่ประเมินไม่ได้ทำให้ตัดสินรายคนไม่ได้ — ออกจากตัวหาร นับแยกตามสัญญา
      // view2ApplicableTotal + view2PendingCount + view2NotEvaluableCount + view2ReviewCount === total (#102)
      view2NotEvaluableCount++;
      listV2RulesAtZero(v2.notEvaluableVaccines);
    } else {
      view2ApplicableTotal++;
      if (v2.isFullyImmunized) view2Passed++;
      facilityMap[hoscode].totalV2 += 1;
      if (v2.isFullyImmunized) facilityMap[hoscode].passedV2 += 1;
      
      // Initialize all view 2 vaccines
      if (v2.passedVaccines) {
        for (const vac of v2.passedVaccines) {
          if (view2Details[vac] === undefined) view2Details[vac] = 0;
          if (view2TargetDetails[vac] === undefined) view2TargetDetails[vac] = 0;
        }
      }
      if (v2.missingVaccines) {
        for (const vac of v2.missingVaccines) {
          if (view2Details[vac] === undefined) view2Details[vac] = 0;
          if (view2TargetDetails[vac] === undefined) view2TargetDetails[vac] = 0;
        }
      }
      // Issue #103/#102: เด็กที่ขาดจริงยังอยู่กลุ่มนี้แม้มีกฎประเมินไม่ได้หรือตรวจสอบประวัติ — กฎนั้นแสดงที่ total 0 ไม่นับตัวหารรายกฎ
      listV2RulesAtZero(v2.notEvaluableVaccines);
      listV2RulesAtZero(v2.reviewVaccines);

      // Aggregate each group in View 2
      if (v2.passedVaccines) {
        for (const vac of v2.passedVaccines) {
          view2Details[vac]++;
          view2TargetDetails[vac]++;
        }
      }
      if (v2.missingVaccines) {
        for (const vac of v2.missingVaccines) {
          view2TargetDetails[vac]++;
        }
      }
    }
  }

  const view1Coverage = view1TotalDoses > 0 ? (view1PassedDoses / view1TotalDoses) * 100 : 0;
  const view2Coverage = view2ApplicableTotal > 0 ? (view2Passed / view2ApplicableTotal) * 100 : 0;
  
  // Issue #26 (Decision E): intra-snapshot rule lookup for forward identity metadata.
  // Names emitted by the evaluators are associated with the SAME rule set used for this
  // computation; display_name is only the lookup key here, never a cross-year identity.
  const validKey = (value: string | undefined): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  // Decision E safety rule — uncertain identity → unavailable: an entry is enriched only
  // when the snapshot rule set holds EXACTLY ONE eligible active rule for this
  // (view_type, display_name). A display_name shared by several active rules must never
  // let an arbitrary first match persist false cross-FY identity metadata.
  const rulesByNameAndView = (viewType: number, name: string): VaccineRule | undefined => {
    if (!rules) return undefined;
    const matches = rules.filter(r => r.is_active && r.view_type === viewType && r.display_name === name);
    return matches.length === 1 ? matches[0] : undefined;
  };

  // Issue #101: ผลจากกฎเป็นหลัก engine จึงไม่ปล่อย bucket คำตัดสิน HDC (#97) อีก — ทุกรายการคือกฎวัคซีน
  // reader ยังข้าม `category: 'hdc_verdict'` ใน summary ที่บันทึกไว้ก่อน #101
  const breakdownEntry = (
    name: string, passed: number, targetTotal: number, rule: VaccineRule | undefined,
  ): VaccineBreakdownEntry => ({
    name,
    passed,
    total: targetTotal,
    coverage: targetTotal > 0 ? (passed / targetTotal) * 100 : 0,
    metric_key: rule ? (validKey(rule.metric_key) ?? rule.rule_id) : undefined,
    vaccine_group: rule?.vaccine_group,
  });

  const view1Breakdown = Object.entries(view1Details).map(([name, passed]) =>
    breakdownEntry(name, passed, view1TargetDetails[name] || 0, rules ? rulesByNameAndView(1, name) : undefined),
  ).sort((a, b) => b.coverage - a.coverage);

  const view2Breakdown = Object.entries(view2Details).map(([name, passed]) =>
    breakdownEntry(name, passed, view2TargetDetails[name] || 0, rules ? rulesByNameAndView(2, name) : undefined),
  ).sort((a, b) => b.coverage - a.coverage);
  
  const facilityBreakdownV1 = Object.entries(facilityMap).map(([hoscode, fac]) => ({
    hoscode,
    hosname: fac.hosname,
    total: fac.totalV1,
    passed: fac.passedV1,
    coverage: fac.totalV1 > 0 ? (fac.passedV1 / fac.totalV1) * 100 : 0
  })).sort((a, b) => b.coverage - a.coverage);

  const facilityBreakdownV2 = Object.entries(facilityMap).map(([hoscode, fac]) => ({
    hoscode,
    hosname: fac.hosname,
    total: fac.totalV2,
    passed: fac.passedV2,
    coverage: fac.totalV2 > 0 ? (fac.passedV2 / fac.totalV2) * 100 : 0
  })).sort((a, b) => b.coverage - a.coverage);

  return {
    total,
    view1UnknownDoses,
    view1ReviewDoses,
    view1PassedDoses,
    view1TotalDoses,
    view1Coverage,
    view1Breakdown,
    facilityBreakdownV1,
    view2Passed,
    view2Coverage,
    view2Breakdown,
    facilityBreakdownV2,
    view2ApplicableTotal,
    view2PendingCount,
    view2NotEvaluableCount,
    view2ReviewCount,
  };
}
