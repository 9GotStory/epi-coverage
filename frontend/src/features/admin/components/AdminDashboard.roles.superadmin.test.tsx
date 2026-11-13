// @vitest-environment jsdom
/**
 * Issue #166 / #169 (ADR-0013) — a superadmin keeps today's row actions on every row except its own.
 *
 * Seam: `AdminDashboard` on its users tab (see `AdminDashboard.rolesHarness.tsx`).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, within } from '@testing-library/react';
import { isMenuDisabled, openMenuOf, renderAdminDashboardAs } from './AdminDashboard.rolesHarness';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('a superadmin keeps today\'s actions on every other row, including promote on a user row, but not on its own row (Issue #166)', async () => {
  renderAdminDashboardAs('superadmin');

  expect(await isMenuDisabled('self')).toBe(true);
  expect(await isMenuDisabled('other-admin')).toBe(false);
  expect(await isMenuDisabled('other-superadmin')).toBe(false);

  const staff = await openMenuOf('staff');
  for (const action of ['อนุมัติสิทธิ์เข้าใช้งาน', 'ระงับสิทธิ์ / ปฏิเสธ', 'ย้ายสังกัด / เปลี่ยน รพ.สต.', 'ตั้งเป็น Admin']) {
    expect(within(staff).getByText(action)).toBeTruthy();
  }
});
