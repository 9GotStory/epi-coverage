import { defineConfig } from '@playwright/test';

/**
 * E2E สำหรับ flow หลัง login (Issue #93) — auth แบบ mock ไม่แตะ production:
 * - dev server รันด้วย VITE_GAS_API_URL ปลอม (e2e-mock.invalid) — ทุก request ถูก
 *   page.route ดักจับและตอบด้วย fixtures ข้อมูลจำลองเท่านั้น ไม่มีวันไปถึง backend จริง
 * - ไฟล์ spec ใช้นามสกุล .e2e.ts เพื่อไม่ให้ vitest (ค่าเริ่มต้น *.test./*.spec.) มาเก็บไปรัน
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    env: { VITE_GAS_API_URL: 'https://e2e-mock.invalid/exec' },
  },
});
