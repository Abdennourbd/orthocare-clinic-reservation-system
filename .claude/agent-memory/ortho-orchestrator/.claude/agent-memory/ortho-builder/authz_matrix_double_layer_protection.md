---
name: authz-matrix-double-layer-protection
description: pattern used to close a "value not constrained" gap in tests/authz-matrix.test.ts — restrict via TS literal union AND a runtime invariant test, not just one
metadata:
  type: feedback
---

When `ortho-security`/`ortho-reviewer` flag that a test-harness field is
"correctly wired but not constrained in value" (e.g. `okStatus?: number` could
legally be set to a value that makes an authorized-branch assertion collapse
onto the forbidden-branch assertion, silently making a matrix row
tautological), the accepted fix in this codebase is **two independent
layers**, not one:

1. A **TypeScript literal union type** that excludes the dangerous values at
   compile time (e.g. `type AuthorizedOkStatus = 200 | 201 | 204 | 400 | 404 |
   409 | 422` — deliberately omits 401/403). This catches a plain typo/literal
   mistake immediately in the editor and in `npm run typecheck`.
2. A **runtime invariant test** that sweeps the actual data structure (e.g.
   iterates `ROUTES` and asserts none of them has the dangerous value) with a
   `message` explaining *why* (see [[vitest-expect-message]]). This is what
   catches an `as any` / `as SomeType` cast that bypasses layer 1 — exactly
   the shortcut an agent under pressure to turn a red test green might reach
   for.

**Why both**: the type alone is bypassable with a cast; the runtime test
alone would let a bad value ship until CI runs. Together they make the
mistake essentially unshippable.

**Non-vacuity proof expected by the reviewer**: when adding this kind of
protection, actually trigger both layers with a temporary edit (literal value
→ typecheck fails; cast around the type → runtime test fails with the
explanatory message) and log both outputs before reverting. A protection that
"looks right" without being demonstrated failing-then-passing is treated as
suspect in this codebase — see `.claude/tasks/task-13.md` step 2 tour 2 for a
worked example.

This generalizes beyond `tests/authz-matrix.test.ts`: any shared test harness
in this repo (booking wizard, self-service token flow) that has a similarly
loosely-typed "expected outcome" field is a candidate for the same treatment
if a reviewer flags it.
