## 0. Context

plan.md and my annotated Pattern Spec (PATTERN-SPEC.md, secrets redacted) are in the root of the repo for coding AI agent's reference. The coding AI agent must follow instructions in this AGENTS.md, and plan.md and PATTERN-SPEC.md. the plan.md contains a checklist to be updated by the coding AI agent every round. 


## 1. General coding hygiene

**Think before coding.** State assumptions explicitly; if uncertain, ask. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so. If something is unclear, stop, name what's confusing, and ask.

**Surgical changes.** Touch only what you must. Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken; match existing style. Remove imports/variables/functions that *your* changes made unused, but don't delete pre-existing dead code unless asked — mention it instead. Every changed line should trace directly to the request.

**Goal-driven execution.** Turn tasks into verifiable goals and state a brief plan for multi-step work (`1. step → verify: check`). For this project, verification usually means running the pipeline end-to-end and checking outputs; lightweight unit tests for data-processing functions are encouraged (they are explicitly valued and are cheap marks). Confirm the pipeline still runs after each meaningful change.

---

**These guidelines are working if:** decisions are surfaced to the user before code is written and the code carries clear professional comments.


