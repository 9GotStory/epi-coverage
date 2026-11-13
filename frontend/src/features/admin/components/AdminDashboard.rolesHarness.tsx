/**
 * Shared harness for the Issue #166 / #169 (ADR-0013) row-action tests and the Issue #174 status-badge tests: `AdminDashboard` on its users
 * tab, with the signed-in User from `AuthContext` and the API client mocked by the test file.
 *
 * Each Role has its own test file: in jsdom, once a test has opened a Radix dropdown menu, a menu in
 * a later test of the same file no longer opens, and vitest isolates modules per file.
 *
 * All fixtures are synthetic. No real health data, CID, identifiers, or secrets.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { AdminDashboard } from './AdminDashboard';
import { AuthContext } from '../../../shared/contexts/AuthContext';
import { fetchApi } from '../../../shared/lib/api';
import type { UserRole } from '../../../shared/types';
import type { UserRow } from './columns';

// Radix menus in jsdom: pointer-capture stubs and a PointerEvent constructor; menus open by keyboard.
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => undefined;
HTMLElement.prototype.releasePointerCapture ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;
window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;

// `status` is any stored value: the Users sheet can hold a value that is not an Approval Status (Issue #174).
const person = (google_id: string, role: UserRole, status: string = 'approved'): UserRow => ({
  id: `id-${google_id}`, google_id, email: `${google_id}@example.test`, name: `ผู้ใช้จำลอง ${google_id}`,
  hoscode: '06422', role, status, created_at: '2026-01-01',
});

/** A `user` row whose stored status is exactly `status`, whether or not it is an Approval Status (Issue #174). */
export const userWithStoredStatus = (googleId: string, status: string) => person(googleId, 'user', status);

/** Signs in as `self` with the given Role, next to a pending `user`, an `admin`, a `superadmin` and any `extraRows`. */
export const renderAdminDashboardAs = (signedInRole: UserRole, extraRows: UserRow[] = []) => {
  const self = person('self', signedInRole);
  const users = [self, person('staff', 'user', 'pending'), person('other-admin', 'admin'), person('other-superadmin', 'superadmin'), ...extraRows];
  vi.mocked(fetchApi).mockImplementation(async (action: string) => {
    if (action === 'getAllUsers') return { data: users };
    if (action === 'getFacilities') return { data: [] };
    if (action === 'updateUserStatus') return { data: { success: true } };
    throw new Error(`unexpected ${action}`);
  });
  const auth = { user: self } as unknown as React.ContextType<typeof AuthContext>;
  const router = createMemoryRouter([{ path: '/', element: <AdminDashboard /> }]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}><RouterProvider router={router} /></AuthContext.Provider>
    </QueryClientProvider>,
  );
};

/** The table row of the User with this `google_id`. */
export const rowOf = async (googleId: string) => (await screen.findByText(`${googleId}@example.test`)).closest('tr')!;

/** Whether the actions menu of the row with this `google_id` is disabled. */
export const isMenuDisabled = async (googleId: string) => {
  const row = await rowOf(googleId);
  return (within(row).getByRole('button', { name: 'Open menu' }) as HTMLButtonElement).disabled;
};

/** Opens the actions menu of the row with this `google_id` and returns it. */
export const openMenuOf = async (googleId: string) => {
  const row = await rowOf(googleId);
  fireEvent.keyDown(within(row).getByRole('button', { name: 'Open menu' }), { key: 'Enter' });
  return screen.getByRole('menu');
};
