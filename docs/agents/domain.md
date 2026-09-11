# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain vocabulary for EPI Coverage.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

This is a single-context repo: no `CONTEXT-MAP.md`, no per-context `docs/adr/` directories.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill, used directly or reached via `/grill-with-docs`, creates them lazily when terms or decisions actually get resolved.

`CONTEXT.md` is vocabulary only. Business rules, data contracts, technical architecture, and the UI design system have their own canonical documents — see the source-of-truth index in `CLAUDE.md`.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-use-google-apps-script-and-google-sheets.md
│   ├── 0002-separate-individual-and-aggregate-epi-data.md
│   └── 0003-centralize-config-driven-vaccine-rules.md
├── frontend/
└── backend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (centralize config-driven vaccine rules), but worth reopening because…_
