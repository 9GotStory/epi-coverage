# ADR-0008: A Schedule Change Between Cohorts Is a Per-Rule Birth Window Keyed on Birth Date

* Status: Accepted
* Date: 2026-11-11
* Recorded retrospectively: no
* Supersedes: none
* Superseded by: none

## Context

Vaccine Rules are keyed by fiscal year, age group and view only. One age group therefore holds one schedule, even when its cohort straddles a schedule change.

The MOPH polio switch shows the problem. From 1 Jul 2566 the regimen changed from OPV at 2 and 4 months to IPV at 2 and 4 months (2 IPV + 3 OPV). In the FY2569 data, the whole 5-year cohort and about half of the 3-year cohort reached 2 months before the switch, yet the 2569 IPV rules count them as Confirmed Missing Doses (Issue #116).

The same data showed that the 2-year cohort is entirely post-switch, yet many of its children received OPV at 2 months instead of IPV. Whatever distinguishes the regimens must therefore not excuse those children. They remain Confirmed Missing Doses (owner decision, #116).

## Decision

1. A Vaccine Rule may carry a **Birth Window**: an optional start (inclusive) and end (exclusive) on the child's birth date. An open side means "no limit". A rule with no Birth Window behaves exactly as before.
2. A child born outside a rule's Birth Window has an **Inapplicable Rule**: it is not counted for that child at all, in View 1, View 2 or the per-rule breakdown. It is not passed, pending, missing or not evaluable.
3. A child with no valid birth date cannot be placed against a window, so each windowed rule is *not evaluable* for them. A data-quality problem must never be applied to both regimens at once.
4. A cohort that straddles a schedule change is configured as separate rules sharing one cut-off date, for example IPV rules from the cut-off and polio dose 1/2 rules before it. Staff configure this on the Rules Engine page (ADR-0006).
5. The Birth Window is evaluated in the shared rule engine that already evaluates View 1, View 2 and the summaries. The backend stores the window, validates it fail closed, and returns it with the rule.

## Rationale

* **Birth date** is on every record, deterministic, and easy for staff to configure. For the polio switch, birth date is a close proxy for the MOPH target group, children reaching 2 months after the switch. A child whose dose history does not fit still gets followed up, because the old-regimen rules are Confirmed Missing Doses too.
* A **per-rule** window adds two optional columns and no new entity. Staff already edit rules one by one, and a window works for any future schedule change, not only polio.
* A half-open window lets two rules use the same date string with no gap or overlap at the cut-off.

## Consequences

* Rules evaluate against birth date as well as current age. Target Age (Pending) and Birth Window (Inapplicable) are separate concepts and must not be merged.
* Per-rule denominators shrink to the children each rule applies to. Stored summaries reflect this only after they are reprocessed.
* Old-regimen rules must be removed by staff once no child in the age group was born before the cut-off. Cloning a fiscal year copies windows unchanged.
* Expressing "applies only if the child's first dose was before date X" still needs an engine change. This ADR does not provide it.

## Alternatives Considered

* **Regimen by date of first polio dose.** Closer to the MOPH wording, but it needs a new dose-date applicability condition in the engine and gives no answer for unvaccinated children. It affected very few children in the FY2569 data. Rejected.
* **A named regimen entity with one shared cut-off that rules reference.** More abstract, and it doesn't fit the per-rule editing on the Rules Engine page. Rejected.
* **Configuration only** (remove or relax IPV rules for mostly pre-switch age groups). It can't handle a cohort that straddles the cut-off. Rejected.

## References

* `0006-vaccine-rules-sheet-is-staff-owned-primary-source.md`: staff-owned rules, Confirmed Missing Dose must not be lost
* `0003-centralize-config-driven-vaccine-rules.md`: rule ownership
* `../../CONTEXT.md` §38, §39, §41 Birth Window, §42 Inapplicable Rule
* `../features.md` §3.1, `../schema.md` `vaccine_rules`
* `../research/hdc-je-indicators-and-epi-schedule-2569.md` §3.1: the 1 Jul 2566 polio switch
* Issue #116
