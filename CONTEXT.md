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

The configured View 2 Vaccine Rules (§19) are authoritative for each child's View 2 result, both per record and in the summary (Issue #101, ADR-0006).

The imported HDC `result` (§17) is shown alongside as supporting information. It never changes the rule result, and a disagreement between the two is flagged as an HDC Result Mismatch (§43) for staff review.

See `docs/features.md` §3.1 for the precedence between Confirmed Missing Dose, Pending Rule and not evaluable.

---

## 13. Fully Immunized

**Fully Immunized** is the domain concept representing completion of the required immunization criteria for a defined reporting context.

In View 2 it is decided by the configured View 2 Vaccine Rules (§12); the imported HDC result is supporting information.

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

For imported HDC individual data, `result` can represent the source's Fully Immunized outcome. View 2 shows it alongside the rule result and does not use it to decide that result (§12).

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

Staff can add, deactivate and delete a Vaccine Rule on the Rules Engine page (Issue #122). Deactivating and deleting are different:

- An **Inactive Vaccine Rule** ("ปิดใช้งาน") is still part of that fiscal year's configuration. It is not evaluated, and cloning a fiscal year copies it. Use it to pause a rule.
- **Deleting** a Vaccine Rule removes it from that fiscal year's configuration. Its cross-year identity (`metric_key` lineage) ends there: a rule added later under the same name is a new metric, never a continuation. Dashboard Summaries already stored are unchanged.

A newly added Vaccine Rule always starts its own cross-year identity, whatever its name.

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

A Vaccine Rule whose required dates are all present but which carries a date-check warning is in the **"ตรวจสอบประวัติ"** (review history) state: neither passed nor missing (Issue #102, ADR-0006). It is a history-review task, never a vaccination chase list. How it is ranked and counted is defined in `docs/features.md` §3.6.

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
- Deactivate ("ปิดใช้งาน") for pausing a Vaccine Rule and delete ("ลบ") only for removing it from the fiscal year's configuration (§19); never "ลบ" for deactivating
- Full-File Sync only for the explicit synchronization behavior
- Finalize ("ปิดการนำเข้า") for finishing a Batch whose chunks are all written (§48), never "cleanup"
- Summary Regeneration for recomputing Dashboard Summaries, never "Sync Summaries" or "sync"
- View 2 Pending for the record-level not-yet-due state, never bare "pending" (which is an Approval Status)
- Inapplicable Rule for a rule outside the child's Birth Window, never "not applicable" for a rule that is pending or not evaluable
- Cohort Birth Range for the birth dates an Age Group reports on in a Fiscal Year, never "Birth Window" (which belongs to one Vaccine Rule)
- HDC Result Mismatch for a disagreement between the rule result and the HDC `result`, never "HDC override"
- Lost Response ("ไม่ได้รับคำตอบจากเซิร์ฟเวอร์") for a request whose answer never reached the client (§50), never "logout" or "session expired"
- Session End ("เซสชันสิ้นสุด") for the server no longer accepting a Session the User did not sign out of (§51), never "session expired" for the general case, and Sign-out ("ออกจากระบบ") only when the User chose to end it
- "ตรวจสอบประวัติ" (review history, code `REVIEW` / `review*`) for a rule or record held back only by a date-check warning (§23), never "missing" or "ไม่ผ่าน"

When a new domain concept appears repeatedly and cannot be expressed clearly using this vocabulary, update `CONTEXT.md` deliberately instead of inventing several competing names in code.

---

## 37. View 2 Applicable Total

**View 2 Applicable Total** is the number of Individual EPI Records included in the denominator of a stored View 2 (Fully Immunized) coverage summary for that snapshot.

- View 2 Pending records (§40) are excluded from the applicable denominator and counted separately (`view2PendingCount`).
- Records with a required View 2 rule that the source file cannot confirm columns for, and no Confirmed Missing Dose, are "ประเมินไม่ได้" (not evaluable): also excluded and counted separately (`view2NotEvaluableCount`, Issue #89). They are a data-quality follow-up, never a vaccination chase list.
- Records whose only problem is a date-check warning are "ตรวจสอบประวัติ" (§23): also excluded and counted separately (`view2ReviewCount`, Issue #102).
- A record with a Confirmed Missing Dose (§38) stays an applicable failure even when another required View 2 rule is not evaluable (Issue #103), is a Pending Rule (§39, Issue #119) or carries a date-check warning (Issue #102).
- A newly generated summary partitions its cohort exactly into applicable + View 2 Pending + not evaluable + ตรวจสอบประวัติ; coverage uses applicable as the denominator.
- Historical summary snapshots may predate this persisted contract and lack the fields; they remain valid without them.

This is a summary-aggregation concept. It does not change per-record View 2 display authority (see §12) or the Vaccine Rules Engine (§26).

---

## 38. Confirmed Missing Dose

A **Confirmed Missing Dose** is a Vaccine Rule that a child has not met, where:

- the source file confirms the rule's Required Field columns, and
- the child has reached the rule's Target Age.

It is a vaccination gap, so the child needs follow-up.

Do not confuse it with:

- a rule that is not evaluable because its columns are absent, which is a data-quality problem;
- a Pending Rule, which is not due yet;
- a date-check warning (§23), which is a history-review problem.

---

## 39. Pending Rule

A **Pending Rule** is a Vaccine Rule that a child has not met and whose Target Age the child has not reached yet.

It is a rule-level concept: the dose is not due, so it is neither passed nor missing.

---

## 40. View 2 Pending

**View 2 Pending** is the record-level View 2 state of a child who has at least one Pending Rule and no Confirmed Missing Dose.

Use "View 2 Pending", not bare "pending", for this state.

---

## 41. Birth Window

A **Birth Window** is the optional range of birth dates a Vaccine Rule applies to (Issue #116).

- The start is inclusive and the end is exclusive, so two rules that share a cut-off date leave no gap and no overlap.
- An open side means "no limit". A rule with no Birth Window applies to every child in its fiscal year, age group and view.
- It is how one age group holds two vaccine schedules side by side, for example IPV rules for children born on or after the 2566 polio-regimen switch and the Old Polio Regimen rules (§49) for children born before it.

A Birth Window is about birth date. It is not Target Age (§22), which is about the child's current age.

---

## 42. Inapplicable Rule

An **Inapplicable Rule** is a Vaccine Rule whose Birth Window (§41) excludes the child. Thai UI wording: "ไม่ใช้กับเด็กรายนี้".

It does not count for that child at all: it is not passed, not a Pending Rule (§39), not a Confirmed Missing Dose (§38), and not "ประเมินไม่ได้" (not evaluable).

Do not confuse it with:

- a Pending Rule, which will become due as the child grows; an Inapplicable Rule never applies to this child;
- a not-evaluable rule, which is a data-quality problem. A child whose birth date is unknown cannot be placed against a Birth Window, so the rule is not evaluable for them, not inapplicable.

---

## 43. HDC Result Mismatch

An **HDC Result Mismatch** is a View 2 record whose rule result (§12) and imported HDC `result` (§17) disagree (Issue #101). Thai UI wording: "ผลไม่ตรงกับ HDC".

It is a review flag for staff, not a result: it never changes the rule result. Which combinations count as a mismatch is defined in `docs/features.md` §3.1.

---

## 44. Dashboard Summary

A **Dashboard Summary** is a stored aggregate snapshot for one Age Group, one Fiscal Year and one period (the whole fiscal year or one quarter). It is computed from Active Records (§30) under that year's Vaccine Rules (§19).

It holds counts only, never individual records. Its timestamp is when it was computed, not the As-of Date (§31).

A Dashboard Summary is a measurement of data that exists. An Age Group with no Active Records for a Fiscal Year has no Dashboard Summary for that year. It does not have a summary of zero (Issue #115).

---

## 45. Summary Regeneration

**Summary Regeneration** recomputes the Dashboard Summaries (§44) of one Fiscal Year from the Active Records already stored, without a new Import (§27). Thai UI wording: "ประมวลผล Dashboard ใหม่".

It is not a sync. "Sync" in this project means Full-File Sync (§29), which can deactivate records. Summary Regeneration never changes Individual EPI Records.

---

## 46. Cohort Birth Range

The **Cohort Birth Range** is the range of birth dates of the children that one Age Group (§9) reports on for one Fiscal Year (§10) (Issue #136). Thai UI wording: "กลุ่มเกิดของปีงบประมาณ"; a child born outside it is "ไม่อยู่ในกลุ่มเกิด".

- It runs from 1 October to 30 September, inclusive at both ends, shifted back from the Fiscal Year by the Age Group's age. For example, the 2-year Cohort Birth Range of Fiscal Year 2570 is 1 Oct 2567 to 30 Sep 2568 (2024-10-01..2025-09-30).
- A quarter's cohort is the matching three months of that range.

Do not confuse it with a Birth Window (§41), whose Thai wording is "ช่วงวันเกิด". A Birth Window is an optional per-rule range that decides whether one Vaccine Rule applies to a child. A Cohort Birth Range decides which children an Age Group and Fiscal Year report on at all.

---

## 47. Import Undo

**Import Undo** reverses the effect of one completed Import (§27) on which records are Active Records (§30) (Issue #112). Thai UI wording: "ย้อนการนำเข้าล่าสุด".

- It applies only to the latest completed Batch (§28) of one Age Group and Fiscal Year, in either import mode, and only when no later Import has written to the same facilities.
- It applies only to a Batch that updated no existing record. Such a Batch only added records and, in a Full-File Sync (§29), deactivated records. Import Undo deactivates the records it added and reactivates the records it deactivated.
- It is exact or refused. It never infers which records a Batch changed, and it never restores overwritten vaccine values. When it is refused, the recovery is to import the correct file again.
- It is one step only. An undone Batch cannot be undone again, and it still blocks Import Undo of any earlier Batch.
- An **Unfinished Import Undo** is an Import Undo that has started but has not completed every step (Issue #140). Thai UI wording: "การย้อนที่ยังไม่เสร็จ"; the action that completes it is "ย้อนต่อให้เสร็จ". The Batch counts as undone only once every step is complete. Until then, no Import may write to the same Age Group and Fiscal Year. Do not call finishing it a "repair": nothing is broken, the undo is not finished yet.

Do not call it a "rollback" or "revert". It is not a Full-File Sync and not a Summary Regeneration (§45), although it changes Active Records and therefore the Dashboard Summaries (§44).

---

## 48. Finalize

**Finalize** is the step that finishes a Batch (§28) of an Import (§27) once every chunk of it is written (Issue #144, Issue #146). Thai wording: "ปิดการนำเข้า".

- In a Full-File Sync (§29) it deactivates the records absent from the Batch's scope. An Import in the default mode deactivates nothing.
- A Batch counts as complete only once it is finalized, and only a finalized Batch can be undone (§47).
- Each Finalize has exactly one Audit Log (§32) event, which names the admin who finalized the Batch. The As-of Date (§31) is the time of the latest Finalize.

Do not call it "cleanup". The name survives only in code identifiers (`cleanupEpiData`, `cleanup_epi_data`).

---

## 49. Polio Regimen

A **Polio Regimen** is the MOPH polio vaccine schedule a child was vaccinated under. The regimen is chosen by the child's birth date, not by the child's current Age Group (Issue #126). Thai wording: "สูตรโปลิโอ".

- The **Old Polio Regimen** ("สูตรเดิม") gives OPV at 2, 4 and 6 months and one IPV at 4 months, followed by the later OPV doses.
- The **New Polio Regimen** ("สูตรใหม่") gives IPV at 2 and 4 months instead of OPV, followed by OPV from 6 months.
- The switch took place in 2566. The birth-date cut-off and the rules for each regimen are defined in `docs/features.md`. An Age Group that spans the cut-off holds both regimens side by side through Birth Windows (§41).

How HDC's regimen choice differs from the rules, and which resulting disagreements are an HDC Result Mismatch (§43), is defined in `docs/features.md`.

Do not call the old regimen "OPV-only": it includes one IPV dose.

---

## 50. Lost Response

A **Lost Response** is a request that the server received and ran, but whose answer never reached the client, so from the client's side the outcome is unknown (Issue #154). Thai UI wording: "ไม่ได้รับคำตอบจากเซิร์ฟเวอร์".

- It is not a Session End (§51): the User (§33) stays signed in.
- It is not a server failure: the request may have completed, for example a chunk of an Import (§27) may already be written and its Batch (§28) finalized (§48).
- How an Import checks its outcome after a Lost Response is defined in `docs/features.md`.

Do not call it a "mangled request", "replayed GET", or "logout".

---

## 51. Session

A **Session** is the period a User (§33) is signed in. It begins at sign-in and ends either by Sign-out or by Session End.

- **Sign-out** ("ออกจากระบบ") is the User choosing to end their own Session.
- **Session End** ("เซสชันสิ้นสุด") is the server no longer accepting a Session the User did not sign out of: the Session expired, the User's Approval Status (§34) changed, or the Session was removed (Issue #155).

A Session End is one outcome whatever its cause; the User is not told which cause applied. A Lost Response (§50) is never a Session End.

Do not call a Session End "logout" or "session expired"/"หมดอายุ" in general: expiry is only one of its causes.
