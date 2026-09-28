/**
 * Issue #39 RED contracts — authenticated Cloudflare Worker OpenData relay.
 *
 * Frozen Option B contract (ADR-0005): one fixed POST endpoint, HMAC-SHA256
 * over exact raw body bytes, ±300 s timestamp window, closed five-field
 * payload, fixed upstream URL, bounded request (2048 B) and response
 * (16 MiB), relay-origin failures marked via X-Epi-Relay and never
 * masquerading as MOPH responses, redacted logging, no retry, no CORS.
 *
 * Tests run inside the real Workers runtime (workerd) via
 * @cloudflare/vitest-plugin — native Request/Response/ReadableStream and real
 * crypto.subtle HMAC. All upstream network is a mock; no test contacts MOPH,
 * Cloudflare, GAS, or Google Sheets. The secret used here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { handleRequest, default as worker, type Env, type RelayDeps, type RelayRequest } from '../src/index';

// ---------- shared fixtures / helpers (all synthetic) ----------

const SECRET = 'synthetic-relay-secret-never-real';
const FROZEN_NOW_MS = 1_790_000_000_000;
const FROZEN_NOW_S = FROZEN_NOW_MS / 1000;
const RELAY_URL = 'https://relay.example/v1/opendata/fetch';
const UPSTREAM_URL = 'https://opendata.moph.go.th/api/report_data';
const MAX_REQUEST_BYTES = 2048;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const VALID_BODY =
  '{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":10000}';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Real Web Crypto HMAC-SHA256 over `<timestamp>\n<exact body bytes>` (Workers runtime). */
async function sign(body: Uint8Array, ts: string, secret: string = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const tsBytes = encoder.encode(ts);
  const data = new Uint8Array(tsBytes.length + 1 + body.length);
  data.set(tsBytes, 0);
  data[tsBytes.length] = 0x0a;
  data.set(body, tsBytes.length + 1);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return 'v1=' + toHex(sig);
}

async function signedRequest(
  body: string | Uint8Array = VALID_BODY,
  opts: { ts?: string; sig?: string; method?: string; path?: string } = {},
): Promise<Request> {
  const bodyBytes = typeof body === 'string' ? encoder.encode(body) : body;
  const ts = opts.ts ?? String(FROZEN_NOW_S);
  const sig = opts.sig ?? await sign(bodyBytes, ts);
  return new Request(`https://relay.example${opts.path ?? '/v1/opendata/fetch'}`, {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Epi-Timestamp': ts, 'X-Epi-Signature': sig },
    body: bodyBytes,
  });
}

