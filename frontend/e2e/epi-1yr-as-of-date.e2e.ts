import { expect, test } from '@playwright/test';
import { mockGasApi, signInAs } from './helpers';
import {
  epiRecordsFixture,
  latestImportTimeFixture,
  syntheticUser,
  vaccineRulesFixture,
} from './fixtures';

/**
 * หน้า EPI เด็ก 1 ปี ในนามผู้ใช้ role `user` (Issue #93 + #80 ข้อ 8):
 * as-of date ต้องมาจาก getLatestImportTime — endpoint ที่ผู้ใช้ทุกสถานะเรียกได้
 * (ก่อนหน้านี้ใช้ getAuditLogs ซึ่งเป็น admin action → user ได้ 403 เสมอ วันที่ไม่แสดงเลย)
 */
test.describe('EPI 1 ปี (ตัวตนจำลอง role user)', () => {
  test('เข้าหน้าหลัง login ได้ และแสดง "ข้อมูล ณ วันที่" จาก getLatestImportTime', async ({ page }) => {
    await signInAs(page, syntheticUser());
    const api = await mockGasApi(page, {
      getEpiData: () => epiRecordsFixture,
      getLatestImportTime: () => latestImportTimeFixture,
      getVaccineRules: () => vaccineRulesFixture,
      getAvailableYears: () => [2570],
    });
    await page.goto('/dashboard/epi-1yr');

    // ผ่านด่าน ProtectedRoute ด้วย role user — ไม่ถูกเด้งกลับ /login
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText('EPI Tracking Dashboard (เด็ก 1 ปี)')).toBeVisible();

    // ตัวชี้วัดหลักของ Issue #80 ข้อ 8: as-of date แสดงสำหรับ user ปกติ
    // (แท็บ view1 เขียนว่า "ข้อมูล ณ {วันที่}" — ใช้ prefix ร่วมกับ view2 ที่มีคำว่า วันที่)
    await expect(page.getByText(/ข้อมูล ณ/).first()).toBeVisible();

    // ข้อมูลจำลอง 2 คน (active) ไหลถึงหน้าจอ
    await expect(page.getByText('เด็กจำลองหนึ่ง').first()).toBeVisible();

    // เรียกผ่าน endpoint ใหม่จริง ไม่ใช่ getAuditLogs ของเดิม
    expect(api.seenActions).toContain('getLatestImportTime');
    expect(api.seenActions).not.toContain('getAuditLogs');
  });
});
