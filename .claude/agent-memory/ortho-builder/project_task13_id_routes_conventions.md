---
name: project-task13-id-routes-conventions
description: Conventions established by task-13.md step 5 (the /api/admin/patients/[id]* route family) — read before step 6 (anonymize) or any other dynamic admin route
metadata:
  type: project
---

Step 5 of Task 13 added `src/app/api/admin/patients/[id]/route.ts` (GET+PATCH),
`.../[id]/history/route.ts` (GET), `.../[id]/visits/route.ts` (POST). Precedents
for step 6 (`POST /[id]/anonymize`) and any future dynamic admin route:

- **Next 16 dynamic route params must be typed `Promise<Record<string, string>>`,
  NOT `Promise<{ id: string }>`, in any route file whose handler is referenced
  directly by `tests/authz-matrix.test.ts`.** The narrower type fails `tsc`
  when assigned to `RouteRow.handler` (`Record<string,string>` doesn't
  structurally guarantee an `id` key, so contravariant parameter checking
  rejects it), and the harness's tour-3 hardening (`row.handler ===
  routeModule[method]`) forbids wrapping the handler in a closure to paper
  over the mismatch. `const { id } = await params` still gives `id: string`
  either way (no `noUncheckedIndexedAccess` in tsconfig). This is a real
  tension with CLAUDE.md's own literal example signature — documented inline
  in each route file, not silently deviated from. See
  [[project-authz-matrix-dynamic-routes]].
- **`Prisma.<Model>UpdateInput` (checked) rejects a scalar FK field like
  `updatedById` directly** — it only accepts the nested relation form
  (`updatedBy: { connect: { id } }`). Use `Prisma.<Model>UncheckedUpdateInput`
  when building the `data:` object field-by-field with FK scalars, matching
  how `.create()` calls already do this elsewhere in the repo (those work
  without an explicit type annotation, which is why the mismatch wasn't
  caught until step 5 added an explicit `Prisma.PatientUpdateInput` type).
- **A PATCH that can change identity fields (name/phone) must replay BOTH
  duplicate-acknowledgement gates from the POST/create route, independently**:
  a name change re-triggers the NAME gate only if the name actually changed
  in this request (checked via "is the field present in the payload", not
  "does it differ from the stored value" — simpler and matches what
  `changedFields` already computes); a phone change re-triggers the PHONE
  gate the same way. Both share ONE `findDuplicateCandidates(..., excludeId:
  id)` call when either changed, to avoid a double full-table scan (see
  [[project-patient-duplicates-accent-tradeoff]] for why that scan is
  expensive). See [[task13-phone-sharing-fix]] for the originating gate split.
- **`changedFields` for an audit trail is built from an explicit whitelist
  array filtered by `data[field] !== undefined`, never `Object.keys(parsed.data)`.**
  A partial-with-defaults Zod schema (e.g. `duplicateAcknowledged:
  z.boolean().optional().default(false)`) still produces a defined key in
  `parsed.data` even when the client never sent it — `Object.keys` would
  wrongly include it.
- **A permission gate that doesn't need DB data (e.g. "only ADMIN may set
  `active`") should run BEFORE the 404 lookup, not after** — otherwise an
  under-privileged actor could distinguish "403 vs would-have-been-404" and
  learn whether a target id exists. Same reasoning as guard-before-404, one
  layer deeper.
- **STALE, fixed at étape 5 tour 2**: write routes on this family (PATCH,
  POST /visits) initially shipped with NO rate limit while GETs had one —
  ortho-security flagged this as MAJEUR-1. Fixed by adding
  `checkRateLimit(\`staff:<userId>:patients-write\`, PATIENTS_WRITE_RATE_LIMIT)`
  right after the CSRF check in both. The budget constant itself now lives in
  `src/lib/patients/rateLimits.ts` (`PATIENTS_WRITE_RATE_LIMIT`, 30/5min) —
  shared by `POST /api/admin/patients`, `PATCH /[id]`, `POST /[id]/visits`.
  **Lesson**: when a step ships GET-only rate limiting on a route family that
  also has writes, flag it explicitly rather than assuming "reads only" was
  a deliberate, permanent scope choice — it wasn't here, it was an oversight
  caught on the next security pass.
- **A candidate matched on BOTH "PHONE" and "NAME" needs its own gate,
  independent of which field the caller is editing.** Gating a dual match
  only via `nameChanged && …` or `phoneChanged && …` (the single-signal
  gates) misses the case where only ONE field changes but the resulting
  candidate already matches on the OTHER, unedited field too — e.g. editing
  only `phone` onto a pre-existing homonym's number. That candidate's
  `matchedOn` contains both reasons, but `nameChanged` is false so the NAME
  gate is structurally never evaluated. Fix: compute
  `dualMatches = candidates.filter(c => c.matchedOn.includes("PHONE") &&
  c.matchedOn.includes("NAME"))` and require BOTH acknowledgements whenever
  `dualMatches.length > 0`, checked BEFORE the two single-signal gates, with
  its own 409 code (`INDISTINGUISHABLE_RECORDS` in this repo) — do NOT just
  remove the `nameChanged &&`/`phoneChanged &&` guards on the existing gates,
  that reintroduces false-positive 409s on untouched pre-existing homonymy.
  This was ortho-security's BLOQUANT at étape 5 tour 2; proof pattern: temp
  `if (false && …)` mutation, run the new test alone, confirm it fails (200
  instead of 409), remove the mutation, confirm green.
- **`Visit.date` from a bare "YYYY-MM-DD" is exact-midnight-UTC, so same-day
  visits tie to the millisecond.** Any `orderBy`/merge-sort over `Visit`
  (or anything timestamped this way) needs an `id` tiebreak both at the
  Prisma `orderBy` level (per source query) AND in any TypeScript merge sort
  that combines rows from more than one source query — the DB-level tiebreak
  alone doesn't survive a merge of two independently-ordered arrays. Fixed at
  étape 5 tour 2 (MAJEUR-3) in `GET /[id]/history`. See also
  [[trap_createdAt_tie_no_tiebreak]] for the same class of bug elsewhere.
- **`anonymizedAt !== null` needs its own guard on every write route that
  touches a Patient or its children, not just the public booking path.**
  `PATCH /[id]` and `POST /[id]/visits` both added a `409 PATIENT_ANONYMIZED`
  check right after their 404 lookup (étape 5 tour 2, MAJEUR-2) — without it
  an erased chart's identity/notes could be silently re-written, and
  `findDuplicateCandidates()` already excludes anonymized rows so no 409
  would ever have warned staff either. Reuse this exact code/message for
  step 6 and any later route that writes to a `Patient`.
- **`active: false` now also suppresses non-transactional messaging**
  (`src/lib/messaging/index.ts`, both the initial send gate and the
  FAILED-retry gate — `select: { messagingOptOut, active }`, condition
  `patient?.messagingOptOut || patient?.active === false`). Transactional
  types still always send. No dedicated messaging test was added for this in
  step 5 (flagged as coverage debt, not silently skipped) — a future step
  touching `messaging.test.ts` should close that gap.
- **`upsertPatient()` (`src/lib/booking/createBooking.ts`) excludes
  anonymized records** (`anonymizedAt: null` in the phone+name resolution
  `findMany`'s `where`) — done in step 5 to prepare step 6's anonymization,
  proven by a test in `create-booking.test.ts`. Step 6 should NOT need to
  touch this file again for that reason.
