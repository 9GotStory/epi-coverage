/**
 * epi-coverage OpenData relay — Cloudflare Worker (Issue #39, ADR-0005).
 *
 * Frozen contract: one fixed POST endpoint, HMAC-SHA256 over the EXACT raw
 * request body bytes (verify-before-parse), ±300 s timestamp window, closed
 * five-field aggregate payload, fixed server-side MOPH upstream URL (never
 * caller-supplied), 2048-byte request ceiling, 16 MiB bounded upstream
 * response reading, relay-origin failures marked ONLY via the reserved
 * X-Epi-Relay header, sanitized logging, no retry, no CORS. MOPH responses
 * pass through untransformed — the GAS classifier stays authoritative.
 */

export interface Env {
  OPENDATA_RELAY_HMAC_SECRET?: string;
}

/** Injectable seams for tests. Production entrypoint uses global fetch, real time, real env. */
export interface RelayDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  /** Test seam; production default is the frozen 30000 ms upstream timeout. */
  timeoutMs?: number;
  /** Test sink; production default is console.log with sanitized fields only. */
  log?: (line: string) => void;
}

/** Structural request type — the production entrypoint passes a real Request. */
export type RelayRequest = {
  url: string;
  method: string;
  headers: Headers;
  /** Inbound body stream; null/absent is treated as an empty byte sequence (no auth bypass). */
  body?: ReadableStream<Uint8Array> | null;
};

/** Structural upstream response — real fetch Response satisfies this. */
type UpstreamResponse = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

const RELAY_PATH = '/v1/opendata/fetch';
const UPSTREAM_URL = 'https://opendata.moph.go.th/api/report_data';
const MAX_REQUEST_BYTES = 2048;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // 16777216
const TIMESTAMP_WINDOW_SECONDS = 300;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30000;

const ALLOWED_TABLES = new Set(['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete']);
const ALLOWED_KEYS = new Set(['tableName', 'year', 'province', 'type', 'limit']);

type RelayErrorToken =
  | 'not_found'
  | 'method_not_allowed'
  | 'request_too_large'
  | 'relay_not_configured'
  | 'timestamp_invalid'
  | 'signature_invalid'
  | 'payload_invalid'
  | 'upstream_timeout'
  | 'upstream_transport_error'
  | 'response_too_large'
  | 'internal_error';

const ERROR_STATUS: Record<RelayErrorToken, number> = {
  not_found: 404,
  method_not_allowed: 405,
  request_too_large: 413,
  relay_not_configured: 503,
  timestamp_invalid: 401,
  signature_invalid: 401,
  payload_invalid: 400,
  upstream_timeout: 504,
  upstream_transport_error: 502,
  response_too_large: 502,
  internal_error: 500,
};

/**
 * Relay-generated failure: the reserved X-Epi-Relay header carries the closed
 * error token and the body stays generic/sanitized — no secrets, signatures,
 * raw bodies, or exception text ever enter either.
 */
function relayError(token: RelayErrorToken): Response {
  return new Response(JSON.stringify({ error: token }), {
    status: ERROR_STATUS[token],
    headers: { 'Content-Type': 'application/json', 'X-Epi-Relay': token },
  });
}

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === '';
}

const encoder = new TextEncoder();

function concatSigningInput(timestamp: string, body: Uint8Array): Uint8Array {
  const tsBytes = encoder.encode(timestamp);
  const data = new Uint8Array(tsBytes.length + 1 + body.length);
  data.set(tsBytes, 0);
  data[tsBytes.length] = 0x0a; // one LF byte between timestamp and exact body bytes
  data.set(body, tsBytes.length + 1);
  return data;
}

/**
 * Best-effort, NON-BLOCKING reader/stream cancellation (Issue #39-C):
 * reader.cancel() is initiated and any rejection is swallowed, but settlement
 * is NEVER awaited — a cancel promise that never settles must not prevent the
 * sanitized failure response from completing. Synchronous cleanup failures are
 * also contained. No further application-level reads occur after this point.
 */
function cancelQuietly(cancellable: { cancel(): Promise<void> }): void {
  try {
    cancellable.cancel().catch(() => {});
  } catch {
    // synchronous cleanup exception — never block the failure path
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Closed payload validation — no domain normalization, no unknown fields, no nesting. */
function validatePayload(raw: Uint8Array): { ok: true; tableName: string } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false };
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false };
  }
  if (typeof record.tableName !== 'string' || !ALLOWED_TABLES.has(record.tableName)) return { ok: false };
  if (typeof record.year !== 'string' || !/^\d{4}$/.test(record.year)) return { ok: false };
  if (record.province !== '54') return { ok: false };
  if (record.type !== 'json') return { ok: false };
  if ('limit' in record) {
    const limit = record.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10000) return { ok: false };
  }
  return { ok: true, tableName: record.tableName };
}

