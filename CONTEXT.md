# EPI Coverage — Domain Context

This document defines the shared domain language used by developers and AI coding agents working on EPI Coverage.

It is a vocabulary and domain-orientation document, not a replacement for business rules, schema documentation, technical architecture, or the UI design system.

For authoritative details:

- business behavior and vaccine criteria → `docs/features.md`
- data contracts and storage fields → `docs/schema.md`
- technical architecture → `docs/spec.md`
- UI design system → `DESIGN.md`
- architectural decisions → `docs/adr/`

When this document and a canonical source appear inconsistent, investigate the discrepancy rather than silently choosing one.

---

## 1. EPI Coverage

**EPI Coverage** is the application as a whole.

Its purpose is to support district-level childhood immunization monitoring, follow-up, coverage analysis, administration, and reporting.

The system combines individual-level imported EPI data with aggregate MOPH/HDC OpenData.

Do not use "EPI Coverage" to mean only the dashboard or only vaccine-rule evaluation.

---

## 2. Individual EPI Record

An **Individual EPI Record** is one imported person-level EPI record for a defined age group and fiscal-year scope.

Individual records are used by the operational tracking portions of the application.

They are fundamentally different from HDC OpenData aggregate records.

Use:

- `individual record`
- `EPI record`

Avoid vague terms such as:

- row
- patient object
- vaccine item

unless referring specifically to a technical representation.

---

## 3. Record Identity

**Record Identity** means the fields used to determine whether an imported record corresponds to an existing record.

The current matching behavior is defined by the import business rules.

CID must not be assumed to be a globally reliable record key because source CID values may be masked and duplicated.

Do not introduce a new identity rule based only on CID without changing the canonical business and data documentation.

See:

- `docs/features.md`
- `docs/schema.md`

---

## 4. PID

**PID** is the person identifier supplied by the source HDC/JHCIS-style dataset and participates in the current record-matching strategy.

PID is not interchangeable with CID.

Treat it as an identifier, not a quantity.

---

## 5. CID

**CID** is the source citizen-identifier field.

Source data may contain masked CID values such as values containing `*`.

Therefore:

- masked CID values may not be unique;
- CID is not the sole canonical update key;
- agents must not infer identity based on CID alone.

CID is sensitive data.

Never include real CID values in repository tests, examples, screenshots, logs, or documentation.

---

## 6. Facility

A **Facility** is a healthcare service unit represented by a facility code and facility name.

In this project, facilities normally correspond to local healthcare service units such as รพ.สต.

The canonical data field is generally:

`hoscode`

Use **Facility** as the preferred English domain term.

---

## 7. Facility Code

A **Facility Code** is an identifier for a healthcare facility.

Examples may contain leading zeroes.

Facility codes are strings, not numbers.

Therefore:

`06422`

and

`6422`

are not interchangeable representations.

Never intentionally remove leading zeroes or numerically normalize facility codes.

Fields containing `hosc` or `hosp` generally require the same identifier-preservation discipline. Refer to `docs/schema.md` for exact field contracts.

---

## 8. District Office Facility Code

Facility code:

`00588`

represents the district public-health office context used by the current application rules.

It may have broader data visibility than an ordinary facility user.

Do not generalize this special behavior to other facility codes without an explicit requirement.

---

## 9. Age Group

An **Age Group** is the EPI reporting/tracking group represented by values such as:

- `1yr`
- `2yr`
- `3yr`
- `5yr`

Age Group is not the same thing as the child's exact age in months.

It scopes imported data, vaccine rules, evaluation behavior, and reporting.

---

## 10. Fiscal Year

**Fiscal Year** is the Thai fiscal-year scope associated with imported data, vaccine rules, and aggregate reporting.

Example:

`2569`

Fiscal Year is part of the domain scope and may participate in record matching and rule selection.

Do not silently substitute calendar year behavior for fiscal-year behavior.

---

## 11. View 1

**View 1** is the individual vaccine follow-up view.

It is used to identify age-appropriate vaccine items that require operational follow-up or review.

View 1 works from individual-level imported EPI information.

It is not the HDC OpenData aggregate view.

A date-quality observation is not automatically equivalent to "missing vaccine".

When the system detects a history/date issue, use the repository-defined review wording rather than automatically classifying the vaccine as missing.

See `docs/features.md` for current behavior.

---

## 12. View 2

**View 2** is the individual Fully Immunized reporting view.

For the current implementation, imported HDC `result` is authoritative for the displayed pass/fail result for supported age-group records.

