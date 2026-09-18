/**
 * Issue #17 (Ticket D) RED contract — frontend OpenData API honesty.
 *
 * Seam under test: the real exported `fetchOpenData()` from `./openDataApi`,
 * with the shared `fetchApi` (module `../../../shared/lib/api`) mocked so no
 * network is ever touched. Synthetic aggregate fixtures only — no production
 * URLs, secrets, or person-level data; the payload deliberately has no `amp`.
 *
 * Approved matrix #20:
 *   1. malformed successful envelope must REJECT (never silently become []);
 *   2. valid direct array remains accepted;
 *   3. valid `{ data: [...] }` envelope remains accepted.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { fetchApiMock } = vi.hoisted(() => ({ fetchApiMock: vi.fn() }));

vi.mock('../../../shared/lib/api', () => ({ fetchApi: fetchApiMock }));

import { fetchOpenData } from './openDataApi';

const PAYLOAD = { tableName: 's_epi1' as const, year: '2569', province: '54' };
const SYNTHETIC_ROWS = [{ areacode: '540601', target: '10' }];

describe('fetchOpenData response contract (Issue #17)', () => {
  beforeEach(() => {
    fetchApiMock.mockReset();
  });

  it('rejects a successful-but-malformed envelope instead of silently returning []', async () => {
    // Transport-level success whose `data` is neither an array nor an
    // object containing a `data` array — the exact false-empty-data class
    // this ticket exists to close.
    fetchApiMock.mockResolvedValue({ status: 200, data: { unexpected: true } });
    await expect(fetchOpenData(PAYLOAD)).rejects.toThrow();
  });

  it('accepts a valid direct array response and returns its content', async () => {
    fetchApiMock.mockResolvedValue({ status: 200, data: SYNTHETIC_ROWS });
    await expect(fetchOpenData(PAYLOAD)).resolves.toEqual(SYNTHETIC_ROWS);
  });

  it('accepts a valid { data: [...] } envelope and returns the inner array', async () => {
    fetchApiMock.mockResolvedValue({ status: 200, data: { data: SYNTHETIC_ROWS } });
    await expect(fetchOpenData(PAYLOAD)).resolves.toEqual(SYNTHETIC_ROWS);
  });
});