/** Mock upstream that records every call and can answer with a fixture or throw. */
type UpstreamCall = { url: string; init: RequestInit };
function recordingUpstream(responder?: (call: UpstreamCall) => Response | Promise<Response>) {
  const calls: UpstreamCall[] = [];
  const fetchImpl = (async (url: any, init?: any) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    if (responder) return responder(call);
    return new Response(JSON.stringify({ statusCode: 200, data: [{ areacode: '540601' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

interface RunOpts {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
}
function run(request: RelayRequest, opts: RunOpts = {}): Promise<Response> {
  const deps: RelayDeps = {
    fetchImpl: opts.fetchImpl ?? recordingUpstream().fetchImpl,
    now: () => FROZEN_NOW_MS,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  };
  return handleRequest(request, opts.env ?? { OPENDATA_RELAY_HMAC_SECRET: SECRET }, deps);
}

const relayToken = (res: Response) => res.headers.get('X-Epi-Relay');
const bodyBytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

// ---------- R16 (Issue #39 correction) bounded inbound body reader ----------

describe('R16 bounded inbound body reader — no pre-auth unbounded request buffering', () => {
  /** Deterministic chunked stream with HWM 0: the source is pulled exactly once per read(). */
  function instrumentedStream(chunks: Uint8Array[]) {
    let index = 0;
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { pulls += 1; if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); },
      cancel() { cancelled = true; },
    }, new CountQueuingStrategy({ highWaterMark: 0 }));
    return { stream, state: () => ({ pulls, cancelled }) };
  }

  it('a chunked body crossing the 2048 boundary with NO Content-Length is cancelled at the bound; the sentinel chunk is never consumed', async () => {
    const SENTINEL = 'sentinel-must-not-be-consumed-39';
    const { stream, state } = instrumentedStream([
      new Uint8Array(1024),            // chunk 1 — inside the bound
      new Uint8Array(1025),            // chunk 2 — crosses 2048 at the 2049th byte
      encoder.encode(SENTINEL),        // chunk 3 — must never be consumed
    ]);
    const request = new Request(RELAY_URL, {
      method: 'POST',
      headers: { 'X-Epi-Timestamp': String(FROZEN_NOW_S), 'X-Epi-Signature': 'v1=' + 'a'.repeat(64) },
      body: stream,
    });
    const up = recordingUpstream();
    const res = await run(request, { fetchImpl: up.fetchImpl });

    expect(relayToken(res)).toBe('request_too_large');
    expect(up.calls.length).toBe(0);                 // no MOPH contact on overflow
    expect(state().cancelled).toBe(true);            // reader cancelled at the boundary
    expect(state().pulls).toBeLessThanOrEqual(2);    // sentinel chunk never pulled
    expect(await res.text()).not.toContain(SENTINEL); // no raw body leakage
  });

  it('2047 bytes (valid signed payload) via stream is accepted past the bound', async () => {
    const pad = 2047 - VALID_BODY.length; // total = 1 + pad + (VALID_BODY.length - 1)
    const padded = `{${' '.repeat(pad)}${VALID_BODY.slice(1)}`;
    expect(encoder.encode(padded).length).toBe(2047);
    const up = recordingUpstream();
    const res = await run(await signedRequest(padded), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
  });

  it('2049 bytes via stream (no Content-Length trust) is rejected at the bound before HMAC/parsing', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('x'.repeat(2049)), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('request_too_large');
    expect(up.calls.length).toBe(0);
  });

  it('a null request body is handled deterministically as an empty byte sequence (no auth bypass)', async () => {
    const up = recordingUpstream();
    // signature over the EMPTY byte sequence with a valid timestamp
    const ts = String(FROZEN_NOW_S);
    const sig = await sign(new Uint8Array(0), ts);
    const res = await run(new Request(RELAY_URL, { method: 'POST', headers: { 'X-Epi-Timestamp': ts, 'X-Epi-Signature': sig } }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('payload_invalid'); // empty body reaches normal validation and fails there — not a bypass
    expect(up.calls.length).toBe(0);
  });
});

describe('R1 route boundary — one fixed POST endpoint', () => {
  it('GET on the fixed path is rejected as method_not_allowed with zero upstream calls', async () => {
    const up = recordingUpstream();
    const res = await run(new Request(RELAY_URL, { method: 'GET' }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('method_not_allowed');
    expect(up.calls.length).toBe(0);
  });

  it('PUT on the fixed path is rejected with zero upstream calls', async () => {
    const up = recordingUpstream();
    const res = await run(new Request(RELAY_URL, { method: 'PUT' }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('method_not_allowed');
    expect(up.calls.length).toBe(0);
  });

  it('POST on a wrong path is rejected as not_found with zero upstream calls', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { path: '/v1/other' }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('not_found');
    expect(up.calls.length).toBe(0);
  });

  it('POST on the fixed path proceeds when the remaining contracts pass', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(res.status).toBe(200);
    expect(up.calls.length).toBe(1);
  });

  it('the production Worker entrypoint delegates into the same handler (real Request wiring)', async () => {
    const res = await worker.fetch!(new Request(RELAY_URL, { method: 'GET' }), {} as Env, {} as ExecutionContext);
    expect(relayToken(res)).toBe('method_not_allowed');
  });
});

// ---------- R2 request bounds ----------

describe('R2 request bounds — 2048-byte signed body ceiling', () => {
  it('declared Content-Length above the ceiling is rejected BEFORE reading the body', async () => {
    const up = recordingUpstream();
    let readerTaken = false;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); } });
    const originalGetReader = body.getReader.bind(body);
    body.getReader = (() => { readerTaken = true; return originalGetReader(); }) as typeof body.getReader;
    const request: RelayRequest = {
      url: RELAY_URL,
      method: 'POST',
      headers: new Headers({ 'content-length': String(MAX_REQUEST_BYTES + 1) }),
      body,
    };
    const res = await run(request, { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('request_too_large');
    expect(readerTaken).toBe(false);
    expect(up.calls.length).toBe(0);
  });

  it('an actually-oversized raw body (no Content-Length trust) is rejected', async () => {
    const up = recordingUpstream();
    const big = encoder.encode('x'.repeat(MAX_REQUEST_BYTES + 1));
    const res = await run(await signedRequest(big), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('request_too_large');
    expect(up.calls.length).toBe(0);
  });

  it('a body of exactly 2048 bytes is accepted past the bound check (authenticated)', async () => {
    const up = recordingUpstream();
    // 2048 bytes of VALID JSON: pad the closed payload with whitespace inside the object
    const pad = MAX_REQUEST_BYTES - VALID_BODY.length; // total = 1 ("{") + pad + (VALID_BODY.length - 1)
    const padded = `{${' '.repeat(pad)}${VALID_BODY.slice(1)}`; // { + spaces + rest of object
    expect(encoder.encode(padded).length).toBe(MAX_REQUEST_BYTES);
    const res = await run(await signedRequest(padded), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
  });
});

// ---------- R3 timestamp ----------

describe('R3 timestamp — ±300 s window around injected frozen clock', () => {
  const tsCase = (deltaSeconds: number | string) =>
    typeof deltaSeconds === 'string' ? deltaSeconds : String(FROZEN_NOW_S + deltaSeconds);

  const rejects = async (ts: number | string, why: string) => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { ts: tsCase(ts) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res), why).toBe('timestamp_invalid');
    expect(up.calls.length, why).toBe(0);
  };

  it('missing timestamp fails closed', async () => {
    const up = recordingUpstream();
    const bodyBytes = encoder.encode(VALID_BODY);
    const res = await run(new Request(RELAY_URL, {
      method: 'POST',
      headers: { 'X-Epi-Signature': await sign(bodyBytes, String(FROZEN_NOW_S)) },
      body: bodyBytes,
    }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('timestamp_invalid');
    expect(up.calls.length).toBe(0);
  });
  it('non-integer timestamp (letters) fails closed', () => rejects('abc', 'letters'));
  it('non-integer timestamp (decimal) fails closed', () => rejects('12.5', 'decimal'));
  it('negative timestamp fails closed', () => rejects('-5', 'negative'));
  it('timestamp 301 s too old fails closed', () => rejects(-301, 'too old'));
  it('timestamp 301 s in the future fails closed', () => rejects(301, 'too new'));
  it('timestamp exactly -300 s is accepted (boundary)', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { ts: tsCase(-300) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
  });
  it('timestamp exactly +300 s is accepted (boundary)', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { ts: tsCase(300) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
  });
});

// ---------- R4 HMAC ----------

describe('R4 HMAC-SHA256 — exact-body authentication', () => {
  it('missing signature fails closed', async () => {
    const up = recordingUpstream();
    const res = await run(new Request(RELAY_URL, {
      method: 'POST',
      headers: { 'X-Epi-Timestamp': String(FROZEN_NOW_S) },
      body: encoder.encode(VALID_BODY),
    }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });

  it('malformed v1 signature (bad prefix) fails closed', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { sig: 'v2=' + 'a'.repeat(64) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });

  it('malformed v1 signature (uppercase hex) fails closed', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { sig: 'v1=' + 'A'.repeat(64) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });

  it('well-formed but WRONG hmac fails closed', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(VALID_BODY, { sig: await sign(encoder.encode(VALID_BODY), String(FROZEN_NOW_S), 'wrong-secret') }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });

  it('correct HMAC authenticates (proceeds to upstream)', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
  });

  it('EXACT-BYTE sensitivity: a signature over body A must not authenticate semantically-identical body B', async () => {
    const up = recordingUpstream();
    const bodyA = '{"tableName":"s_epi1","year":"2569","province":"54","type":"json"}';
    const bodyB = '{ "tableName" : "s_epi1" , "year" : "2569" , "province" : "54" , "type" : "json" }';
    expect(JSON.parse(bodyA)).toEqual(JSON.parse(bodyB)); // semantically identical
    const sigForA = await sign(encoder.encode(bodyA), String(FROZEN_NOW_S));
    const res = await run(await signedRequest(bodyB, { sig: sigForA }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });
});

// ---------- R5 verify before parse ----------

describe('R5 verification happens before JSON parsing', () => {
  it('malformed JSON with an INVALID hmac fails as signature_invalid (parse never reached)', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('{not valid json', { sig: await sign(encoder.encode('something else'), String(FROZEN_NOW_S)) }), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('signature_invalid');
    expect(up.calls.length).toBe(0);
  });

  it('correctly SIGNED malformed JSON fails sanitized as payload_invalid with zero upstream calls', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('{not valid json'), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('payload_invalid');
    expect(up.calls.length).toBe(0);
    expect(await res.text()).not.toContain('not valid json');
  });
});

// ---------- R6 closed payload ----------

describe('R6 closed five-field payload validation', () => {
  const invalid = async (body: string, why: string) => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(body), { fetchImpl: up.fetchImpl });
    expect(relayToken(res), why).toBe('payload_invalid');
    expect(up.calls.length, why).toBe(0);
  };

  it('unknown field rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","extra":1}', 'unknown field'));
  it('unauthorized table rejected', () => invalid('{"tableName":"s_kpi_anc12","year":"2569","province":"54","type":"json"}', 'table not allowed'));
  it('3-digit year rejected', () => invalid('{"tableName":"s_epi1","year":"256","province":"54","type":"json"}', 'year too short'));
  it('5-digit year rejected', () => invalid('{"tableName":"s_epi1","year":"25699","province":"54","type":"json"}', 'year too long'));
  it('numeric year rejected', () => invalid('{"tableName":"s_epi1","year":2569,"province":"54","type":"json"}', 'year must be string'));
  it('wrong province rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"55","type":"json"}', 'province'));
  it('wrong type rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"csv"}', 'type'));
  it('missing required field rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54"}', 'type missing'));
  it('limit 0 rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":0}', 'limit 0'));
  it('limit 10001 rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":10001}', 'limit max+1'));
  it('non-integer limit rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":1.5}', 'limit fractional'));
  it('string limit rejected', () => invalid('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":"100"}', 'limit string'));
  it('array payload rejected', () => invalid('[{"tableName":"s_epi1"}]', 'array'));
  it('null payload rejected', () => invalid('null', 'null'));
  it('primitive payload rejected', () => invalid('"s_epi1"', 'primitive'));
  it('nested payload rejected', () => invalid('{"tableName":{"nested":true},"year":"2569","province":"54","type":"json"}', 'nested object'));
  it('every authorized table accepted', async () => {
    const up = recordingUpstream();
    for (const t of ['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete']) {
      up.calls.length = 0;
      const res = await run(await signedRequest(`{"tableName":"${t}","year":"2569","province":"54","type":"json"}`), { fetchImpl: up.fetchImpl });
      expect(relayToken(res), t).toBeNull();
      expect(up.calls.length, t).toBe(1);
    }
  });
  it('optional limit absent is valid', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('{"tableName":"s_epi1","year":"2569","province":"54","type":"json"}'), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
  });
  it('limit 10000 boundary accepted', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":10000}'), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
  });
  it('limit 1 boundary accepted', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest('{"tableName":"s_epi1","year":"2569","province":"54","type":"json","limit":1}'), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
  });
});

