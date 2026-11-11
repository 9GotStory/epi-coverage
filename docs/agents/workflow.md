# Workflow

Every change to this repo runs the mattpocock-skills **pipeline**. Each stage has one skill. Project skills live in `.claude/skills/`, and that directory is the source of truth for what exists. When a stage has a project skill, use it. For example, use `/grill-with-docs` rather than the bare global `/grilling`.

## Stages

| Stage | Skill | Enter when | Done when |
| --- | --- | --- | --- |
| Design | `/grill-with-docs` | The issue is `needs-triage`, or design decisions are still open | The decision frontier is empty, and `CONTEXT.md` / `docs/adr/` are updated where terms or decisions were settled |
| Spec | `/to-spec` | The design is settled | The spec is published as a GitHub issue labelled `ready-for-agent` |
| Slice | `/to-tickets` | The spec is too large for one PR | Tickets are published with their blocking edges |
| Build | `/implement #N` | The issue is `ready-for-agent` | `/tdd` has run at the agreed seams, `/code-review` findings are resolved, the CLAUDE.md §11 checks pass, and the work is committed on a feature branch |
| Ship | `/pr` (user-global skill) | The build is committed | The PR is open and its body closes `#N` |
| Release | none: merge, then deploy | CI is green and the user approves | Merged to `main`; the backend is deployed to the **existing** deployment ID via `backend/deploy.sh` after diffing the remote GAS code against the last deployed commit; Cloudflare Pages is on the same commit |

Enter at the earliest stage whose entry condition holds. A reported breakage starts with `/diagnosing-bugs` and joins the pipeline at Build.

## One issue per session

When an issue completes Release, the user runs `/clear` before starting the next issue. Every result a later session needs must therefore be durable, recorded in the issue or PR, the canonical docs, or an ADR. At the end of Release, confirm this, then tell the user that this is the point to run `/clear`. A fresh session starts from the issue itself (`gh issue view <N> --comments`), not from memory of an earlier conversation.

## Who invokes what

`/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement` and `/setup-matt-pocock-skills` are **user-invoked** (`disable-model-invocation: true`). When work reaches one of these stages, stop and give the user the exact command to type, for example `/implement #109`. Then wait for them to run it.

Other skills are model-invocable: `/tdd`, `/code-review`, `/domain-modeling`, `/research`, `/diagnosing-bugs`, `/codebase-design` and `/resolving-merge-conflicts`. Inside the pipeline they run as part of their stage skill. Call them directly only for work outside the pipeline.
