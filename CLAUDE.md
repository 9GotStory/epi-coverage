# EPI Coverage — Project Agent Instructions

This file is the canonical operating contract for AI coding agents working in this repository.

Claude Code reads this file directly. Other coding agents should enter through `AGENTS.md`, which delegates to this contract.

The project contains public-health business rules and potentially sensitive health-related data. Correctness, data integrity, security, and traceability take priority over implementation speed.

---

## 1. Project Mission

EPI Coverage is a district-level childhood immunization coverage and follow-up system.

The system combines:

* individual EPI records imported from operational data,
* configurable vaccine evaluation rules,
* healthcare facility information,
* aggregate MOPH/HDC OpenData,
* administrative and audit functionality,
* dashboards and exports for operational follow-up.

Do not infer public-health business rules from general medical knowledge when repository-defined rules exist.

---

## 2. Source of Truth

Do not duplicate canonical information between documents.

When sources appear to conflict, stop and identify the conflict rather than silently choosing one.

### Domain vocabulary

`CONTEXT.md`

Defines the shared language used by developers and agents.

If it does not exist yet, use the existing repository terminology and do not invent alternative names unnecessarily.

### Business behavior and vaccine rules

`docs/features.md`

Canonical source for:

* vaccine evaluation behavior,
* age-group behavior,
* coverage views,
* business rules,
* field mappings that affect business interpretation.

Do not reproduce vaccine rules in this file.

### Data contract

`docs/schema.md`

Canonical source for:

* Google Sheets structure,
* column names,
* field types,
* identifiers,
* storage-related constraints.

### Technical architecture

`docs/spec.md`

Canonical source for:

* frontend/backend architecture,
* integration boundaries,
* authentication architecture,
* deployment constraints,
* data-access patterns.

### UI and design system

`DESIGN.md`

Canonical source for:

* colors,
* typography,
* spacing,
* radius,
* layout,
* component appearance,
* visual behavior.

Do not invent or duplicate design tokens in implementation instructions.

### Architectural decisions

`docs/adr/`

Canonical record of significant architectural decisions and their rationale.

If an architectural decision is difficult to reverse, affects several modules, or establishes a long-lived project rule, consider whether an ADR is required.

---

## 3. Required Reading

Before changing code, determine which canonical documents apply to the requested change.

At minimum, always inspect:

* this `CLAUDE.md`;
* the relevant existing implementation;
* the tests around the affected behavior.

Then read the relevant canonical documents.

Examples:

* UI change → `DESIGN.md`
* vaccine/business-rule change → `docs/features.md`
* data/schema change → `docs/schema.md`
* architecture/integration change → `docs/spec.md`
* terminology/domain change → `CONTEXT.md`
* architectural decision → relevant `docs/adr/*`

Do not mechanically read unrelated documents merely to satisfy a checklist.

---

## 4. Repository Architecture

The application currently has two primary implementation areas:

```text
frontend/
backend/
```

### Frontend

The frontend is a React + TypeScript application built with Vite.

The project follows Feature-Sliced Design principles.

Current high-level structure includes:

```text
frontend/src/
├── app/
├── features/
├── pages/
├── shared/
└── widgets/
```

Respect existing boundaries before introducing new ones.

Do not move code between layers or create new architectural abstractions without a concrete requirement.

Avoid speculative abstractions.

### Backend

The backend uses Google Apps Script and Google Sheets.

Preserve existing GAS constraints and data-integrity behavior.

Prefer batch operations where the existing architecture requires them.

---

## 5. Non-Negotiable Data Integrity Rules

Healthcare facility codes and similar identifiers may contain leading zeroes.

They are identifiers, not quantities.

Therefore:

* preserve them as strings;
* never intentionally coerce them to numbers;
* never remove leading zeroes;
* preserve repository-defined formatting rules when writing them to Google Sheets.

Use `docs/schema.md` as the canonical data-contract reference.

Do not change field meaning, identifiers, mappings, or vaccine-field semantics without confirming the corresponding canonical documentation and tests.

---

## 6. Sensitive Data Rules

Treat individual-level health and identity data as sensitive.

Never:

* commit production health records;
* commit credentials or tokens;
* include real personal data in test fixtures;
* expose sensitive records in logs;
* paste production records into documentation;
* include sensitive data in screenshots intended for repository documentation;
* bypass `.gitignore` using `git add -f` for ignored production-data files.

In particular, local `EPI-*YEAR.json` source files must remain local and untracked unless an explicit sanitized-data workflow is designed separately.

Use synthetic or irreversibly anonymized fixtures for automated tests.

---

## 7. Security Rules

Security-sensitive behavior must fail closed where appropriate.

Do not:

