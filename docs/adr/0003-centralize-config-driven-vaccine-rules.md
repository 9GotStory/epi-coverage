# ADR-0003: Centralize Config-Driven Vaccine Rules in the Backend

* Status: Accepted
* Date: 2026-09-11
* Recorded retrospectively: yes
* Supersedes: none
* Superseded by: none

## Context

EPI Coverage contains vaccine-related behavior that varies by fiscal year, age group, vaccine field, target age, alternative field combinations, activation state, and vaccine-date validation settings.

Earlier implementation patterns included vaccine-specific logic distributed across frontend code.

The current backend contains a config-driven Vaccine Rules Engine backed by persisted `vaccine_rules` configuration.

The rule subsystem supports concepts including:

* fiscal-year scope;
* age-group scope;
* required vaccine fields;
* alternative field branches;
* target age in months;
* active/inactive rule state;
* date-check configuration;
* backend-generated rule suggestions and defaults.

The backend also owns the canonical default target-age mapping used when generating rule suggestions and seed configuration.

Because vaccine-rule behavior is business-critical and may evolve across reporting periods, duplicating the same logic independently in frontend modules would create a high risk of inconsistent evaluation.

## Decision

EPI Coverage will centralize configurable vaccine-rule behavior in the backend Vaccine Rules Engine.

The backend rule subsystem is the canonical owner of configurable vaccine-rule semantics.

Frontend code may:

* retrieve rule configuration;
* display rule state;
* provide administrative editing interfaces;
* request backend-generated suggestions;
* present evaluation results;
* perform presentation-only transformations.

Frontend code must not independently recreate or maintain a second authoritative copy of configurable vaccine-rule logic.

The rule subsystem may use persisted configuration and backend-owned defaults where documented.

Examples of rule configuration include:

* `required_fields`;
* `branch_alt_fields`;
* `target_age_months`;
* `date_checks`;
* activation state;
* fiscal-year and age-group scope.

Backend-owned default mappings, such as default target ages associated with vaccine fields, must remain centralized rather than being copied into unrelated frontend modules.

## Rationale

Vaccine-rule behavior has multiple dimensions and can change independently of the frontend deployment.

A centralized config-driven subsystem provides one explicit ownership boundary for this behavior.

This reduces the risk that:

* frontend and backend calculate different results;
* one age-group implementation diverges from another;
* a fiscal-year change requires editing several hard-coded modules;
* administrative rule changes are ignored by hard-coded client logic;
* target-age or date-check defaults drift between implementations.

The architectural intent is:

```text
Persisted vaccine_rules
          |
          v
Backend Vaccine Rules Engine
          |
          +--> rule retrieval
          +--> validation
          +--> defaults / suggestions
          +--> evaluation-related behavior
          |
          v
Frontend consumes rule behavior
without becoming a second rule authority
```

This ADR establishes ownership of configurable rule semantics. It does not make the Vaccine Rules Engine authoritative for every immunization-related value in the application.

## Consequences

### Positive

* Configurable vaccine-rule behavior has one primary ownership boundary.
* Fiscal-year and age-group rule changes can be represented through configuration where supported.
* Frontend modules do not need independent hard-coded copies of rule semantics.
* Administrative rule-management features can operate against the same backend rule model.
* Rule-related defaults and validation logic can evolve centrally.
* Automated tests can target the backend rule seam rather than duplicating equivalent expectations across multiple UI modules.

### Constraints

* Frontend code must not introduce a second authoritative vaccine-rule map.
* New configurable vaccine-rule behavior should be implemented in the backend rule subsystem unless there is a documented reason otherwise.
* Persisted rule configuration must be validated before mutation.
* Rule changes must preserve fiscal-year and age-group scope.
* Backend defaults must not silently overwrite existing persisted rules unless an explicitly defined reset or migration operation is being performed.
* Rule-engine behavior must not be inferred solely from vaccine field names when canonical configuration or documentation exists.
* Changes to business meaning must be reflected in `docs/features.md` and relevant tests.

### Relationship to View 2

The Vaccine Rules Engine is not automatically authoritative for the displayed Fully Immunized result in View 2.

For the current documented behavior, View 2 uses the imported HDC `result` as its displayed result authority.

Therefore:

```text
Vaccine Rules Engine
        !=
View 2 result authority
```

A future decision to calculate View 2 Fully Immunized results locally would require an explicit business-behavior change and corresponding documentation and testing.

### Relationship to Date Validation

Vaccine date validation is part of the configurable rule subsystem.

Date-quality observations may include concepts such as:

* dates before birth;
* whether vaccination on the birth date is allowed;
* same-day vaccine-date relationships;
* ordered vaccine-date relationships.

A date-validation observation must not automatically be interpreted as a missing vaccine unless the documented business behavior explicitly defines that outcome.

### Future Change

This ADR does not prohibit replacing the current rule engine or storage representation.

A replacement must preserve or deliberately redefine:

* rule ownership;
* fiscal-year scope;
* age-group scope;
* required and alternative field semantics;
* target-age semantics;
* date-check behavior;
* migration of persisted rule configuration;
* administrative rule-management behavior;
* compatibility with affected reporting features.

A materially different ownership model should supersede this ADR.

## Alternatives Considered

The repository indicates that the config-driven backend rule engine replaced vaccine logic that had previously been hard-coded in frontend vaccine modules.

That distributed frontend approach is therefore a known historical alternative.

It is not retained as the authoritative architecture because it creates duplicate rule ownership and increases the risk of inconsistent behavior across features.

No additional historical alternatives are reconstructed without repository evidence.

## References

* `../features.md` — vaccine-rule and reporting behavior
* `../schema.md` — `vaccine_rules` persistence contract
* `../../CONTEXT.md` — Vaccine Rule, Required Field, Alternative Branch, Target Age, Vaccine Date Checks, and Vaccine Rules Engine terminology
* `../../backend/src/VaccineRules.js` — current backend rule subsystem
* `0002-separate-individual-and-aggregate-epi-data.md` — individual versus aggregate data boundary