// ---------- R7 fixed upstream ----------

describe('R7 fixed upstream — exactly one fetch to the frozen MOPH URL', () => {
  it('authenticated valid payload triggers exactly one POST to the fixed URL with the exact body bytes, redirects manual', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(up.calls.length).toBe(1);
    const call = up.calls[0];
    expect(call.url).toBe(UPSTREAM_URL);
    expect(call.init.method).toBe('POST');
    expect((call.init.redirect as string | undefined)).toBe('manual');
    const sent = new Uint8Array(await (call.init.body as ArrayBuffer));
    expect(sent).toEqual(encoder.encode(VALID_BODY)); // exact authenticated bytes forwarded
  });

  it('caller authentication headers are NOT forwarded upstream', async () => {
    const up = recordingUpstream();
    await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    const headers = up.calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers)).toContain('Content-Type');
    expect(JSON.stringify(headers)).not.toContain('X-Epi-Signature');
    expect(JSON.stringify(headers)).not.toContain('X-Epi-Timestamp');
  });
});

// ---------- R8 successful pass-through ----------

describe('R8 upstream outcomes pass through untransformed (synthetic fixtures)', () => {
  const fixtures: Array<{ status: number; ct: string; body: string }> = [
    { status: 200, ct: 'application/json', body: JSON.stringify({ statusCode: 200, data: [{ areacode: '540601' }] }) },
    { status: 201, ct: 'application/json', body: JSON.stringify({ statusCode: 200, data: [] }) },
    { status: 403, ct: 'text/html; charset=UTF-8', body: '<!DOCTYPE html><html><body>403</body></html>' },
    { status: 429, ct: 'text/plain', body: 'ThrottlerException: Too Many Requests' },
    { status: 500, ct: 'application/json', body: JSON.stringify({ error: 'upstream boom' }) },
  ];

  for (const f of fixtures) {
    it(`MOPH ${f.status} (${f.ct}) is relayed as an upstream outcome, not a relay error`, async () => {
      const up = recordingUpstream(() => new Response(f.body, { status: f.status, headers: { 'Content-Type': f.ct } }));
      const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
      expect(relayToken(res)).toBeNull();               // no relay-origin marker
      expect(res.status).toBe(f.status);                 // status preserved
      expect(res.headers.get('Content-Type')).toBe(f.ct); // relevant content type preserved
      expect(await bodyBytes(res)).toEqual(encoder.encode(f.body)); // raw bytes preserved
    });
  }
});

