// @vitest-environment jsdom
/**
 * Issue #166 / #169 (ADR-0013) — an admin is offered only what the server allows: changes to rows
 * whose Role is `user`, never a Role change, and nothing on its own row.
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

it('an admin manages only rows whose Role is user, is never offered a Role change, and cannot act on its own row (Issue #166)', async () => {
  renderAdminDashboardAs('admin');

  expect(await isMenuDisabled('self')).toBe(true);
  expect(await isMenuDisabled('other-admin')).toBe(true);
  expect(await isMenuDisabled('other-superadmin')).toBe(true);

  const staff = await openMenuOf('staff');
  expect(within(staff).getByText('อนุมัติสิทธิ์เข้าใช้งาน')).toBeTruthy();
  expect(within(staff).getByText('ย้ายสังกัด / เปลี่ยน รพ.สต.')).toBeTruthy();
  expect(within(staff).queryByText('ตั้งเป็น Admin')).toBeNull();
});
