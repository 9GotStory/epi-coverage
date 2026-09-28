# ADR-0004: Use Paced, Bounded Retries for MOPH OpenData Synchronization

* Status: Accepted
* Date: 2026-09-28
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

View 3 (aggregate reporting) depends on aggregate MOPH/HDC OpenData fetched server-side through Google Apps Script.

The repository's production investigation (Issue #37 diagnosis) established:

* MOPH demonstrably applies rate limiting to its OpenData endpoint; a direct probe returned HTTP 429 with throttler metadata.
* The previous `epi-coverage` implementation sent dataset/FY pairs sequentially but back-to-back, with no deliberate spacing, and made only one attempt per pair.
* The sibling `pa-dashboard` implementation established useful prior art against the same upstream endpoint: paced sequential requests plus bounded retry/backoff.
* Production diagnosis also observed an all-five HTTP 403 incident, but the exact 403 trigger was not proven.
* Synthetic differential diagnosis proved that pacing/retry materially improves resilience to transient 429/5xx responses, but does not prove or guarantee recovery from a pre-existing 403/WAF-style block.
* Existing fail-closed cache retention is a required safety property: upstream failure must not fabricate zero or discard last-known-good aggregate data.

## Decision

### Sequential upstream access

MOPH OpenData dataset/FY pairs are fetched sequentially.

Do not use parallel upstream requests or `UrlFetchApp.fetchAll()` for this sync path.

### Inter-pair pacing

A completed dataset/FY-pair lifecycle is followed by a fixed 2000 ms pause before the next pair.

No pacing delay occurs after the final pair.

Pacing applies to the complete ordered pair sequence, including multiple fiscal years.

### Bounded transient retry

Retry only:

* HTTP 429
* HTTP 500–599

Maximum:

* 3 attempts total per pair

Backoff:

* after the first transient failure: 5000 ms
* after the second transient failure: 10000 ms
* no retry delay after the final failed attempt

### Permanent/non-transient outcomes

Do not retry:

* permanent HTTP 4xx, including 403
* fetch exceptions
* `non_json`
* `malformed_json`
* `invalid_contract`
* `json_error`

These remain honest final pair failures unless a later ADR deliberately changes the policy.

### Fail-closed retention

A pair that ultimately fails retains its previous valid cache rows.

Never:

* fabricate zero;
* discard historical cache merely because upstream failed;
* represent unresolved upstream failure as fresh data.

### Recovered pair semantics

If a transient failure later succeeds within the bounded attempt budget, the pair is a final success.

Earlier transient attempts must not remain as final failed-pair audit metadata.

## Rationale

* Pacing reduces avoidable burst pressure on an upstream known to rate-limit.
* Bounded retry handles short-lived 429/5xx conditions without creating retry storms.
* Limiting attempts protects Apps Script execution time and upstream load.
* Refusing to retry permanent 4xx avoids hammering a blocked or rejected upstream.
* Deterministic pacing simplifies operations, testing, and diagnosis.
* Fail-closed retention prioritizes truthful public-health reporting over freshness at any cost.

This policy is resilience/prevention. It is not proof of the exact September 403 root cause, which remains unproven.

## Consequences

### Positive

* Greater resilience to transient throttling and server failure.
* Predictable upstream request rate.
* Deterministic timing suitable for regression testing.
* Preserved last-known-good View 3 data during unresolved upstream failures.
* Honest final failure diagnostics.
* No new proxy/platform dependency.

### Constraints

* Sync execution takes longer because of pacing and backoff.
* The script lock may therefore be held longer.
* Concurrent runs may legitimately return `sync_busy`.
* A permanent 403 is not retried and may require a later scheduled or manual run after the external condition clears.
* Future developers must not reintroduce parallel or burst OpenData fetching without superseding this decision.

### Invocation-source observability

Manual and scheduled syncs record a backend-derived invocation source in the existing sanitized sync audit, so future duplicate runs are diagnosable.

## Alternatives Considered

### Back-to-back single-attempt requests

Rejected because they provide no resilience to demonstrated transient upstream throttling.

### Retry every non-2xx response

Known prior-art behavior exists in `pa-dashboard`, but it was not selected here because retrying permanent 4xx such as 403 can waste requests and hammer a blocked upstream.

### Randomized pacing

Not selected for `epi-coverage`; fixed 2000 ms pacing is simpler and deterministic while satisfying the diagnosed pacing requirement.

### External relay/proxy architecture

Not selected for Issue #37 because GAS can reach the MOPH endpoint and no evidence justified adding another infrastructure dependency. This does not permanently prohibit external relays; they would require a separate architectural decision if future evidence warrants one.

## References

* GitHub Issue #37 — rate-limit-safe OpenData sync and invocation source
* GitHub Issue #13 — live MOPH OpenData integration verification
* GitHub Issue #34 — production GAS alignment / OpenData freshness correction
* GitHub Issue #35 — sanitized per-pair OpenData diagnostics
* `../../backend/src/OpenData.js`
* `../../backend/src/Router.js`
* `../spec.md`
* `0001-use-google-apps-script-and-google-sheets.md`
* `0002-separate-individual-and-aggregate-epi-data.md`
