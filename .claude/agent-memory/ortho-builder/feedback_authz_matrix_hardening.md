---
name: feedback-authz-matrix-hardening
description: How tests/authz-matrix.test.ts's self-defenses were built across 3 tours (Task 13 step 2) and what a future editor of that file must preserve
metadata:
  type: feedback
---

`tests/authz-matrix.test.ts` is the ONLY automatic guard against unauthorized
access to patient data (no auth layer existed before Task 12; this is the
RBAC regression net). It went through 3 hardening tours in Task 13 step 2,
each closing a way the test could be silently defeated without failing.

**Why so many tours**: ortho-security audits this file adversarially on every
change and treats "the test still passes" as insufficient — it demands a
*replayed* proof that a plausible mistake or shortcut actually makes the test
fail, not just a read of the code. Expect this file to keep getting audited
this way; write new rows/tests with that lens already applied.

**The pattern each tour follows** (useful template for closing a similar gap
elsewhere): (1) find a way a future agent could accidentally OR could take a
shortcut to make a red row/test go green without actually fixing the
underlying route, (2) close it, ideally with two independent layers — a
compile-time constraint (a restrictive type / a `Record<K,...>` whose keys
must all be present) AND a runtime invariant test that catches an `as any`
cast around the type, (3) prove non-vacuity by literally reproducing the
attack (mutate the file, watch it fail with the right message, revert, watch
it pass again) — not by reasoning about it.

**Concrete defenses now in place** (as of tour 3, 2026-08-28):
- `okStatus?: AuthorizedOkStatus` (a closed union excluding 401/403) +
  runtime invariant test sweeping all of `ROUTES` — stops a row from
  "passing" by colliding its authorized-status with the forbidden-status.
- `handler: auditRoute` (direct export reference, never `(r) => auditRoute(r)`)
  + a `row.handler !== routeModule[method]` check in the coverage test — stops
  a copy-pasted row from silently testing a different route's handler while
  still going green on all 4 actor cells.
- `for (const kind of Object.keys(EXPECTED) as ActorKind[])` — never a literal
  actor array — so dropping an actor breaks `npm run typecheck`, not just a
  silent narrowing of coverage.

**Known open debt, explicitly out of scope until later steps** (see the
relay file `.claude/tasks/task-13.md` §Étape 2 Journal for the exact
tour/step assignment): `allowed` is never checked against a reference (an
over-permissive row is currently invisible — due étape 4/6), CSRF is absent
from the matrix harness (due étape 4/5/6, lives in integration tests
instead), the harness never requests an id that actually exists (due étape
5), and only `src/app/api/admin` is scanned — pages under `src/app/admin/**`
are not (due étape 7).

See also [[project-task13-relay-file-is-authoritative]].