* hardcode secrets, OAuth credentials, deployment credentials, or private endpoint configuration;
* commit `.env` files containing secrets;
* remove authentication or authorization checks merely to make a request work;
* expose privileged functionality through UI-only authorization;
* trust client-provided authorization state where server-side verification is required.

Follow the architecture documented in `docs/spec.md`.

When security behavior is ambiguous, investigate before changing it.

---

## 8. External Documentation and Research

Do not rely on remembered library behavior when correctness depends on a specific current version.

When implementing or changing behavior involving external libraries, frameworks, APIs, or deployment platforms:

1. inspect the version actually used by the repository;
2. consult current authoritative documentation when necessary;
3. compare that documentation with the existing implementation;
4. record a significant architectural conclusion in an ADR when appropriate.

Prefer primary documentation over tutorials or copied snippets.

Research is a tool for resolving uncertainty, not a mandatory ceremony for every code edit.

---

## 9. Change Discipline

Before editing:

1. understand the requested behavior;
2. inspect the affected code;
3. identify the relevant public seam;
4. inspect existing tests;
5. identify applicable canonical documentation.

During implementation:

* make the smallest coherent change that satisfies the requirement;
* preserve unrelated behavior;
* avoid opportunistic refactoring;
* avoid changing unrelated files;
* do not silently alter documented business behavior;
* do not weaken validation merely to make tests pass.

If the requested change conflicts with a documented invariant, surface the conflict.

---

## 10. Testing Principles

Prefer tests that verify externally observable behavior through stable public seams.

Avoid tests coupled to implementation details.

For business-critical behavior such as vaccine evaluation, field mapping, data normalization, upload processing, and authorization:

* prefer a regression test for confirmed bugs;
* prefer known-good expected values from repository-defined business rules;
* cover edge cases that could materially change operational results.

Do not make a failing test pass by weakening or deleting the assertion unless the requirement itself has changed and the canonical documentation is updated accordingly.

---

## 11. Verification Before Completion

Do not claim a change is complete without running the relevant available checks.

For frontend changes, the canonical verification commands are:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Run the checks relevant to the change. For changes that can affect shared frontend behavior, data handling, application wiring, or production compilation, run the full frontend verification set.

`npm run test:watch` is for interactive development only and is not a completion gate.

For backend changes, the canonical test command is:

```bash
cd backend
npm test
```

Run backend tests for changes that affect backend behavior, data processing, authorization, persistence, imports, synchronization, vaccine rules, or related shared logic.

Testing, linting, and building are independent verification signals.

Do not report one check as evidence that another check passed.

If an expected verification command is missing, broken, skipped, or cannot be executed, report that explicitly rather than claiming verification succeeded.

Do not treat manual inspection as equivalent to an automated check when an automated check is available.

---

## 12. Documentation Discipline

Update documentation only when the source-of-truth information has actually changed.

Use:

* `README.md` for human onboarding and operation;
* `CONTEXT.md` for shared domain terminology;
* `docs/features.md` for business behavior;
* `docs/schema.md` for data contracts;
* `docs/spec.md` for technical architecture;
* `DESIGN.md` for the UI design system;
* `docs/adr/` for significant architectural decisions.

Do not copy the same rule into several files.

When a rule belongs to another canonical document, link to that document instead.

---

## 13. Git Discipline

Before making a change:

```bash
git status --short --branch
```

Do not overwrite unrelated local changes.

Keep commits focused on one coherent purpose.

Do not:

* force-push without explicit authorization;
* rewrite shared history without explicit authorization;
* use destructive reset operations casually;
* commit ignored production data;
* mix unrelated cleanup into a feature or bug-fix change.

Temporary investigation scripts and local production-data files should remain outside committed source unless they are deliberately promoted into maintained project assets.

---

## 14. Working With Uncertainty

Never silently guess when uncertainty can materially affect:

* vaccine evaluation;
* public-health calculations;
* data mappings;
* healthcare facility identifiers;
* authentication or authorization;
* privacy or sensitive-data handling;
* destructive data operations;
* external API contracts.

Investigate the repository source of truth first.

If the repository itself contains contradictory information, report the contradiction before changing behavior.

---

## 15. Engineering Priorities

When trade-offs are necessary, prefer:

1. Correctness
2. Data integrity
3. Security and privacy
4. Simplicity
5. Maintainability
6. Testability
7. Performance based on demonstrated need

Avoid over-engineering.

Prefer simple, explicit designs that fit the current scale and architecture of EPI Coverage.

---

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`9GotStory/epi-coverage`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The default workflow labels are used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. They support issue-producing skills such as `to-spec` and `to-tickets`; the `triage` skill itself is not installed. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