// ---------- R9 reserved-header stripping ----------

describe('R9 X-Epi-Relay is relay-owned and stripped from upstream responses', () => {
  it('a spoofed upstream X-Epi-Relay header never reaches the caller', async () => {
    const up = recordingUpstream(() => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Epi-Relay': 'malicious-value' },
    }));
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(res.status).toBe(200);
    expect(relayToken(res)).toBeNull();
    expect(res.headers.get('X-Epi-Relay')).toBeNull();
  });
});

// ---------- R10 upstream transport failure ----------

describe('R10 upstream transport failure is a sanitized relay-origin error', () => {
  it('fetch() throwing yields upstream_transport_error with zero exception leakage', async () => {
    const up = recordingUpstream(() => { throw new Error('secret-laden transport explosion'); });
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('upstream_transport_error');
    const text = await res.text();
    expect(text).not.toContain('explosion');
    expect(text).not.toContain('secret');
    expect(up.calls.length).toBe(1); // attempted once, no retry
  });
});

// ---------- R11 timeout ----------

describe('R11 upstream timeout aborts with no retry', () => {
  it('a hanging upstream is aborted after the (injected) timeout as upstream_timeout', async () => {
    const calls: UpstreamCall[] = [];
    const fetchImpl = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Promise<Response>((_, reject) => {
        (init as RequestInit).signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as typeof fetch;
    const res = await run(await signedRequest(), { fetchImpl, timeoutMs: 40 });
    expect(relayToken(res)).toBe('upstream_timeout');
    expect(calls.length).toBe(1); // no retry
  });
});

// ---------- R12 response bound via Content-Length ----------

describe('R12 declared Content-Length above the 16 MiB ceiling is rejected pre-read', () => {
  it('oversized declared length becomes response_too_large and the body is cancelled unread', async () => {
    let cancelled = false;
    const tinyStream = new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(8)); },
      cancel() { cancelled = true; },
    });
    const up = recordingUpstream(() => ({
      status: 200,
      headers: new Headers({ 'content-length': String(MAX_RESPONSE_BYTES + 1), 'content-type': 'application/json' }),
      body: tinyStream,
    }) as unknown as Response);
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('response_too_large');
    expect(cancelled).toBe(true); // rejected pre-read: the stream is cancelled, not consumed
  });
});

