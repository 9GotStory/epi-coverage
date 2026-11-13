// @vitest-environment jsdom
/**
 * Issue #172 (spec for #164) — the LoginScreen signs a User in on Approval Status `approved` alone;
 * a Role never stands in for it (CONTEXT.md §34, docs/features.md §1).
 * Issue #175 — a refused sign-in shows the server's refusal as given; a success answer with a status the server
 * never sends shows the refusal that names no Approval Status (docs/features.md §1).
 *
 * Seam: the rendered sign-in flow — the real AuthProvider and LoginScreen in a memory router, under StrictMode
 * as in the app. The global `fetch` is stubbed with the `loginWithGoogle` answer and Google sign-in is mocked.
 * Assertions are on what the User sees and on whether a session was stored. All data is synthetic.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../../../shared/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';

vi.hoisted(() => vi.stubEnv('VITE_GAS_API_URL', 'https://example.test/exec'));

const google = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: (options: any) => {
    google.options = options;
    return () => {};
  },
}));

// Issue #171 / #175: the refusal texts in docs/features.md §1
const REJECTED_REFUSAL = 'บัญชีนี้ถูกระงับสิทธิ์การเข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
const INVALID_STATUS_REFUSAL = 'ไม่สามารถเข้าสู่ระบบได้ เนื่องจากสถานะบัญชีไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ';

let loginAnswer: unknown;

function renderLogin() {
  const router = createMemoryRouter([
    { path: '/login', element: <LoginScreen /> },
    { path: '/dashboard', element: <div>Dashboard page</div> },
  ], { initialEntries: ['/login'] });
  render(<StrictMode><AuthProvider><RouterProvider router={router} /></AuthProvider></StrictMode>);
}

async function signInWithGoogle() {
  await act(async () => { await google.options.onSuccess({ access_token: 'synthetic-google-token' }); });
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 200, data: loginAnswer }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Issue #172 — the LoginScreen signs a User in on Approval Status approved alone', () => {
  it.each(['admin', 'superadmin'])('keeps a %s whose Approval Status is not approved signed out', async role => {
    loginAnswer = {
      success: true,
      isNewUser: false,
      status: 'rejected',
      user: { id: 'U-1', name: 'Synthetic Admin', role, status: 'rejected', hoscode: '00001' },
      session_id: 'synthetic-session-id',
    };
    renderLogin();

    await signInWithGoogle();

    expect(screen.getByText(INVALID_STATUS_REFUSAL)).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('signs in a User whose Approval Status is approved and takes them to the dashboard', async () => {
    loginAnswer = {
      success: true,
      isNewUser: false,
      status: 'approved',
      user: { id: 'U-2', name: 'Synthetic User', role: 'user', status: 'approved', hoscode: '00001' },
      session_id: 'synthetic-session-id',
    };
    renderLogin();

    await signInWithGoogle();

    expect(screen.getByText('Dashboard page')).toBeTruthy();
    expect(localStorage.getItem('token')).toBe('synthetic-session-id');
  });
});

describe('Issue #175 — a refused sign-in shows the server\'s refusal as given', () => {
  it('shows the server\'s ระงับสิทธิ์ refusal and stores no session', async () => {
    loginAnswer = { success: false, error: REJECTED_REFUSAL };
    renderLogin();

    await signInWithGoogle();

    expect(screen.getByText(REJECTED_REFUSAL)).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });
});
