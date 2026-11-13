// @vitest-environment jsdom
/**
 * Issue #174 / #178 — a row whose stored status is not an Approval Status (CONTEXT.md §34) keeps both
 * repairs: approving and rejecting each replace the value with an Approval Status.
 *
 * Seam: `AdminDashboard` on its users tab (see `AdminDashboard.rolesHarness.tsx`). Own file: a Radix
 * menu opens only once per file in jsdom.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, within } from '@testing-library/react';
import { openMenuOf, renderAdminDashboardAs, userWithStoredStatus } from './AdminDashboard.rolesHarness';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('an admin is offered both approve and reject on a row whose stored status is not an Approval Status (Issue #174)', async () => {
  renderAdminDashboardAs('admin', [userWithStoredStatus('broken', 'admin')]);

  const menu = await openMenuOf('broken');
  expect(within(menu).getByText('อนุมัติสิทธิ์เข้าใช้งาน')).toBeTruthy();
  expect(within(menu).getByText('ระงับสิทธิ์ / ปฏิเสธ')).toBeTruthy();
});
