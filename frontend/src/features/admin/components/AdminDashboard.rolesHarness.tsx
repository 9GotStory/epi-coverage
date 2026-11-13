/**
 * Shared harness for the Issue #166 / #169 (ADR-0013) row-action tests: `AdminDashboard` on its users
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
import type { User, UserRole } from '../../../shared/types';

// Radix menus in jsdom: pointer-capture stubs and a PointerEvent constructor; menus open by keyboard.
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => undefined;
HTMLElement.prototype.releasePointerCapture ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;
window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;

const person = (google_id: string, role: UserRole, status: User['status'] = 'approved'): User => ({
  id: `id-${google_id}`, google_id, email: `${google_id}@example.test`, name: `ผู้ใช้จำลอง ${google_id}`,
  hoscode: '06422', role, status,
} as User);

/** Signs in as `self` with the given Role, next to a pending `user`, an `admin` and a `superadmin`. */
export const renderAdminDashboardAs = (signedInRole: UserRole) => {
  const self = person('self', signedInRole);
  const users = [self, person('staff', 'user', 'pending'), person('other-admin', 'admin'), person('other-superadmin', 'superadmin')];
  vi.mocked(fetchApi).mockImplementation(async (action: string) => {
    if (action === 'getAllUsers') return { data: users };
    if (action === 'getFacilities') return { data: [] };
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

/** Whether the actions menu of the row with this `google_id` is disabled. */
export const isMenuDisabled = async (googleId: string) => {
  const row = (await screen.findByText(`${googleId}@example.test`)).closest('tr')!;
  return (within(row).getByRole('button', { name: 'Open menu' }) as HTMLButtonElement).disabled;
};

/** Opens the actions menu of the row with this `google_id` and returns it. */
export const openMenuOf = async (googleId: string) => {
  const row = (await screen.findByText(`${googleId}@example.test`)).closest('tr')!;
  fireEvent.keyDown(within(row).getByRole('button', { name: 'Open menu' }), { key: 'Enter' });
  return screen.getByRole('menu');
};
