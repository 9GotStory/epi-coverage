# ADR-0005: Route OpenData Acquisition Through an External Fetch Relay

* Status: Accepted
* Date: 2026-09-28
* Recorded retrospectively: no
* Supersedes: none (references ADR-0004; does not supersede it)
* Superseded by: none

## Context

Since 2026-09-12, the MOPH OpenData endpoint returns HTTP 403 (HTML) to Apps Script egress for every dataset/FY pair in both EPI Coverage and the independent `pa-dashboard` GAS project.

Evidence established by the Issue #34 investigation:

* GAS-originated syncs succeeded daily 2026-09-01 through 2026-09-11 (`pa-dashboard` system_logs: 18/18 units daily).
* Persistent terminal HTTP 403 begins 2026-09-12 and continues across essentially every sync unit daily in both projects.
* Two independent GAS projects are affected simultaneously; first-attempt probes and full retry loops both fail.
* Direct non-GAS (workstation) requests to the same endpoint return 2xx.
* Browser-like request headers do not change the result.

Root-cause status: GAS-scoped upstream behavior strongly supported; the exact upstream policy is unproven, and no WAF vendor or blocking rule is asserted.

Apps Script is therefore not permanently incompatible with MOPH OpenData — a behavioral/policy transition occurred — but no recovery timeline exists, and EPI Coverage's fail-closed cache retention (last-known-good aggregate data) is the only thing keeping View 3 alive meanwhile. ADR-0004's in-GAS posture (pacing, bounded transient retry, fail-closed retention) is correct and remains in force; it cannot fix a transport-level block of GAS egress.

## Decision

Acquisition transport for the OpenData sync moves behind an authenticated, transparent fetch relay when — and only when — relay configuration is deliberately present. The relay is a minimal Cloudflare Worker that forwards one authenticated request to the fixed MOPH endpoint and returns the upstream response verbatim. GAS remains the sole owner of the sync lifecycle, cache, audit, and business semantics.

### Runtime

Cloudflare Workers — selected pending egress canary. It satisfies the frozen relay/security contract (stateless authenticated fetch-forwarder, encrypted Worker secret storage, native constant-time HMAC-SHA256 verification, bounded request/response handling, verbatim upstream pass-through, redacted logging, minimal operational burden, portable wire contract). Cloudflare Workers default egress provides no dedicated customer-specific source IP; MOPH acceptance must be proven by a single authenticated canary before any production integration, and a canary HTTP 403 rejects the runtime without any EPI Coverage change. Not selected: shared hosting (disproportionate security surface for an Internet-facing authentication boundary) and dedicated VPS/on-prem (strategic fallback only if Workers egress is rejected).

### Frozen wire contract

* Method/path: `POST /v1/opendata/fetch` — the only endpoint; no health route, no generic proxy.
* Authentication: HMAC-SHA256 only. Headers `X-Epi-Timestamp` (Unix seconds) and `X-Epi-Signature: v1=<64 lowercase hex>`.
* Signing input: `<timestamp>\n<exact raw request body bytes>` — verified before JSON parsing; never parse-and-re-serialize.
* Timestamp acceptance: ±300 seconds — bounded replay resistance only (a replayed valid request can at worst re-read the fixed public aggregate endpoint; it cannot write application state).
* Payload: closed five-field aggregate contract (`tableName`, `year`, `province`, `type`, required; `limit` optional bounded 1–10000); unknown fields, nesting, arrays, and primitives rejected.
* Upstream URL: relay-side constant (`https://opendata.moph.go.th/api/report_data`); never caller-supplied — the relay is not an open proxy. Upstream redirects are not followed.
* Request ceiling: 2048 bytes (declared Content-Length checked pre-read as an optimization; the authority is a counted incremental stream read that stops and cancels the request-body reader at the bound — the body is never buffered beyond the limit, even without an honest Content-Length).
* Upstream response ceiling: 16 MiB, enforced even when Content-Length is absent (incremental bounded read; abort at the bound).
* Upstream timeout: one 30000 ms deadline covering the ENTIRE upstream lifecycle — fetch initiation plus response headers plus bounded response-body consumption; whichever bound (time or size) is reached first fails closed.
* Relay-origin failures (auth, validation, timeout, transport, size, internal) are marked only with the reserved `X-Epi-Relay` error-token header and never masquerade as MOPH responses; a spoofed upstream `X-Epi-Relay` header is stripped. The GAS classifier stays authoritative for upstream outcomes.
* No retry, no CORS, no business/data interpretation in the relay.

