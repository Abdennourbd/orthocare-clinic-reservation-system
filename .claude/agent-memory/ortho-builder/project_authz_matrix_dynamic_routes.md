---
name: project-authz-matrix-dynamic-routes
description: tests/authz-matrix.test.ts now supports dynamic [id] routes and widened its file/method scan — read before adding any /api/admin/patients/[id]-style route
metadata:
  type: project
---

As of Task 13 step 2 (2026-08-28), `tests/authz-matrix.test.ts` (the sole
automatic RBAC safety net for `/api/admin/*`) supports dynamic routes:

- `RouteRow.path` was split into `scanPath` (literal, matches the fs scan,
  e.g. `/api/admin/patients/[id]`) and `requestPath?`/`params?` (the actual
  URL/params to request, e.g. `/api/admin/patients/does-not-exist`).
- `handler` signature widened to
  `(request, { params: Promise<Record<string,string>> }) => Promise<Response>`
  to match real Next 16 dynamic route handlers.
- `adminStatus?` (declared but never read in the original code — a dead
  field) was renamed `okStatus?` and is now actually applied to any
  authorized actor, not just admin — needed because an authorized caller can
  legitimately get 404/400 after the guard passes.
- The file-scan filter now covers `route.ts|tsx|js|jsx` (anchored on path
  separator: `/(^|[\\/])route\.(ts|tsx|js|jsx)$/`, not a bare `endsWith`) and
  `HTTP_METHODS` now includes `OPTIONS`. Both were deliberate *widenings*
  approved by the user (2026-08-28 arbitrage in `.claude/tasks/task-13.md`
  §Exigences point 7) — narrowing this filter is forbidden.
- The Windows backslash-to-slash normalization must run BEFORE stripping the
  `route.(ext)` suffix (readdir recursive returns backslashes on Windows) —
  this ordering bug was already hit once; the fix is documented inline.

**How to apply**: when Task 13 steps 3+ add
`src/app/api/admin/patients/[id]/route.ts`, add its row with `scanPath:
"/api/admin/patients/[id]"`, `requestPath: "/api/admin/patients/<some-id>"`,
`params: { id: "<some-id>" }`. See [[feedback-relay-file-precedence]] for why
the "hors périmètre" line in the step-2 card was overridden.
