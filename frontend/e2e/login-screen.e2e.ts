import { expect, test } from '@playwright/test';
import { mockGasApi } from './helpers';

test.describe('หน้า login (ไม่มีตัวตน)', () => {
  test('แสดงหน้า login พร้อมปุ่ม Google — ไม่วิ่งเข้าสู่ระบบเอง', async ({ page }) => {
    await mockGasApi(page, {});
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