### Configuration (GAS Script Properties, atomic pair)

* `OPENDATA_RELAY_URL` + `OPENDATA_RELAY_HMAC_SECRET` both absent → direct GAS → MOPH (deliberate default/rollback; behavior identical to ADR-0004-era canonical).
* Both present and valid → relay transport.
* Partial/invalid (one present, blank, non-HTTPS, malformed) → `relay_config_invalid`: fail closed — no relay call, no direct call, no silent fallback, last-known-good cache retained, sanitized configuration-failure metadata only. Direct transport is a deliberate configuration state, never an authentication-error fallback.

### Secret ownership and rotation

The shared HMAC secret exists only in GAS Script Properties and the Cloudflare Worker encrypted-secret store; never in source, wrangler configuration, Git history, test fixtures with real values, logs, or error responses. Rotation is maintenance-window rotation (quiesce acquisition, replace the secret in both stores, resume, then retire the old secret) — no dual-secret support, because this is a low-frequency scheduled workflow. During a mismatched-secret interval the relay fails closed: MOPH is not contacted, no cache mutation occurs, and GAS observes a sanitized relay-origin authentication failure.

## Rationale

* Restores acquisition freshness through a controlled non-GAS egress while the upstream GAS block persists, without touching any proven application semantics.
* Smallest trust-boundary expansion: one authenticated hop; all lifecycle/cache/audit logic stays in GAS (ADR-0004 authority unchanged).
* Fail-closed at every layer: relay misconfiguration or failure degrades to the existing honest-failure behavior — retained last-known-good cache, never fabricated data.
* Instant rollback to direct transport by removing the configuration pair.

This decision is not a claim that Cloudflare egress is accepted by MOPH; that is proven only by the canary defined below.

## Consequences

### Positive

* OpenData freshness can be restored without waiting for an unbounded upstream policy change.
* GAS application semantics, cache authority, and audit remain the single source of truth.
* The relay is provider-portable (plain HTTPS + HMAC contract) and trivially decommissionable.

### Constraints

* One new Internet-facing component must be operated, monitored, and secret-rotated.
* The relay must never gain business logic, persistence, or a generic proxy surface.
* Cloudflare Workers egress acceptance by MOPH is unproven until the canary passes; a 403 canary rejects the runtime.
* The canary is exactly one authenticated request (`s_epi1`/FY2569 aggregate payload); on HTTP 403, stop immediately — no retries, no experimental header changes, no EPI Coverage production change.
* Escalation to MOPH/ICT about the GAS-origin block proceeds in parallel and is not replaced by this architecture.

## Alternatives Considered

* **Wait for upstream recovery** — unbounded stale-data duration for a public-health reporting feed; retained only as the eventual end-state (direct transport remains the rollback state).
* **Move scheduled acquisition outside GAS** — rejected: duplicates the cache lifecycle in a second runtime or introduces a non-Router write path into Google Sheets, both larger trust-boundary expansions.
* **Direct frontend → MOPH** — rejected: CORS-blocked upstream, no central cache, no fail-closed retention, breaks the existing read contract.
* **Replace the GAS backend broadly** — disproportionate to a single transport-leg incident.

## References

* GitHub Issue #34 — production GAS alignment / OpenData freshness (parent incident)
* GitHub Issue #39 — relay implementation and egress canary
* `0004-rate-limit-safe-moph-opendata-sync.md` — remains authoritative for sequential pair processing, inter-pair pacing, bounded retry policy, fail-closed behavior, cache retention, and invocation-source audit
* `../../relay/` — the isolated relay deployable (source, tests, wrangler configuration)
* `../spec.md` — current technical architecture
