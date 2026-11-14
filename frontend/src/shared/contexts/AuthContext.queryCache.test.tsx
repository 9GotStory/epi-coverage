/** @vitest-environment jsdom */
/**
 * Issue #200 (#197, ADR-0014) — the browser drops every cached API read when the signed-in
 * state changes: sign-in, Sign-out and Session End (CONTEXT.md §51).
 *
 * Without this, a Facility Breakdown (CONTEXT.md §57) fetched while signed in stays on the
 * public /dashboard after Sign-out, and a signed-out summary stays on screen after sign-in.
 *
 * Seam: `AuthProvider` inside a `QueryClientProvider`, driven through `useAuth` and the
 * `auth:unauthorized` event. All fixtures are synthetic; no real accounts or tokens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';
import type { User } from '../types';

vi.mock('../lib/api', () => ({ fetchApi: vi.fn(async () => ({ data: { success: true } })) }));

const user = { id: 'u1', google_id: 'g1', email: 'staff@example.test', name: 'Staff', hoscode: '00001', role: 'user', status: 'approved', created_at: '2026-01-01' } as User;
const SUMMARY_KEY = ['dashboardSummaries', 2569, 'all'];

function Controls() {
  const { login, logout } = useAuth();
  return (
    <>
      <button type="button" onClick={() => login(user, 'synthetic-token-0200')}>sign in</button>
      <button type="button" onClick={() => logout()}>sign out</button>
    </>
  );
}

function renderProvider() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider><Controls /></AuthProvider>
    </QueryClientProvider>,
  );
  client.setQueryData(SUMMARY_KEY, [{ id: 'Epi_1_Year_2569_all' }]);
  return client;
}

// The same in-memory stand-in as LoginScreen.sessionEnd.test.tsx.
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Issue #200 — cached API reads do not survive a change of signed-in state', () => {
  it('clears the cache on sign-in', () => {
    const client = renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
    expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
  });

  it('clears the cache on Sign-out', () => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', 'synthetic-token-0200');
    const client = renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
    expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
  });

  it('clears the cache on Session End', () => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', 'synthetic-token-0200');
    const client = renderProvider();
    act(() => { window.dispatchEvent(new Event('auth:unauthorized')); });
    expect(client.getQueryData(SUMMARY_KEY)).toBeUndefined();
  });
});
