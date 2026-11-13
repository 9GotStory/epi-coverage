// @vitest-environment jsdom
/**
 * Issue #156 — a Lost Response (CONTEXT.md §50) must not sign the User out.
 *
 * The backend answers every GET with status 405; a GET only reaches it when a POST's answer was lost
 * in a redirect. `fetchApi` turns that 405 into a `LostResponseError` and leaves the session alone,
 * while a real 401 still signs the User out.
 *
 * Seam: `fetchApi` with the global `fetch` stubbed, listening for `auth:unauthorized` on `window`.
 * All payloads are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOST_RESPONSE_MESSAGE = 'ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ — คำขออาจทำงานสำเร็จแล้ว โปรดตรวจสอบก่อนทำซ้ำ';

let unauthorized = 0;
const onUnauthorized = () => { unauthorized += 1; };

async function loadApi(answer: unknown) {
  vi.stubEnv('VITE_GAS_API_URL', 'https://example.test/exec');
  vi.stubGlobal('localStorage', { getItem: () => 'synthetic-session-token' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer })));
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  unauthorized = 0;
  window.addEventListener('auth:unauthorized', onUnauthorized);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  window.removeEventListener('auth:unauthorized', onUnauthorized);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Issue #156 — fetchApi and the Lost Response', () => {
  it('a 405 rejects with a LostResponseError carrying the Lost Response message and keeps the session', async () => {
    const { fetchApi, LostResponseError } = await loadApi({ status: 405, data: { error: 'GET is not supported' } });
    const error = await fetchApi('upsertEpiData', { chunk: [] }).catch(err => err);
    expect(error).toBeInstanceOf(LostResponseError);
    expect(error.message).toBe(LOST_RESPONSE_MESSAGE);
    expect(unauthorized).toBe(0);
  });

  it('a 401 still signs the User out and rejects', async () => {
    const { fetchApi, LostResponseError } = await loadApi({ status: 401, data: { error: 'Unauthorized: Session expired' } });
    const error = await fetchApi('upsertEpiData', { chunk: [] }).catch(err => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LostResponseError);
    expect(error.message).toBe('Unauthorized: Session expired');
    expect(unauthorized).toBe(1);
  });

  it('a 200 resolves with the data', async () => {
    const { fetchApi } = await loadApi({ status: 200, data: { success: true, inserted: 2 } });
    await expect(fetchApi('upsertEpiData', { chunk: [] })).resolves.toEqual({ status: 200, data: { success: true, inserted: 2 } });
    expect(unauthorized).toBe(0);
  });
});