// ---------- R13 response bound without Content-Length ----------

describe('R13 chunked stream crossing the ceiling aborts at the bound (no CL)', () => {
  it('an endless 1 MiB-chunk stream is cancelled at 16 MiB and reported as response_too_large', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const up = recordingUpstream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('response_too_large');
    expect(cancelled).toBe(true);      // reader aborted the stream
    expect(pulls).toBeLessThanOrEqual(18); // stopped at the bound, did not drain an endless stream
  });

  it('a stream that ends exactly at the 16 MiB bound is accepted', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) { if (sent < 16) { sent += 1; controller.enqueue(chunk); } else controller.close(); },
    });
    const up = recordingUpstream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBeNull();
    expect(res.status).toBe(200);
    expect((await bodyBytes(res)).length).toBe(MAX_RESPONSE_BYTES);
  });
});

// ---------- R14 missing Worker secret ----------

describe('R14 missing/blank Worker secret fails closed as relay_not_configured', () => {
  it('absent secret: zero MOPH calls, no accidental unauthenticated mode', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(), { env: {}, fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('relay_not_configured');
    expect(up.calls.length).toBe(0);
  });

  it('whitespace-only secret normalizes as absent', async () => {
    const up = recordingUpstream();
    const res = await run(await signedRequest(), { env: { OPENDATA_RELAY_HMAC_SECRET: '   ' }, fetchImpl: up.fetchImpl });
    expect(relayToken(res)).toBe('relay_not_configured');
    expect(up.calls.length).toBe(0);
  });
});

