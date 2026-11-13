// @vitest-environment jsdom
/**
 * Issue #179 / #181 — "ตั้งเป็น Admin" changes only the Role: the request carries no status, so a stored
 * status that is not an Approval Status (CONTEXT.md §34) no longer gets the whole request refused (#162).
 *
 * Seam: `AdminDashboard` on its users tab (see `AdminDashboard.rolesHarness.tsx`). Own file: a Radix
 * menu opens only once per file in jsdom.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { openMenuOf, renderAdminDashboardAs, userWithStoredStatus } from './AdminDashboard.rolesHarness';
import { fetchApi } from '../../../shared/lib/api';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('a superadmin promoting a row whose stored status is not an Approval Status sends the Role alone, with no status (Issue #179)', async () => {
  renderAdminDashboardAs('superadmin', [userWithStoredStatus('broken', 'admin')]);
  // Only this file expects an update: the harness still refuses any other action
  const harnessApi = vi.mocked(fetchApi).getMockImplementation()!;
  vi.mocked(fetchApi).mockImplementation(async (action: string, payload?: unknown) =>
    action === 'updateUserStatus' ? { data: { success: true } } : harnessApi(action, payload));

  const menu = await openMenuOf('broken');
  fireEvent.click(within(menu).getByText('ตั้งเป็น Admin'));
  fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันปรับสิทธิ์' }));

  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith('updateUserStatus', expect.anything()));
  const [, payload] = vi.mocked(fetchApi).mock.calls.find(([action]) => action === 'updateUserStatus')!;
  expect(payload).toEqual({ googleId: 'broken', role: 'admin' });
  expect(payload).not.toHaveProperty('status');
});