/**
 * Bounded incremental read of the upstream body. Two independent fail-closed
 * bounds, whichever is reached first:
 *   - size: the 16 MiB byte ceiling (Content-Length is an early check only;
 *     actual counted bytes are the authority);
 *   - time: the SAME AbortSignal deadline that bounds the fetch — body reads
 *     are raced against the signal so a stalled body stream cannot outlive
 *     the whole-lifecycle upstream deadline.
 * Classification uses controlled signal state, never exception text.
 */
async function readBounded(
  upstream: UpstreamResponse,
  signal: AbortSignal,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'response_too_large' | 'timeout' | 'transport' }> {
  if (upstream.body == null) return { ok: true, bytes: new Uint8Array(0) };
  // Deadline interruption: rejects while the shared whole-lifecycle signal aborts.
  let interrupt: () => void;
  const interruption = new Promise<never>((_, reject) => {
    interrupt = () => reject(new Error('deadline-exceeded'));
    if (signal.aborted) interrupt();
    else signal.addEventListener('abort', interrupt, { once: true });
  });
  interruption.catch(() => {}); // no unhandled rejection if no read is pending at abort time
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const declaredLength = upstream.headers.get('content-length');
    if (declaredLength != null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        // reader (lock holder) — best-effort, never awaited
        cancelQuietly(reader);
        return { ok: false, reason: 'response_too_large' };
      }
    }
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), interruption]);
      if (done) break;
      // defensive: runtime must hand us byte chunks
      const chunk = value as Uint8Array;
      total += chunk.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        cancelQuietly(reader);
        return { ok: false, reason: 'response_too_large' };
      }
      chunks.push(chunk);
    }
  } catch {
    // Controlled classification: signal state decides timeout vs transport —
    // never exception text. Reader cancellation initiated; no partial body returned.
    cancelQuietly(reader);
    return { ok: false, reason: signal.aborted ? 'timeout' : 'transport' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, bytes };
}

/**
 * Bounded incremental inbound-body reader (Issue #39 correction): the request
 * body is NEVER buffered beyond maxBytes, even when Content-Length is absent
 * or dishonest. The moment an additional chunk would push the total past the
 * limit, the reader is cancelled (further chunks are not consumed) and a
 * deterministic bounded-read failure is returned. Accepted bodies preserve the
 * exact original bytes in original order — no UTF-8 decode/re-encode — so the
 * same bytes serve HMAC verification and upstream forwarding.
 */
async function readBoundedRequestBody(
  request: RelayRequest,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const stream = request.body;
  if (stream == null) return { ok: true, bytes: new Uint8Array(0) };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    if (total + chunk.byteLength > maxBytes) {
      // stop reading at the bound; do NOT consume further chunks
      cancelQuietly(reader);
      return { ok: false };
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, bytes };
}

/**
 * The relay lifecycle. Order is frozen: route → method → secret configured →
 * bounded raw body → timestamp → HMAC over exact bytes → JSON parse → closed
 * payload validation → exactly one upstream fetch → bounded read → verbatim
 * pass-through. MOPH is only reachable after every check passes.
 */
