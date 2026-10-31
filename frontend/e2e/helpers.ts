import type { Page } from '@playwright/test';

/**
 * Auth + API mocking สำหรับ E2E (Issue #93)
 *
 * เหตุผลที่ไม่ทำ login ทางเลือกบน production (เช่น email + hoscode): hoscode เป็นข้อมูล
 * สาธารณะและ email ค้นหาได้ — ใครก็สวมเป็นเจ้าหน้าที่ไหนก็ได้ ขัด docs/spec.md §3.1
 * (Google OAuth กัน spoofing) และ CLAUDE.md §7 — การทดสอบจึง mock ที่เบราว์เซอร์แทน
 * โดยไม่แตะโค้ด/สิทธิ์ production เลย
 */

/** ตัวตนจำลอง: หลอก AuthContext ผ่าน localStorage ก่อน app script ทำงาน (เส้นทาง boot เดิมของแอป) */
export async function signInAs(page: Page, user: Record<string, unknown>) {
  await page.addInitScript(([mockUser]) => {
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('token', 'e2e-synthetic-session');
  }, [user]);
}

export type MockHandlers = Record<string, (payload: Record<string, any>) => unknown>;

/** ดักทุก call ไป GAS /exec แล้วตอบด้วย fixture — ไม่มี request ใดออกนอกเครื่อง */
export async function mockGasApi(page: Page, handlers: MockHandlers) {
  const seenActions: string[] = [];
  await page.route('**/exec**', route => {
    const url = new URL(route.request().url());
    let action = url.searchParams.get('action') || '';
    let payload: Record<string, any> = {};
    const body = route.request().postData();
    if (body) {
      try { payload = JSON.parse(body); } catch { /* ไม่ใช่ JSON — ใช้ query เพียงอย่างเดียว */ }
      action = action || payload.action || '';
    }
    seenActions.push(action);
    const handler = handlers[action];
    if (!handler) {
      return route.fulfill({
        json: { status: 400, data: { error: `e2e mock: action ที่ยังไม่ได้กำหนด fixture → ${action}` } },
      });
    }
    return route.fulfill({ json: { status: 200, data: handler(payload) } });
  });
  return { seenActions };
}
