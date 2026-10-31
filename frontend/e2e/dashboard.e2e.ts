import { expect, test } from '@playwright/test';
import { mockGasApi } from './helpers';
import {
  dashboardSummariesFixture,
  dashboardYearsFixture,
  targetConfigFixture,
} from './fixtures';

/**
 * Dashboard สาธารณะกับ API จำลอง — ครอบพฤติกรรม Issue #80:
 * ข้อ 7: summaryData ที่แยก JSON ได้แต่ไร้ฟิลด์ ต้องแสดง "ยังไม่มีข้อมูลสรุป" ไม่ใช่ crash
 * ข้อ 11: ค่าเป้าหมายจาก config แสดงเป็นตัวเลข ไม่มี NaN
 */
test.describe('Dashboard (API จำลอง)', () => {
  test('แสดงสรุปที่ครบฟิลด์ · แถวไร้ฟิลด์เป็น "ยังไม่มีข้อมูลสรุป" · เป้าหมายเป็นตัวเลข', async ({ page }) => {
    await mockGasApi(page, {
      getDashboardSummaries: payload => dashboardSummariesFixture(Number(payload.fiscalYear ?? 2570)),
      getDashboardSummaryYears: () => dashboardYearsFixture,
      getTargetConfig: () => targetConfigFixture,
    });
    await page.goto('/dashboard');

    // กลุ่ม 1 ปี: สรุปครบฟิลด์ — coverage จาก fixture (view1 83.33 / view2 66.67)
    await expect(page.getByRole('heading', { name: 'ภาพรวมเด็กอายุครบ 1 ปี' })).toBeVisible();
    await expect(page.getByText('83.33%').first()).toBeVisible();
    await expect(page.getByText('66.67%').first()).toBeVisible();

    // ข้อ 11: เป้าหมายจาก configs (target_q4: 90) ต้องเป็นตัวเลข — ไม่มี NaN ใด ๆ บนหน้า
    await expect(page.getByText('เป้าหมาย: 90% ขึ้นไป').first()).toBeVisible();
    expect(await page.getByText('NaN').count()).toBe(0);

    // ข้อ 7: กลุ่ม 2 ปีมีแถว summaryData = {} (แยก JSON ได้ แต่ไร้ฟิลด์ทั้งหมด)
    // — ต้องแสดง no-data อย่างสงบ ไม่ใช่ crash จาก view2Coverage.toFixed
    await expect(page.getByRole('heading', { name: 'ภาพรวมเด็กอายุครบ 2 ปี' })).toBeVisible();
    await expect(page.getByText(/ยังไม่มีข้อมูลสรุปปีงบประมาณ/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ภาพรวมความครอบคลุมวัคซีน' })).toBeVisible();
  });
});
