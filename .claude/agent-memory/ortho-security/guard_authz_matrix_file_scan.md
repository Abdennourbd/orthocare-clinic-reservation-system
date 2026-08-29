---
name: guard-authz-matrix-file-scan
description: The RBAC coverage guard lives in tests/authz-matrix.test.ts ("matrix covers every exported HTTP method of every admin route file") — how it works and how to prove it is not blind
metadata:
  type: project
---

The load-bearing RBAC guard of this repo is the test
`matrix covers every exported HTTP method of every admin route file`
in `tests/authz-matrix.test.ts`. It scans `src/app/api/admin/**`, dynamically
imports each route file, derives a `routePath` from the file path, and asserts
every exported HTTP method has a matching `"<METHOD> <scanPath>"` entry in the
`ROUTES` table.

**Why:** it is the only thing that makes a *new* admin route fail CI when its
authorization is untested. A change that makes this test green by making it
blind is worse than a red test.

State as of Task 13 step 2 (2026-08-28):
- filter is `/(^|[\\/])route\.(ts|tsx|js|jsx)$/` — covers all four extensions
  Next actually serves (`pageExtensions` is unset in `next.config.ts`, so the
  default `tsx,ts,jsx,js` applies).
- `HTTP_METHODS` has all **7** methods Next 16 supports (`route.md` §HTTP
  Methods lists exactly GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) — the list is
  now complete, not merely wider.
- `RouteRow` is `scanPath` (matrix key, keeps the literal `[id]`) +
  `requestPath?` + `params?` (Promise-wrapped by `requestAs`, per Next 16).
  **A row whose `scanPath` is the concrete request URL instead of the `[id]`
  literal makes the coverage test FAIL** — verified by simulation, so the
  split cannot be used to hide a route.

**How to apply:** whenever a diff touches that test's path derivation, filter,
or `HTTP_METHODS`, prove the guard still *fails* by re-simulating the loop in
a scratchpad file **outside the repo** (never create a fake route under
`src/`). Scenarios that must go RED: unlisted new route, new method on a
listed route, nested/dynamic path, `route.tsx`/`route.js`, `OPTIONS` on a
listed route; plus current repo state must yield `missing === []`.
Re-check the scan's *scope* too — see [[boundaries-authz-matrix-harness]] for
what it structurally cannot see.

Related: [[reference-windows-readdir-backslash]],
[[boundaries-authz-matrix-harness]],
[[invariant-audit-detail-no-patient-identity]]
