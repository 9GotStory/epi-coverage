# ADR-0002: Separate Individual EPI Data from Aggregate HDC OpenData

* Status: Accepted
* Date: 2026-09-11
* Recorded retrospectively: yes
* Supersedes: none
* Superseded by: none

## Context

EPI Coverage uses two fundamentally different classes of health-reporting data:

1. individual-level EPI records imported into the application; and
2. aggregate statistics retrieved from MOPH/HDC OpenData.

The two data classes differ in granularity, ownership, interpretation, update behavior, and reporting purpose.

Individual EPI records support operational follow-up and person-level reporting.

HDC OpenData provides aggregate reporting values such as target populations, result counts, and coverage statistics.

The existing application already separates these responsibilities through its reporting views and feature boundaries.

Because both data sources describe related immunization activity, future implementations could incorrectly combine them or treat aggregate values as if they represented individual records unless the boundary is explicitly preserved.

## Decision

EPI Coverage will maintain an explicit architectural boundary between:

* individual EPI data; and
* aggregate HDC OpenData.

Individual EPI records are used for person-level operational workflows such as individual vaccine follow-up and the repository-defined individual Fully Immunized display behavior.

Aggregate HDC OpenData is used for aggregate statistical reporting and must not be treated as person-level data.

The application reporting concepts are therefore separated as follows:

```text
Individual EPI data
        |
        +--> View 1
        |    individual vaccine follow-up
        |
        +--> View 2
             individual Fully Immunized reporting


HDC OpenData
        |
        +--> View 3
             aggregate reporting and coverage statistics
```

Data from one side of this boundary must not silently become the authoritative source for behavior owned by the other side.

Any deliberate reconciliation or comparison between the two sources must keep their provenance and granularity explicit.

## Rationale

Individual and aggregate data answer different operational questions.

Individual records can support questions such as:

* which records require follow-up;
* what vaccine history is present for an individual record;
* what source result was imported for an individual reporting record.

Aggregate OpenData can support questions such as:

* what target population is reported;
* what aggregate result count is reported;
* what coverage value is reported for a facility or reporting period.

Treating these sources as interchangeable would obscure where a value came from and could produce misleading reporting behavior.

Maintaining a clear boundary also allows the system to compare individual-import reporting with HDC aggregate reporting without implying that one dataset was directly derived from the other inside EPI Coverage.

## Consequences

### Positive

* Data provenance remains explicit.
* Person-level workflows remain independent from aggregate reporting feeds.
* Aggregate OpenData can evolve without directly changing imported individual records.
* Individual import behavior can evolve without silently rewriting aggregate reporting values.
* Differences between individual and aggregate reporting can be surfaced and investigated instead of being hidden through automatic merging.
* Privacy-sensitive individual data is not required merely to render aggregate OpenData reporting.

### Constraints

* Aggregate OpenData records must not be treated as Individual EPI Records.
* Individual records must not be silently aggregated and substituted for HDC OpenData where View 3 is defined to use the external aggregate source.
* HDC aggregate target/result values must not be attached to individual records as though they represented person-level outcomes.
* UI, API, cache, and state names should preserve the distinction between individual and aggregate data where ambiguity would otherwise arise.
* Comparison features must identify both data sources rather than presenting a merged value with unclear provenance.

### View 2 Boundary

View 2 is part of the individual-data side of this architecture.

For the current documented behavior, the imported HDC `result` associated with the individual record is authoritative for the displayed Fully Immunized outcome.

This ADR does not authorize recalculating or replacing that result with aggregate OpenData values or with another evaluation mechanism.

Any change to View 2 result authority is a business-behavior change and must first be reflected in the appropriate canonical documentation.

### Future Change

This ADR does not prohibit future reconciliation, analytics, or comparison between individual and aggregate datasets.

Such functionality must explicitly define:

* source provenance;
* aggregation level;
* reporting scope;
* facility scope;
* fiscal-year or reporting-period scope;
* reconciliation rules;
* behavior when the two sources disagree.

A future architecture that intentionally unifies these data sources should supersede this ADR rather than eroding the boundary incrementally.

## Alternatives Considered

No reliable repository evidence has been identified that records a formal historical decision process comparing alternative ways to combine or separate these datasets.

Alternatives are therefore intentionally not reconstructed retrospectively.

## References

* `../features.md` — current reporting views and business behavior
* `../schema.md` — individual EPI data contracts
* `../../CONTEXT.md` — definitions of Individual EPI Record, View 1, View 2, View 3, HDC OpenData, Target, Result, and Coverage
* `0001-use-google-apps-script-and-google-sheets.md` — backend and persistence architecture