export async function handleRequest(request: RelayRequest, env: Env, deps: RelayDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const logOutcome = (outcome: string, tableName?: string) => {
    // Sanitized semantic fields only: time, dataset when safely parsed, outcome.
    log(JSON.stringify({ ts: new Date(deps.now()).toISOString(), ...(tableName ? { table: tableName } : {}), outcome }));
  };

  try {
    const url = new URL(request.url);
    if (url.pathname !== RELAY_PATH) {
      logOutcome('not_found');
      return relayError('not_found');
    }
    if (request.method !== 'POST') {
      logOutcome('method_not_allowed');
      return relayError('method_not_allowed');
    }

    // Fail closed when the Worker secret is missing/blank — no unauthenticated mode exists.
    const secret = env.OPENDATA_RELAY_HMAC_SECRET;
    if (isBlank(secret)) {
      logOutcome('relay_not_configured');
      return relayError('relay_not_configured');
    }

    // Request bound: reject on declared Content-Length BEFORE reading, then
    // independently verify the actual byte count after reading.
    const declaredRequestLength = request.headers.get('content-length');
    if (declaredRequestLength != null) {
      const declared = Number(declaredRequestLength);
      if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
        logOutcome('request_too_large');
        return relayError('request_too_large');
      }
    }
    // Bounded incremental read: Content-Length is only an optimization above;
    // the authority is the counted stream read, cancelled at the 2048-byte bound.
    const boundedBody = await readBoundedRequestBody(request, MAX_REQUEST_BYTES);
    if (!boundedBody.ok) {
      logOutcome('request_too_large');
      return relayError('request_too_large');
    }
    const rawBody = boundedBody.bytes;

    // Timestamp: Unix-seconds syntax + ±300 s window around the real clock.
    const timestamp = request.headers.get('x-epi-timestamp') ?? '';
    if (!/^\d+$/.test(timestamp)) {
      logOutcome('timestamp_invalid');
      return relayError('timestamp_invalid');
    }
    const supplied = Number(timestamp);
    const serverNowSeconds = Math.floor(deps.now() / 1000);
    if (!Number.isSafeInteger(supplied) || Math.abs(serverNowSeconds - supplied) > TIMESTAMP_WINDOW_SECONDS) {
      logOutcome('timestamp_invalid');
      return relayError('timestamp_invalid');
    }

    // Signature syntax: v1=<64 lowercase hex>.
    const signatureHeader = request.headers.get('x-epi-signature') ?? '';
    const match = /^v1=([0-9a-f]{64})$/.exec(signatureHeader);
    if (!match) {
      logOutcome('signature_invalid');
      return relayError('signature_invalid');
    }

    // Constant-time HMAC-SHA256 verification over the EXACT raw body bytes —
    // crypto.subtle.verify; never parse/re-serialize before this point.
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret!), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const signatureValid = await crypto.subtle.verify(
      'HMAC', key, hexToBytes(match[1]), concatSigningInput(timestamp, rawBody),
    );
    if (!signatureValid) {
      logOutcome('signature_invalid');
      return relayError('signature_invalid');
    }

    // Only now may the body be parsed and validated.
    const payload = validatePayload(rawBody);
    if (!payload.ok) {
      logOutcome('payload_invalid');
      return relayError('payload_invalid');
    }

    // Exactly ONE upstream fetch to the fixed URL; redirects manual; caller
    // auth headers never forwarded; finite timeout; no retry.
    // ONE deadline for the WHOLE upstream lifecycle — fetch initiation,
    // response headers, AND bounded response-body consumption share the same
    // 30000 ms budget and the same AbortController. The timer is cleared only
    // after the bounded body is fully accepted or the lifecycle has failed.
    const timeoutMs = deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let upstream: UpstreamResponse;
    let bounded: Awaited<ReturnType<typeof readBounded>>;
    try {
      upstream = await deps.fetchImpl(UPSTREAM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody, // forward the already-authenticated exact bytes
        redirect: 'manual',
        signal: controller.signal,
      }) as UpstreamResponse;
      bounded = await readBounded(upstream, controller.signal);
    } catch {
      const token: RelayErrorToken = timedOut ? 'upstream_timeout' : 'upstream_transport_error';
      logOutcome(token, payload.tableName);
      return relayError(token);
    } finally {
      clearTimeout(timer);
    }
    if (!bounded.ok) {
      const token: RelayErrorToken =
        bounded.reason === 'response_too_large' ? 'response_too_large'
          : bounded.reason === 'timeout' ? 'upstream_timeout'
            : 'upstream_transport_error';
      logOutcome(token, payload.tableName);
      return relayError(token);
    }

    // Verbatim pass-through: status, accepted bytes, relevant content type.
    // Copy ONLY Content-Type — never wholesale headers (never copy a spoofed
    // upstream X-Epi-Relay, and no hop-by-hop headers).
    const nullBodyStatus = upstream.status === 204 || upstream.status === 304;
    logOutcome(`upstream_${upstream.status}`, payload.tableName);
    return new Response(nullBodyStatus && bounded.bytes.byteLength === 0 ? null : bounded.bytes, {
      status: upstream.status,
      headers: upstream.headers.get('content-type')
        ? { 'Content-Type': upstream.headers.get('content-type')! }
        : {},
    });
  } catch {
    // Sanitized terminal fallback — no exception text anywhere.
    logOutcome('internal_error');
    return relayError('internal_error');
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Production wiring: global fetch, real server time, real env secret.
    return handleRequest(request, env, { fetchImpl: fetch, now: () => Date.now() });
  },
} satisfies ExportedHandler<Env>;
