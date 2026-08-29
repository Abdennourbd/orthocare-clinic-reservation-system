---
name: project-plan-md-lags-task-relay-decisions
description: Architecture-level user arbitrages recorded only in a task relay file (.claude/tasks/task-<N>.md), not propagated to tasks/plan.md
metadata:
  type: project
---

Task 13 step 3 (2026-08-29): the user's arbitrage on name-matching (normalize
in pure TypeScript, no `unaccent` extension) forced the builder into a
full-table-scan duplicate-detection strategy (`src/lib/patients/duplicates.ts`).
That's a real architecture decision (cost tradeoff, no SQL-level bound) but it
was only ever written into `.claude/tasks/task-13.md`'s Journal, never into
`tasks/plan.md` §Architecture Decisions — even though CLAUDE.md requires
`plan.md` to be updated when architecture changes, and the task relay file is
explicitly step-scoped/ephemeral, not a durable doc.

**Why**: task relay files accumulate arbitrages faster than they get folded
back into `plan.md`. Nobody's job in the pipeline is "sync relay-file
decisions into plan.md" — builders write to the relay file because that's
their channel, and reviewers/testers verify against the relay file too, so
the gap is invisible unless someone explicitly greps `plan.md` for the topic.

**How to apply**: when reviewing a step whose Journal contains an explicit
"user arbitrage" or "écart assumé" that changes a query strategy, data flow,
or the shape of a shared module — grep `tasks/plan.md` for the relevant
keyword before approving. If the decision isn't there and it's non-trivial
(perf tradeoff, new compromise, changed guarantee), flag it as MINEUR/MAJEUR:
"decision undocumented in plan.md, only in the ephemeral relay file."