// ---------- R15 redaction ----------

describe('R15 sanitized errors and logs never carry secrets/signatures/bodies', () => {
  it('generated error responses and log lines are redacted across failure modes', async () => {
    const sink: string[] = [];
    const up = recordingUpstream();
    const sig = await sign(encoder.encode(VALID_BODY), String(FROZEN_NOW_S));

    // signature failure
    const bad = await run(
      await signedRequest(VALID_BODY, { sig: await sign(encoder.encode(VALID_BODY), String(FROZEN_NOW_S), 'wrong') }),
      { fetchImpl: up.fetchImpl, log: l => sink.push(l) },
    );
    expect(relayToken(bad)).toBe('signature_invalid');

    // success path
    const ok = await run(await signedRequest(VALID_BODY, { sig }), { fetchImpl: up.fetchImpl, log: l => sink.push(l) });
    expect(relayToken(ok)).toBeNull();

    const everything = [sink.join('\n'), await bad.text()].join('\n'); // logs + error body only; success bodies legitimately carry upstream data
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(sig);
    expect(everything).not.toContain(VALID_BODY);
    expect(everything).not.toContain('540601'); // upstream fixture content never logged
  });
});

// ---------- R17 (Issue #39 correction 2) whole-lifecycle upstream deadline ----------

describe('R17 whole-lifecycle upstream deadline — one 30 s budget for fetch + body', () => {
  it('T2: headers resolve, body stalls past the deadline → upstream_timeout (not hang/transport/internal)', async () => {
    let cancelled = false;
    const stallingBody = new ReadableStream({
      pull() { return new Promise<never>(() => {}); }, // body never yields a chunk
      cancel() { cancelled = true; },
    });
    const calls: UpstreamCall[] = [];
    let fetchResolved = false;
    const fetchImpl = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      fetchResolved = true; // the defect is specifically the BODY phase
      return new Response(stallingBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const outcome = await Promise.race([
      run(await signedRequest(), { fetchImpl, timeoutMs: 60 }),
      new Promise<'NO-COMPLETION'>((r) => setTimeout(() => r('NO-COMPLETION'), 900)),
    ]);
    if (outcome === 'NO-COMPLETION') {
      throw new Error('RED: body read remained pending after the deadline — timer was cleared after headers, so nothing bounds the body phase');
    }
    expect(fetchResolved).toBe(true);
    expect(calls.length).toBe(1);                                              // no retry
    expect((calls[0].init as RequestInit).signal!.aborted).toBe(true);         // deadline aborted the shared controller
    expect(cancelled).toBe(true);                                              // body reader cancelled/terminated
    expect(relayToken(outcome)).toBe('upstream_timeout');
    expect(await outcome.text()).toBe('{"error":"upstream_timeout"}');    // exact sanitized envelope — no partial upstream body
  });

  it('T3: headers + complete bounded body finish before the deadline → normal pass-through; later timer fire changes nothing', async () => {
    const up = recordingUpstream(() => new Response(JSON.stringify({ statusCode: 200, data: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const res = await run(await signedRequest(), { fetchImpl: up.fetchImpl, timeoutMs: 200 });
    expect(relayToken(res)).toBeNull();
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300)); // elapse past the deadline after completion
    expect(res.status).toBe(200);                 // response remains intact — timer was cleared
  });

  it('T4: body stream errors before the deadline → sanitized upstream_transport_error', async () => {
    const brokenBody = new ReadableStream({
      pull() { throw new Error('secret-laden body explosion'); },
    });
    const calls: UpstreamCall[] = [];
    const fetchImpl = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return new Response(brokenBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const res = await run(await signedRequest(), { fetchImpl, timeoutMs: 5000 });
    expect(relayToken(res)).toBe('upstream_transport_error');
    expect(calls.length).toBe(1);
    expect(await res.text()).not.toContain('explosion');
  });
});

// ---------- R18 (Issue #39-C) non-blocking stream cancellation ----------

describe('R18 cancellation is initiated but NEVER awaited — pending cancel cannot stall failure responses', () => {
  /** Stream whose source cancel() never settles; records that cancellation was initiated. */
  function neverSettlingCancelStream(source: { pull?: (c: ReadableStreamDefaultController) => void }) {
    let cancelInitiated = false;
    const stream = new ReadableStream({
      ...(source.pull ? { pull: source.pull } : {}),
      start(c) { if (!source.pull) c.enqueue(new Uint8Array(8)); },
      cancel() { cancelInitiated = true; return new Promise<never>(() => {}); },
    });
    return { stream, state: () => ({ cancelInitiated }) };
  }
  const PROMPT_SENTINEL = <T,>(p: Promise<T>, ms = 700) =>
    Promise.race([p, new Promise<'NO-COMPLETION'>(r => setTimeout(() => r('NO-COMPLETION'), ms))]);

  it('A: upstream body stalls, deadline fires, cancel never settles → handler still completes upstream_timeout', async () => {
    const { stream, state } = neverSettlingCancelStream({ pull: () => new Promise<never>(() => {}) as unknown as void });
    const calls: UpstreamCall[] = [];
    const fetchImpl = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const outcome = await PROMPT_SENTINEL(run(await signedRequest(), { fetchImpl, timeoutMs: 50 }));
    if (outcome === 'NO-COMPLETION') throw new Error('RED: handler awaited the never-settling cancel and never completed');
    expect(calls.length).toBe(1);                                        // one fetch, no retry
    expect(state().cancelInitiated).toBe(true);                          // cancellation initiated
    expect(relayToken(outcome)).toBe('upstream_timeout');
    expect(await outcome.text()).toBe('{"error":"upstream_timeout"}');   // no partial body
  });

  it('B: inbound 2049-byte body with never-settling cancel → prompt request_too_large, zero upstream, bound before HMAC', async () => {
    const { stream, state } = neverSettlingCancelStream({ pull: (c) => { c.enqueue(new Uint8Array(2049)); } });
    const ts = String(FROZEN_NOW_S);
    const request = new Request(RELAY_URL, {
      method: 'POST',
      headers: { 'X-Epi-Timestamp': ts, 'X-Epi-Signature': 'v1=' + 'b'.repeat(64) }, // deliberately wrong signature
      body: stream,                                                                    // no Content-Length
    });
    const up = recordingUpstream();
    const outcome = await PROMPT_SENTINEL(run(request, { fetchImpl: up.fetchImpl }));
    if (outcome === 'NO-COMPLETION') throw new Error('RED: inbound overflow awaited the never-settling cancel and never completed');
    expect(relayToken(outcome)).toBe('request_too_large');              // bound fires BEFORE HMAC (signature was invalid)
    expect(state().cancelInitiated).toBe(true);
    expect(up.calls.length).toBe(0);
  });

  it('C: upstream streamed-size overflow with never-settling cancel → prompt response_too_large', async () => {
    let enqueued = 0;
    const { stream, state } = neverSettlingCancelStream({
      pull: (c) => { if (enqueued < 17) { enqueued += 1; c.enqueue(new Uint8Array(1024 * 1024)); } else c.close(); },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const outcome = await PROMPT_SENTINEL(run(await signedRequest(), { fetchImpl }));
    if (outcome === 'NO-COMPLETION') throw new Error('RED: size-overflow path awaited the never-settling cancel and never completed');
    expect(relayToken(outcome)).toBe('response_too_large');
    expect(state().cancelInitiated).toBe(true);
  });
});
