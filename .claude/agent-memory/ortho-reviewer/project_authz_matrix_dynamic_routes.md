---
name: project-authz-matrix-dynamic-routes
description: authz-matrix.test.ts harness cannot yet exercise dynamic admin routes (e.g. /api/admin/patients/[id]) — needs extension before Task 13
metadata:
  type: project
---

`tests/authz-matrix.test.ts` (Task 12) derives `routePath` from scanning
`src/app/api/admin/**/route.ts` and its `RouteRow.handler` is called as
`row.handler(new NextRequest(url, ...))` — a single argument, no second
`context: { params: Promise<...> }` argument. Next 16 route handlers for
dynamic segments receive params as a second argument and must await it
(see CLAUDE.md "Next.js 16 gotchas").

**Update 2026-08-28 (Task 13 step 2, reviewed as VERT/debt)**: the harness was
extended — `RouteRow.path` split into `scanPath` (scan-comparison key) +
`requestPath?` (actual URL, defaults to `scanPath`) + `params?` (defaults to
`{}`); `handler` now takes `(request, { params: Promise<Record<string,string>> })`;
`requestAs()` wires `Promise.resolve(row.params ?? {})` through. Dead
`adminStatus?` field reactivated as `okStatus?`, applied to any authorized
actor (not just admin), with a dedicated test proving it never leaks past the
guard for unauthorized actors.

**Residual gap, NOT closed by step 2 — check when étape 4/5 add the first real
`ROUTES` row with a bracket `scanPath`**: none of the 3 tests added in step 2
exercise the full `RouteRow{scanPath: "…[id]…", requestPath, params}` →
`requestAs()` path together. The anti-IDOR test calls its fictitious handler
*directly* (bypasses `requestAs()`/`RouteRow` entirely); the okStatus-probe
test uses `requestAs()` but with a bracket-free `scanPath` and default
`params: {}`. So the URL-substitution + params-threading plumbing for an
actual dynamic row is still unproven end-to-end — low risk (the plumbing is
two trivial `??`-defaulted lines) but it is the one thing this step was
supposed to prove works, so verify it once a real `[id]` row lands rather than
assuming step 2 already covered it.

**Why**: Task 13 (fiches patients) adds `/api/admin/patients/[id]` and
several more dynamic routes under it (`todo.md:282`) — most of the 6 upcoming
routes are dynamic, so this plumbing is about to be load-bearing.

**How to apply**: when reviewing the first diff that adds a bracket-path row
to `ROUTES` (Task 13 étape 4 or 5), check that the request URL actually
contains the substituted value (not the literal `[id]`) and that
`context.params` resolves to what the route handler expects — don't assume
step 2's tests already proved this, they didn't.
