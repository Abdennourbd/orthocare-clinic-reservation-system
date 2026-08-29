---
name: boundaries-authz-matrix-harness
description: What tests/authz-matrix.test.ts structurally cannot prove — no Origin/Referer header, no admin *pages* scan, no existing-id request — plus the okStatus guard that closed the first tautology and the method to hunt the next one
metadata:
  type: project
---

The authz matrix ([[guard-authz-matrix-file-scan]]) is strong at what it does,
but several things sit outside it. Check them by hand whenever a step adds an
admin route or an admin page.

0. **Audit method that keeps paying: a table-driven RBAC row proves nothing
   unless *every field of the row* is constrained by something the loop
   actually reads.** Take `RouteRow` field by field (`method`, `scanPath`,
   `requestPath`, `params`, `allowed`, `okStatus`, `handler`) plus the inline
   actor list, and for each ask: if a hurried agent mis-fills it to turn a red
   row green, does anything — type, invariant, or coverage scan — bite? Grep
   how often each field is read; a field read once, or not at all, is the next
   tautology. That question found the `okStatus` defect (2026-08-28) and more
   after it.
1. **`okStatus` is now guarded at two layers** (Task 13 step 2, tour 2):
   the closed union `AuthorizedOkStatus` (excludes 401/403, enforced because
   `tsconfig.json` includes `**/*.ts`, so `npm run typecheck` covers tests) and
   a runtime invariant test sweeping `ROUTES` that catches an
   `as any` cast around the type. Both re-proved by out-of-repo replication.
   The historical defect: `okStatus: 403` on an `allowed:[ADMIN]` row makes a
   route that denies **everyone** go fully green — allowed and forbidden
   expectations collapse onto one status. Extension policy to police: adding a
   concrete 2xx/4xx to the union is fine, **a 5xx is not** — it would enshrine
   a crash as an expected response.
2. **CSRF is invisible to it.** `requestAs()` sets only the session cookie —
   no `Origin`, no `Referer`. `assertSameOriginStrict()` returns `true` when
   both are absent, so a non-GET admin route that forgot the CSRF call passes
   the matrix. Needs its own assertion in the route's integration test.
3. **Admin *pages* are not scanned.** The scan root is `src/app/api/admin`
   only. Pages under `src/app/admin/**` are protected by `src/proxy.ts`
   (cookie signature) + `src/app/admin/(dashboard)/layout.tsx`
   (`getStaffFromCookies`, the authoritative DB-backed check) — but no
   automated guard fails when a new page is added *outside* the `(dashboard)`
   group and therefore outside that layout. Recurring MAJEUR since
   2026-08-28.
4. **It only ever requests a non-existent id, as one actor shape per kind.**
   It proves guard-before-lookup (an unauthorized actor getting 404 fails three
   of the four cells — verified), but not the *differential*: identical
   response for an id that exists vs one that does not. Nor a deactivated
   ADMIN: the `deactivated` actor is always a RECEPTIONIST, and only
   `requireStaff` checking `active`/`tokenVersion` *before* the role makes that
   safe. Both belong in the route's own integration test.

Related: [[guard-authz-matrix-file-scan]],
[[invariant-audit-detail-no-patient-identity]]