The application must not silently replace that result by recalculating Fully Immunized status from local vaccine rules unless the canonical business behavior is explicitly changed.

The historical vaccine criteria documented in the repository remain useful domain/reference material but must not be confused with the current displayed-result authority.

---

## 13. Fully Immunized

**Fully Immunized** is the domain concept representing completion of the required immunization criteria for a defined reporting context.

In current View 2 display behavior, the imported HDC result is authoritative.

Do not use "Fully Immunized" as a synonym for:

- View 1 completeness;
- a single vaccine being complete;
- coverage percentage;
- local date-rule validity.

These are separate concepts.

---

## 14. View 3 (historical frontend view)

**View 3** was the aggregate HDC OpenData reporting view previously shown in EPI Tracking. Its frontend tab and OpenData dashboard implementation have been removed for all four age groups (1, 2, 3, and 5 years); View 3 is no longer an active frontend view.

The underlying MOPH/HDC OpenData aggregate source, GAS read API, backend cache, sync, and audit contracts remain separate from the two active individual-record views. Aggregate values do not represent individual children and must not be treated as individual-record data or substituted for View 1 / View 2 results.

Typical aggregate concepts include:

- target population;
- result count;
- coverage;
- monthly or fiscal-period aggregates.

---

## 15. HDC OpenData

**HDC OpenData** is the external aggregate data source maintained in the backend cache, independently of the two active individual-record EPI Tracking views.

Relevant report datasets include concepts such as:

- `s_epi1`
- `s_epi_complete`

OpenData column names may not map intuitively to local EPI field names.

Always use the documented mapping instead of guessing from similar names.

---

## 16. Target

**Target** is the denominator population used by an aggregate coverage calculation.

It is not an Individual EPI Record count unless the particular report explicitly defines it that way.

Do not infer target semantics from UI labels alone.

---

## 17. Result

**Result** is a report/source outcome value.

The meaning depends on context.

For aggregate OpenData reporting, it commonly represents the numerator count.

For imported HDC individual data used by current View 2 behavior, `result` can represent the source's Fully Immunized outcome.

Do not assume all fields named `result` have identical representation or granularity.

---

## 18. Coverage

**Coverage** or **Coverage Rate** is a reporting metric derived from a defined target and result.

Coverage is not the same concept as:

- vaccine-rule validity;
- individual record completeness;
- data quality;
- upload completeness.

Whenever calculating coverage, identify the numerator, denominator, age group, facility scope, fiscal-year scope, and data source.

---

## 19. Vaccine Rule

A **Vaccine Rule** is a configurable rule used by the application's vaccine-rule system.

Rules are scoped by domain properties such as fiscal year and age group and may describe required fields, alternatives, target age, activity state, and date validation settings.

The backend implementation is config-driven.

Do not introduce duplicate hard-coded frontend vaccine-rule logic when behavior belongs to the shared rule system.

---

## 20. Required Field

A **Required Field** is a vaccine-data field that participates directly in satisfying a Vaccine Rule.

The implementation commonly represents these through:

`required_fields`

Do not interpret "required" as a database NOT NULL constraint unless `docs/schema.md` explicitly says so.

It is a rule-evaluation concept.

---

## 21. Alternative Branch

An **Alternative Branch** represents an alternative set or branch of vaccine fields that may satisfy a configurable vaccine rule.

The implementation commonly represents alternative fields through:

`branch_alt_fields`

An Alternative Branch is not merely an optional UI field.

It is part of rule semantics.

---

## 22. Target Age

**Target Age** is the age, normally represented in months, associated with when a vaccine rule is expected to apply.

The implementation may use:

`target_age_months`

Default target ages may be derived from the backend rule configuration, but configured rule values remain part of the rule state.

Do not independently recreate target-age maps in multiple frontend modules.

---

## 23. Vaccine Date Checks

**Vaccine Date Checks** are quality/consistency checks applied to vaccination dates.

They are separate from the primary question of whether a vaccine is present.

Current concepts include:

- date before birth;
- whether vaccination on the birth date is allowed;
- vaccine-date pairs that should not occur on the same date;
- vaccine-date ordering relationships.

A date-check warning must not automatically be reinterpreted as a missing vaccine.

---

## 24. Same-Day Pair

A **Same-Day Pair** is a configured relationship between two vaccine date fields where use of the same date is considered a condition requiring review according to the rule configuration.

The backend representation uses:

`same_day_pairs`

Do not create arbitrary same-day restrictions from general vaccine knowledge.

