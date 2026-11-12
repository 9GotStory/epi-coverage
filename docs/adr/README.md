# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for EPI Coverage.

ADRs capture significant technical or architectural decisions whose rationale should survive beyond the conversation, issue, or implementation in which the decision was made.

They complement, but do not replace, the project's canonical documentation.

---

## Purpose

An ADR answers questions such as:

* Why does this architecture exist?
* What constraints led to the decision?
* What alternatives were considered?
* What consequences must future developers and agents preserve?
* What would need to change before this decision should be revisited?

ADRs preserve decision rationale. They must not duplicate detailed implementation or business documentation.

---

## Source-of-Truth Boundaries

Use the appropriate canonical document:

* domain terminology → `../../CONTEXT.md`
* business behavior and vaccine criteria → `../features.md`
* data contracts and schema → `../schema.md`
* current technical architecture → `../spec.md`
* UI design rules → `../../DESIGN.md`
* architectural rationale → this `docs/adr/` directory

An ADR may reference these documents but should not copy their detailed contents.

---

## When to Create an ADR

Create an ADR when a decision:

1. affects multiple modules or major system boundaries;
2. is difficult or costly to reverse;
3. establishes long-lived ownership or responsibility;
4. selects one meaningful architectural alternative over another;
5. creates constraints future changes must understand;
6. resolves an architectural ambiguity likely to return later.

Typical examples include:

* backend or persistence architecture;
* system integration boundaries;
* ownership of shared business-rule evaluation;
* authentication architecture;
* deployment architecture;
* major module boundaries.

---

## When Not to Create an ADR

Do not create an ADR merely for:

* a normal bug fix;
* a small refactor;
* one UI component;
* individual vaccine criteria;
* field definitions;
* design tokens;
* routine dependency upgrades;
* temporary implementation details;
* information already adequately represented by another canonical document.

Use the existing source-of-truth document instead.

---

## ADR Lifecycle

Supported statuses are:

* **Proposed** — under consideration and not yet authoritative;
* **Accepted** — current architectural decision;
* **Deprecated** — retained for history but no longer recommended;
* **Superseded** — replaced by another ADR.

Do not edit an Accepted ADR to make architectural history appear different.

If an architectural decision changes materially:

1. create a new ADR;
2. mark the previous ADR as Superseded;
3. reference the replacement ADR.

Minor corrections that do not change the decision may be made in place.

---

## Retrospective ADRs

EPI Coverage existed before this ADR directory was introduced.

Existing architectural decisions may be recorded retrospectively when:

* the decision is still active;
* repository evidence supports it;
* understanding its rationale will help future development.

Retrospective ADRs must include:

`Recorded retrospectively: yes`

Do not invent historical alternatives or reasoning that cannot be supported by repository evidence or known project decisions.

---

## File Naming

Use:

`NNNN-short-kebab-case-title.md`

Examples:

* `0001-use-google-apps-script-and-google-sheets.md`
* `0002-separate-individual-and-aggregate-epi-data.md`
* `0003-centralize-config-driven-vaccine-rules.md`

Numbers are sequential and must not be reused.

---

## ADR Template

Each ADR should use this structure:

### ADR Header

`# ADR-NNNN: Title`

Metadata:

* Status: Proposed | Accepted | Deprecated | Superseded
* Date: YYYY-MM-DD
* Recorded retrospectively: yes | no
* Supersedes: none | ADR-NNNN
* Superseded by: none | ADR-NNNN

### Context

Describe the architectural problem or constraint that required a decision.

### Decision

Describe what was decided.

### Rationale

Describe why this option was selected.

### Consequences

Describe what becomes easier, harder, required, or prohibited because of the decision.

### Alternatives Considered

List meaningful alternatives only when they are actually known.

Do not invent alternatives solely to make the ADR appear complete.

### References

Reference relevant repository documentation, issues, source modules, or related ADRs.

---

## Agent Rules

AI coding agents must:

* read applicable ADRs before changing architecture covered by them;
* not silently override an Accepted ADR;
* surface conflicts when a requested change contradicts an Accepted ADR;
* create a new ADR instead of rewriting architectural history when a decision changes;
* avoid creating ADRs for routine implementation choices.

Creating an ADR documents an architectural decision. It does not authorize expansion of implementation scope.

---

## Current ADR Index

- [ADR-0001](0001-use-google-apps-script-and-google-sheets.md) — Use Google Apps Script and Google Sheets for the application backend. **Accepted**
- [ADR-0002](0002-separate-individual-and-aggregate-epi-data.md) — Separate individual EPI data from aggregate HDC OpenData. **Accepted**
- [ADR-0003](0003-centralize-config-driven-vaccine-rules.md) — Centralize configurable vaccine-rule ownership in the backend. **Accepted**
- [ADR-0004](0004-rate-limit-safe-moph-opendata-sync.md) — Use paced, bounded retries for MOPH OpenData synchronization. **Accepted**
- [ADR-0005](0005-route-opendata-through-external-relay.md) — Route OpenData acquisition through an external fetch relay. **Accepted**
- [ADR-0006](0006-vaccine-rules-sheet-is-staff-owned-primary-source.md) — The staff-configured `vaccine_rules` sheet is the primary source for follow-up; rule evaluation is authoritative for View 2. **Accepted** (supersedes ADR-0003 "Relationship to View 2" and ADR-0002 "View 2 Boundary")
- [ADR-0007](0007-mandatory-import-preflight.md) — Every EPI import runs a read-only, server-enforced preflight; risky imports need a typed confirmation. **Accepted**
- [ADR-0008](0008-vaccine-rule-birth-window-keyed-on-birth-date.md) — A schedule change between cohorts is a per-rule Birth Window keyed on birth date. **Accepted**
- [ADR-0009](0009-import-undo-is-exact-or-refused.md) — Import Undo reverses only record activity, exactly or not at all; batches that updated existing records cannot be undone. **Accepted**
- [ADR-0010](0010-import-undo-finishes-or-stays-unfinished.md) — Import Undo records an `undoing` plan first and is `undone` only when every step is complete; an Unfinished Import Undo is finished by running it again and blocks Imports into its table and Fiscal Year. **Accepted**
