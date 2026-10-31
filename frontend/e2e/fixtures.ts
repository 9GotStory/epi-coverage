/**
 * ข้อมูลจำลองสำหรับ E2E (Issue #93) — สังเคราะห์ทั้งหมด
 * ห้ามใส่ข้อมูลบุคคลจริง ค่าจริง หรือ credential จริงใด ๆ (CLAUDE.md §6)
 */

/** ผู้ใช้จำลอง role user สังกัด รพ.สต. จำลอง */
export const syntheticUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'e2e-user-1',
  google_id: 'e2e-google-sub',
  email: 'e2e-user@example.test',
  name: 'ผู้ทดสอบ จำลอง',
  hoscode: '06422',
  role: 'user',
  status: 'approved',
  created_at: '2026-01-01T00:00:00.000Z',
  last_login: '2026-10-31T00:00:00.000Z',
  ...overrides,
});

/** สรุป dashboard จำลองครบทุกฟิลด์ที่ UI อ่าน (สัญญาปัจจุบัน #23/#89) */
export const summaryFixture = (overrides: Record<string, unknown> = {}) => ({
  total: 3,
  view1UnknownDoses: 0,
  view1PassedDoses: 10,
  view1TotalDoses: 12,
  view1Coverage: 83.33,
  view1Breakdown: [
    { name: 'BCG', passed: 3, total: 3, coverage: 100 },
    { name: 'HBV เข็ม 1', passed: 2, total: 3, coverage: 66.67 },
  ],
  facilityBreakdownV1: [{ hoscode: '06422', hosname: 'รพ.สต.จำลอง', total: 12, passed: 10, coverage: 83.33 }],
  view2Passed: 2,
  view2Coverage: 66.67,
  view2Breakdown: [{ name: 'BCG 1 เข็ม', passed: 3, total: 3, coverage: 100 }],
  facilityBreakdownV2: [{ hoscode: '06422', hosname: 'รพ.สต.จำลอง', total: 3, passed: 2, coverage: 66.67 }],
  view2ApplicableTotal: 3,
  view2PendingCount: 0,
  view2NotEvaluableCount: 0,
  ...overrides,
});

const summaryRow = (targetTable: string, fiscalYear: number, summaryData: unknown) => ({
  id: `${targetTable}_${fiscalYear}_all`,
  targetTable,
  fiscalYear,
  summaryData,
  updated_at: '2026-10-30T16:00:00.000Z',
});

/** แถวสรุป 4 กลุ่มอายุ: 1 ปีครบสมบูรณ์ / 2 ปีเป็น JSON ว่างเปล่า (เคส Issue #80 ข้อ 7) / 3-5 ปีไม่มี */
export const dashboardSummariesFixture = (fiscalYear: number) => ({
  success: true,
  summaries: [
    summaryRow('Epi_1_Year', fiscalYear, summaryFixture()),
    summaryRow('Epi_2_Year', fiscalYear, {}),
  ],
});

export const dashboardYearsFixture = {
  success: true,
  tables: { Epi_1_Year: [2569], Epi_2_Year: [2569] },
};

export const targetConfigFixture = { target_q4: 90 };

/** กฎวัคซีนจำลองขั้นต่ำสำหรับหน้า EPI (รูปแบบเดียวกับ getVaccineRules หลัง projection) */
export const vaccineRulesFixture = [
  {
    rule_id: 'e2e-rule-bcg',
    fiscal_year: 2570,
    age_group: '1yr',
    view_type: 1,
    vaccine_group: 'BCG',
    display_name: 'BCG',
    hdc_code: '010',
    required_fields: ['bcg_date'],
    logic_type: 'ALL',
    branch_alt_fields: [],
    is_required_for_v2: true,
    is_active: true,
    target_age_months: 0,
    metric_key: 'e2e-rule-bcg',
  },
];

/** รายบุคคลจำลอง 2 คน — active ทั้งคู่ เกิดในหน้าต่าง FY2570 ของกลุ่มอายุ 1 ปี (ต.ค. 68–ก.ย. 69) */
export const epiRecordsFixture = [
  {
    hoscode: '06422', hosname: 'รพ.สต.จำลอง', pid: 'e2e-0001', cid: '0000000000001',
    name: 'เด็กจำลองหนึ่ง', lname: 'ทดสอบ', sex: '1', birth: '2025-11-20', check_vhid: 'e2e-village',
    bcg_date: '2025-11-20', result: '', is_active: true, fiscal_year: '2570',
  },
  {
    hoscode: '06422', hosname: 'รพ.สต.จำลอง', pid: 'e2e-0002', cid: '0000000000002',
    name: 'เด็กจำลองสอง', lname: 'ทดสอบ', sex: '2', birth: '2026-01-15', check_vhid: 'e2e-village',
    bcg_date: '', result: '', is_active: true, fiscal_year: '2570',
  },
];

export const latestImportTimeFixture = { success: true, timestamp: '2026-10-31T05:30:00.000Z' };
