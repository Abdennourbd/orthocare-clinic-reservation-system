---
name: vitest-expect-message
description: vitest's expect() takes an optional second `message` argument, useful for self-explaining invariant assertions in shared test harnesses
metadata:
  type: project
---

`expect(actual, message?: string)` is supported by this repo's vitest version
(`@vitest/expect`, checked via `node_modules/@vitest/expect/dist/index.d.ts`
line ~184: `<T>(actual: T, message?: string): Assertion<T>`).

**Why it matters here**: `tests/authz-matrix.test.ts` is explicitly the
project's only automatic safety net against unauthorized patient-data access
(see its header comment). When adding a structural invariant assertion to
that file (or similar security-critical harnesses), pass a `message` that
explains *why* the invariant exists, not just that it failed — the person who
trips it next will likely be trying to force a red test green under time
pressure, and a bare `toEqual([])` gives them nothing to push back against.

**How to apply**: `expect(offendersArray, "explain the risk here").toEqual([])`
reads well for a "there must be zero of X" style invariant test.

See also [[authz-matrix-double-layer-protection]].
