import type { EpiRecord, VaccineStatus } from '../types';
import type { View1Evaluation } from './vaccine/vaccine-1yr';

// We can define the return type for better type safety
export interface GroupSummary {
  total: number;
  view1PassedDoses: number;
  view1TotalDoses: number;
  view1Coverage: number;
  view1Breakdown: { name: string; passed: number; total: number; coverage: number }[];
  facilityBreakdownV1: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];
  
  view2Passed: number;
  view2Coverage: number;
  view2Breakdown: { name: string; passed: number; total: number; coverage: number }[];
  facilityBreakdownV2: { hoscode: string; hosname: string; total: number; passed: number; coverage: number }[];
}

/**
 * คำนวณ Summary แยกมุมมองที่ 1 และ 2 สำหรับกลุ่มอายุ
 */
export function calcGroupSummary(
  data: EpiRecord[],
  evalView1Fn: (r: EpiRecord) => View1Evaluation,
  evalView2Fn: (r: EpiRecord) => VaccineStatus,
  _fiscalYear?: number // ไม่ได้ใช้ — HDC นับ active ทุก record ไม่กรองปี
): GroupSummary {
  // HDC นับทุก Active record ในชีต โดยไม่กรองปีงบประมาณ
  const filtered = data;
  
  const total = filtered.length;
  let view1PassedDoses = 0;
  let view1TotalDoses = 0;
  let view2Passed = 0;
  
  const view1Details: Record<string, number> = {};
  const view2Details: Record<string, number> = {};
  const facilityMap: Record<string, { hosname: string; totalV2: number; passedV2: number; totalV1: number; passedV1: number }> = {};

  for (const r of filtered) {
    const v1 = evalView1Fn(r);
    // ถ้ามี passedCount ให้ใช้คำนวณแบบโดสรวม, ถ้าไม่มีให้ถือว่า 1 คน = 1 โดส
    if (v1.passedCount !== undefined && v1.results) {
      view1PassedDoses += v1.passedCount;
      view1TotalDoses += Object.keys(v1.results).length;
      
      // Aggregate each individual vaccine in View 1
      for (const [vac, passed] of Object.entries(v1.results)) {
        if (!view1Details[vac]) view1Details[vac] = 0;
        if (passed) view1Details[vac]++;
      }
    } else {
      view1PassedDoses += v1.missingVaccines.length === 0 ? 1 : 0;
      view1TotalDoses += 1;
    }

    const v2 = evalView2Fn(r);
    if (v2.isFullyImmunized) view2Passed++;
    
    // Initialize all view 2 vaccines
    if (v2.passedVaccines) {
      for (const vac of v2.passedVaccines) {
        if (view2Details[vac] === undefined) view2Details[vac] = 0;
      }
    }
    if (v2.missingVaccines) {
      for (const vac of v2.missingVaccines) {
        if (view2Details[vac] === undefined) view2Details[vac] = 0;
      }
    }

    // Aggregate each group in View 2
    if (v2.passedVaccines) {
      for (const vac of v2.passedVaccines) {
        view2Details[vac]++;
      }
    }
    
    // Aggregate by Facility
    const hoscode = r.hoscode || 'unknown';
    if (!facilityMap[hoscode]) {
      facilityMap[hoscode] = { hosname: r.hosname || hoscode, totalV2: 0, passedV2: 0, totalV1: 0, passedV1: 0 };
    }
    facilityMap[hoscode].totalV2 += 1;
    if (v2.isFullyImmunized) facilityMap[hoscode].passedV2 += 1;
    
    if (v1.passedCount !== undefined && v1.results) {
      facilityMap[hoscode].passedV1 += v1.passedCount;
      facilityMap[hoscode].totalV1 += Object.keys(v1.results).length;
    } else {
      facilityMap[hoscode].passedV1 += v1.missingVaccines.length === 0 ? 1 : 0;
      facilityMap[hoscode].totalV1 += 1;
    }
  }

  const view1Coverage = view1TotalDoses > 0 ? (view1PassedDoses / view1TotalDoses) * 100 : 0;
  const view2Coverage = total > 0 ? (view2Passed / total) * 100 : 0;
  
  const view1Breakdown = Object.entries(view1Details).map(([name, passed]) => ({
    name,
    passed,
    total,
    coverage: total > 0 ? (passed / total) * 100 : 0
  })).sort((a, b) => b.coverage - a.coverage);

  const view2Breakdown = Object.entries(view2Details).map(([name, passed]) => ({
    name,
    passed,
    total,
    coverage: total > 0 ? (passed / total) * 100 : 0
  })).sort((a, b) => b.coverage - a.coverage);
  
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
    view1PassedDoses,
    view1TotalDoses,
    view1Coverage,
    view1Breakdown,
    facilityBreakdownV1,
    view2Passed,
    view2Coverage,
    view2Breakdown,
    facilityBreakdownV2,
  };
}
