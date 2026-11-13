// @vitest-environment jsdom
/**
 * Issue #159 (spec for #155) — the LoginScreen explains a Session End (CONTEXT.md §51).
 *
 * Seam: the rendered sign-in flow — the real AuthProvider, App root, ProtectedRoute and LoginScreen in a
 * memory router with a public page and a page that requires sign-in, under StrictMode as in the app. The global `fetch` is stubbed per
 * action and Google sign-in is mocked. Assertions are on what the User sees. All data is synthetic.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../../shared/contexts/AuthContext';
import { ProtectedRoute } from '../../../shared/components/ProtectedRoute';
import { SessionEndRedirect } from '../../../shared/components/SessionEndRedirect';
import { fetchApi } from '../../../shared/lib/api';
import App from '../../../App';
import { LoginScreen } from './LoginScreen';

vi.hoisted(() => vi.stubEnv('VITE_GAS_API_URL', 'https://example.test/exec'));

const SESSION_END_NOTICE = 'เซสชันสิ้นสุดแล้ว กรุณาเข้าสู่ระบบอีกครั้ง';

const google = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: (options: any) => {
    google.options = options;
    return () => {};
  },
}));

type Answer = { status: number; data?: unknown };
let answers: Record<string, Answer>;

function answer(action: string, reply: Answer) {
  answers[action] = reply;
}

function seedSession() {
  localStorage.setItem('user', JSON.stringify({ id: 'U-1', name: 'Synthetic User', role: 'user', status: 'approved', hoscode: '00001' }));
  localStorage.setItem('token', 'synthetic-session-token');
}

function RequestButton({ label, action }: { label: string; action: string }) {
  return <button onClick={() => { fetchApi(action).catch(() => {}); }}>{label}</button>;
}

function SignOutButton() {
  const { logout } = useAuth();
  return <button onClick={() => logout()}>Sign out</button>;
}

function renderApp(initialPath: string) {
  // Mirrors the app router: SessionEndRedirect wraps every route, LoginScreen is outside the App root
  const router = createMemoryRouter([{
    element: <SessionEndRedirect />,
    children: [
      { path: '/login', element: <LoginScreen /> },
      {
        path: '/',
        element: <App />,
        children: [
          { path: 'dashboard', element: <div>Public dashboard<RequestButton label="Load public" action="getDashboardSummaries" /></div> },
          {
            element: <ProtectedRoute />,
            children: [
              { path: 'records', element: <div>Records page<RequestButton label="Load records" action="getEpiData" /><SignOutButton /></div> },
            ],
          },
        ],
      },
    ],
  }], { initialEntries: [initialPath] });
  render(<StrictMode><AuthProvider><RouterProvider router={router} /></AuthProvider></StrictMode>);
  return router;
}

/** Each distinct arrival at the LoginScreen, so a test can check that a Session End redirects once. */
function countLoginArrivals(router: ReturnType<typeof renderApp>) {
  const arrivals = new Set<string>();
  router.subscribe(state => {
    if (state.location.pathname === '/login') arrivals.add(state.location.key);
  });
  return arrivals;
}

async function click(label: string) {
  await act(async () => { fireEvent.click(screen.getByText(label)); });
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
  answers = {};
  vi.stubGlobal('localStorage', memoryStorage());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const { action } = JSON.parse(init.body);
    const reply = answers[action] ?? { status: 200, data: { success: true } };
    return { ok: true, status: 200, json: async () => reply };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Issue #159 — a Session End is explained on the LoginScreen', () => {
  it('a 401 on a page that requires sign-in leads to the LoginScreen with the Session End notice', async () => {
    seedSession();
    answer('getEpiData', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    const router = renderApp('/records');

    await click('Load records');

    expect(await screen.findByText('Continue with Google')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByText(SESSION_END_NOTICE)).toBeTruthy();
  });

  it('a 401 on the public dashboard also leads to the LoginScreen with the notice', async () => {
    seedSession();
    answer('getDashboardSummaries', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    const router = renderApp('/dashboard');

    await click('Load public');

    expect(await screen.findByText('Continue with Google')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByText(SESSION_END_NOTICE)).toBeTruthy();
  });

  it.each([
    'Unauthorized: Token expired',
    'Unauthorized: Invalid token or session not found',
    'Unauthorized: Account is not approved',
    'Unauthorized: User not found in database',
    'Unauthorized: No token provided',
  ])('every cause gets the same notice: %s', async error => {
    seedSession();
    answer('getEpiData', { status: 401, data: { error } });
    renderApp('/records');

    await click('Load records');

    expect(await screen.findByText(SESSION_END_NOTICE)).toBeTruthy();
  });

  it('a Sign-out leads to the LoginScreen without the notice', async () => {
    seedSession();
    const router = renderApp('/records');

    await click('Sign out');

    expect(await screen.findByText('Continue with Google')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();
  });

  it('a Sign-out whose session deletion answers 401 still shows no notice', async () => {
    seedSession();
    answer('deleteSession', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    renderApp('/records');

    await click('Sign out');

    expect(await screen.findByText('Continue with Google')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();
  });

  it('starting a sign-in clears the notice, and a failed sign-in shows its error instead', async () => {
    seedSession();
    answer('getEpiData', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    renderApp('/records');
    await click('Load records');
    expect(await screen.findByText(SESSION_END_NOTICE)).toBeTruthy();

    await click('Continue with Google');
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();

    await act(async () => { google.options.onError({ error: 'access_denied' }); });
    expect(screen.getByText('Google Sign-In was unsuccessful.')).toBeTruthy();
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();
  });

  it('a reload after a Session End shows the LoginScreen without the notice', async () => {
    seedSession();
    answer('getEpiData', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    renderApp('/records');
    await click('Load records');
    expect(await screen.findByText(SESSION_END_NOTICE)).toBeTruthy();

    cleanup();
    renderApp('/login');

    expect(await screen.findByText('Continue with Google')).toBeTruthy();
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();
  });

  it('a Lost Response is not a Session End: the User stays signed in on the page', async () => {
    seedSession();
    answer('getEpiData', { status: 405, data: { error: 'GET is not supported' } });
    renderApp('/records');

    await click('Load records');

    expect(screen.getByText('Records page')).toBeTruthy();
    expect(screen.queryByText(SESSION_END_NOTICE)).toBeNull();
  });

  it('several refused requests at once redirect no more than one does, and show the notice once', async () => {
    // ProtectedRoute and SessionEndRedirect both replace to /login in one commit, which the User sees as one
    // LoginScreen; what must not happen is extra redirects per refused request
    async function arrivalsAfter(clicks: number) {
      seedSession();
      answer('getEpiData', { status: 401, data: { error: 'Unauthorized: Token expired' } });
      const arrivals = countLoginArrivals(renderApp('/records'));
      await act(async () => {
        const load = screen.getByText('Load records');
        for (let i = 0; i < clicks; i++) fireEvent.click(load);
      });
      expect(await screen.findAllByText(SESSION_END_NOTICE)).toHaveLength(1);
      cleanup();
      return arrivals.size;
    }

    expect(await arrivalsAfter(3)).toBe(await arrivalsAfter(1));
  });

  it('after a Session End the User can still leave the LoginScreen for the public dashboard', async () => {
    seedSession();
    answer('getEpiData', { status: 401, data: { error: 'Unauthorized: Token expired' } });
    const router = renderApp('/records');
    await click('Load records');
    expect(await screen.findByText(SESSION_END_NOTICE)).toBeTruthy();

    await act(async () => { await router.navigate('/dashboard'); });

    expect(screen.getByText('Public dashboard')).toBeTruthy();
  });
});
