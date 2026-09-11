# ADR-0001: Use Google Apps Script and Google Sheets for the Application Backend

* Status: Accepted
* Date: 2026-09-11
* Recorded retrospectively: yes
* Supersedes: none
* Superseded by: none

## Context

EPI Coverage is implemented as a browser-based React application that requires backend capabilities for authentication-aware API operations, EPI data import and persistence, administrative workflows, audit information, configurable vaccine rules, and integration with external data sources.

The current application architecture uses:

* React as the browser frontend;
* Google Apps Script (GAS) as the backend/API layer;
* Google Sheets as the primary application data store.

This architecture predates the introduction of formal ADRs in the repository and is already established across the implementation and technical documentation.

Because multiple application features depend on this boundary, future development needs a durable record that GAS and Google Sheets are intentional architectural components rather than temporary implementation details.

## Decision

EPI Coverage will continue to use Google Apps Script as its backend/API layer and Google Sheets as its primary application persistence mechanism unless this ADR is superseded by a later architectural decision.

The React frontend communicates with application backend behavior through the GAS API boundary rather than directly owning persistence or privileged backend operations.

Backend responsibilities include, where applicable:

* authenticated and authorized application operations;
* persistence and retrieval of application data;
* EPI import processing and synchronization;
* administrative operations;
* audit-related operations;
* vaccine-rule management and evaluation;
* server-side integration with external APIs.

External services that cannot or should not be accessed directly from the browser may also be accessed through the GAS backend boundary.

The current HDC OpenData integration therefore uses GAS as a proxy rather than making the browser directly responsible for that external API integration.

## Rationale

The repository already relies on GAS and Google Sheets across its backend behavior and data model.

Keeping this architecture explicit provides one stable ownership boundary:

```text
Browser / React
      |
      v
Google Apps Script
      |
      +--> Google Sheets
      |
      +--> Backend-controlled external integrations
```

This prevents application persistence, privileged operations, and backend-specific integration behavior from being distributed unpredictably across frontend modules.

The OpenData proxy is consistent with this boundary because the current browser application cannot reliably call the MOPH OpenData endpoint directly due to the documented CORS constraint.

This ADR records the architecture that exists. It does not claim that GAS or Google Sheets are universally preferable to other backend or database technologies.

## Consequences

### Positive

* The system retains a simple deployment and operational model.
* Backend behavior has a defined ownership boundary.
* Google Sheets remains aligned with the existing application schema and operational workflows.
* Browser code does not need to own direct persistence behavior.
* External integrations that require server-side mediation can remain behind GAS.
* Existing import, administration, rules, and audit behavior can evolve without introducing an additional backend platform solely for architectural uniformity.

### Constraints

* GAS execution and platform limitations must be respected.
* Google Sheets is not a general-purpose relational database and must not be treated as one.
* Backend implementations must use appropriate batch operations rather than inefficient per-cell mutation patterns.
* Identifier formatting requirements, including leading-zero preservation for healthcare facility codes, must be preserved when writing to Sheets.
* Authentication and authorization must be enforced according to the backend security architecture rather than relying only on frontend state.
* Browser code must not bypass the defined backend boundary for privileged application operations.
* Direct browser access to external services must not be introduced when the established backend proxy is required for security, authorization, platform, or CORS reasons.

### Future Change

This ADR does not prohibit migration to another backend or persistence technology.

A migration should be treated as a new architectural decision and should address:

* application API compatibility;
* authentication and authorization;
* EPI import behavior;
* vaccine-rule persistence;
* audit behavior;
* facility-code and identifier integrity;
* data migration and reconciliation;
* external API integration;
* deployment and operational ownership.

Such a change should supersede this ADR rather than silently replacing the current architecture.

## Alternatives Considered

No reliable repository evidence has been identified that records a formal comparison with alternative backend or database platforms at the time this architecture was originally selected.

Alternatives are therefore intentionally not reconstructed retrospectively.

## References

* `../spec.md` — current system architecture and integration constraints
* `../schema.md` — Google Sheets data contracts
* `../features.md` — application behavior implemented through this architecture
* `../../CLAUDE.md` — project-wide agent operating contract
