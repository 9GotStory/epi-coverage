# ADR-0006: The `vaccine_rules` Sheet Is the Staff-Owned Primary Source for Follow-Up

* Status: Accepted
* Date: 2026-11-10
* Recorded retrospectively: no
* Supersedes: ADR-0003, section "Relationship to View 2" only (the rest of ADR-0003 stays in force)
* Superseded by: none

## Context

EPI Coverage is an operational follow-up system. Its purpose is to make sure children receive the vaccines that the Ministry of Public Health (MOPH) requires.

The vaccine schedule changes between fiscal years. For example, calendar 2569 replaced the 2- and 4-month OPV doses with IPV. Lists of doses hard-coded in documentation or in `seedVaccineRules` therefore go stale.

ADR-0003 made the Vaccine Rules Engine own configurable rule semantics. It kept the imported HDC `result` as the authority for the View 2 Fully Immunized result, and noted that computing View 2 locally would need an explicit business decision.

A review on 2026-11-10 found the following:

* The HDC `result = ผ่าน` overrides local rule findings, so a child whose configured rules show a missing dose can drop out of follow-up.
* Date-check warnings are counted as missing vaccines.
* A confirmed missing dose can be hidden as "ประเมินไม่ได้" when another rule's source column is absent.

## Decision

1. **The `vaccine_rules` sheet is the primary source** for which vaccines a child should receive, for each fiscal year, age group and view. Staff configure it every fiscal year through the Rules Engine page.
2. **`seedVaccineRules` defaults and the per-dose lists in `docs/features.md` are a starting point and reference only.** They do not override what staff configure. `docs/features.md` defines how rules are interpreted (ALL / ANY / BRANCH, target age, date checks, not-evaluable), not the yearly dose list.
3. **The result of rule evaluation is authoritative for View 2.** The imported HDC `result` is shown alongside it, and a mismatch is flagged for staff review. This replaces ADR-0003 "Relationship to View 2". Implementation: #101.
4. **A date-check warning is a separate "ตรวจสอบประวัติ" (review history) state.** It is not a missing vaccine and does not enter the vaccination chase list. Implementation: #102.
5. **A confirmed missing dose stays "ไม่ผ่าน" and enters the chase list**, even when another rule cannot be evaluated. Rules that cannot be evaluated are reported separately as data-quality work. Implementation: #103.

Until each implementation issue lands, the current behavior described in `docs/features.md`, `docs/hdc-record-display.md` and `CONTEXT.md` §12 still describes what the system does. Each issue updates those documents together with the behavior change.

## Rationale

* Staff who run the programme own the yearly schedule. Configuration is the only place that can track MOPH changes without a code release.
* A follow-up system must not lose a child with a known missing dose. This applies whether the child would be lost because of an aggregate verdict, a data-quality warning, or an unrelated missing column.
* Data-quality problems and vaccination gaps need different actions: fixing the source record versus visiting the child. Mixing them makes both lists less useful.

## Consequences

* The engine can enforce only what a rule can express. Today a rule checks that dates are present (ALL / ANY / a two-way BRANCH) plus the configured date checks. Age windows, minimum intervals and more than two alternative series are not expressible. Supporting them is a change to the engine, not to configuration.
* Defaults that the frontend infers for rules without saved configuration (for example, the date-check fallback) must derive from the configured rules, never from vaccine column numbering (#100).
* Summaries are stored snapshots. They reflect the new semantics only after they are reprocessed.
* Comparisons with HDC (OpenData aggregates and the imported `result`) remain reference signals. They are shown beside the rule evaluation and do not replace it (ADR-0002).

## Alternatives Considered

* **Keep the HDC `result` authoritative for View 2** (the ADR-0003 position). The owner rejected this because children whose configured rules show missing doses could drop out of follow-up.
* **Report rule-based and HDC coverage as two independent figures.** This was offered and not chosen. The HDC `result` is kept as supporting information on each record instead.

## References

* `0003-centralize-config-driven-vaccine-rules.md`: rule ownership (still in force)
* `0002-separate-individual-and-aggregate-epi-data.md`
* `../features.md` §3.1, §3.6
* `../../CONTEXT.md` §12, §19–§26
* Issues #100, #101, #102, #103, #104, #105