Use configured or documented behavior.

---

## 25. Ordered Pair

An **Ordered Pair** is a configured relationship between vaccine date fields used to validate their chronological relationship.

The backend representation uses:

`ordered_pairs`

The pair direction matters.

Do not assume vaccine field numbering always represents chronological order because source field naming may contain legacy or source-system mapping peculiarities.

---

## 26. Vaccine Rules Engine

The **Vaccine Rules Engine** is the config-driven backend behavior responsible for managing and evaluating configurable vaccine rules and related date-check settings.

It should remain distinct from:

- imported HDC result authority;
- OpenData aggregate reporting;
- raw source-data parsing.

Do not use "Rules Engine" as a generic name for all EPI calculations.

---

## 27. Import

An **Import** is the process of reading source EPI data, normalizing it, validating applicable fields, and writing or updating records in the application data store.

Import does not necessarily mean complete replacement of all existing records.

The current default behavior is additive/update-oriented unless the explicitly selected synchronization mode permits deactivation.

---

## 28. Batch

A **Batch** identifies an import operation or import scope.

Relevant concepts may include:

- `batch_id`
- `last_seen_batch`

Batch identity helps track upload activity and synchronization behavior.

It is not a person identifier.

---

## 29. Full-File Sync

**Full-File Sync** is the import mode that represents a complete source-file synchronization for a validated scope.

Only a completed and validated full-file synchronization may perform the repository-defined deactivation behavior for records no longer present in that scope.

Do not treat every ordinary upload as Full-File Sync.

---

## 30. Active Record

An **Active Record** is an imported EPI record whose current repository state indicates that it remains active within its defined scope.

The storage representation commonly uses:

`is_active`

Inactive does not necessarily mean deleted.

Preserve the project's soft-deactivation semantics.

---

## 31. As-of Date

The **As-of Date** communicates when the relevant source data was last updated or imported for operational interpretation.

It is derived from repository-defined audit/import information.

It is not automatically the current browser time.

---

## 32. Audit Log

An **Audit Log** records significant user/system actions for traceability.

Examples may include authentication, imports, administrative changes, or exports.

Audit logging must not be used as an excuse to log sensitive record contents.

Record actions and necessary metadata, not unnecessary personal data.

---

## 33. User

A **User** is an authenticated application user associated with an application role, approval status, and normally a facility scope.

Do not equate Google authentication alone with authorization to application data.

---

## 34. Approval Status

**Approval Status** represents whether an application user is permitted to proceed through the application's approval workflow.

Current concepts include:

- `pending`
- `approved`
- `rejected`

Authentication and approval are separate concerns.

---

## 35. Role

A **Role** defines application authorization capability.

Current role concepts include:

- `user`
- `admin`
- `superadmin`

Do not rely solely on hidden UI controls for role enforcement.

Authorization-sensitive operations require the repository-defined backend/security enforcement.

---

## 36. Canonical Language Rules

Use existing project terms consistently.

Preferred examples:

- Facility, not interchangeably "hospital", "unit", and "site"
- Facility Code for `hoscode`
- Age Group for `1yr` / `2yr` / `3yr` / `5yr`
- View 1, View 2, View 3 when referring to the defined reporting perspectives
- Individual EPI Record for person-level imported records
- HDC OpenData for the aggregate external source
- Vaccine Rule for one configurable evaluation rule
- Vaccine Rules Engine for the rule subsystem
- Full-File Sync only for the explicit synchronization behavior

When a new domain concept appears repeatedly and cannot be expressed clearly using this vocabulary, update `CONTEXT.md` deliberately instead of inventing several competing names in code.

---

## 37. View 2 Applicable Total

**View 2 Applicable Total** is the number of Individual EPI Records included in the denominator of a stored View 2 (Fully Immunized) coverage summary for that snapshot.

- Records whose View 2 evaluation is still pending are excluded from the applicable denominator and counted separately (`view2PendingCount`).
- Records with a required View 2 rule that the source file cannot confirm columns for are "ประเมินไม่ได้" (not evaluable): also excluded and counted separately (`view2NotEvaluableCount`, Issue #89). They are a data-quality follow-up, never a vaccination chase list.
- A newly generated summary partitions its cohort exactly into applicable + pending + not evaluable; coverage uses applicable as the denominator.
- Historical summary snapshots may predate this persisted contract and lack the fields; they remain valid without them.

This is a summary-aggregation concept. It does not change per-record View 2 display authority (see §12) or the Vaccine Rules Engine (§26).
