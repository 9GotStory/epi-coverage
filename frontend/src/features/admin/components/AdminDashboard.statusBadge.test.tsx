// @vitest-environment jsdom
/**
 * Issue #174 / #178 — the status badge names an Approval Status (CONTEXT.md §34) only for its exact
 * value; any other stored value reads "สถานะไม่ถูกต้อง" (CONTEXT.md §36), never "ระงับสิทธิ์".
 *
 * Seam: `AdminDashboard` on its users tab (see `AdminDashboard.rolesHarness.tsx`).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, within } from '@testing-library/react';
import { renderAdminDashboardAs, rowOf, userWithStoredStatus } from './AdminDashboard.rolesHarness';

vi.mock('../../../shared/lib/api', () => ({ fetchApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('a stored status that is not an Approval Status shows สถานะไม่ถูกต้อง, not ระงับสิทธิ์ (Issue #174)', async () => {
  const stored = { blank: '', legacy: 'admin', 'wrong-case': 'Approved', padded: ' approved' };
  renderAdminDashboardAs('admin', Object.entries(stored).map(([id, status]) => userWithStoredStatus(id, status)));

  for (const id of Object.keys(stored)) {
    const row = await rowOf(id);
    expect(within(row).getByText('สถานะไม่ถูกต้อง')).toBeTruthy();
    expect(within(row).queryByText('ระงับสิทธิ์')).toBeNull();
    expect(within(row).queryByText('อนุญาต')).toBeNull();
  }
});

it('each Approval Status shows its own name: อนุญาต, รออนุมัติ, ระงับสิทธิ์ (Issue #174)', async () => {
  const named = { approved: 'อนุญาต', pending: 'รออนุมัติ', rejected: 'ระงับสิทธิ์' };
  renderAdminDashboardAs('admin', Object.keys(named).map(status => userWithStoredStatus(`is-${status}`, status)));

  for (const [status, name] of Object.entries(named)) {
    const row = await rowOf(`is-${status}`);
    expect(within(row).getByText(name)).toBeTruthy();
    expect(within(row).queryByText('สถานะไม่ถูกต้อง')).toBeNull();
  }
});
