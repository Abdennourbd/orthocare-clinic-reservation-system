---
name: project-task13-patients-route-conventions
description: Conventions established by task-13.md step 4 (src/app/api/admin/patients/route.ts) that steps 5-6 (the /[id]* routes) must follow for consistency
metadata:
  type: project
---

Step 4 of Task 13 set several precedents the later `/api/admin/patients/[id]*`
routes (steps 5-6) should match, since there was no earlier admin
create/write route to copy from:

- **CSRF failure on admin routes uses its own code, `403
  CSRF_ORIGIN_MISMATCH`, not `FORBIDDEN`.** `FORBIDDEN` is already what
  `requireStaff` returns for a role mismatch; reusing it for CSRF would make
  the two causes indistinguishable in `/admin/audit` and in future debugging.
  (The older auth routes — login/logout/change-password — do reuse
  `FORBIDDEN` for CSRF; that precedent predates this distinction and was not
  changed, but new admin/patients-family routes should use
  `CSRF_ORIGIN_MISMATCH`.)
- **Mandated order in every non-GET admin/patients handler:** `requireStaff`
  → `assertSameOriginStrict` → `checkRateLimit` (write routes only) → Zod →
  domain checks (phone normalize / duplicate check / not-found) → DB write.
  A 404/400 must never precede a 401/403 — the authz matrix's `okStatus`
  mechanism exists specifically to prove this ordering.
- **Rate-limit key for patient writes is `staff:<userId>:patients-write`,
  never IP.** A single clinic sits behind one shared public IP; an IP key
  would either do nothing (shared bucket) or DoS the whole front desk.
- **Never spread `parsed.data` (or a destructured remainder of it) into a
  Prisma `data:` object.** `patientCreateSchema`/`patientUpdateSchema` both
  carry `duplicateAcknowledged`, which is not a `Patient` column — passing it
  through throws `PrismaClientValidationError`, whose message serializes the
  patient's name/phone (a PHI leak into logs). Step 4 went further than the
  relay's suggested "destructure it out" fix: it **enumerates every Prisma
  field by name** in the `data:` object instead, which also forecloses the
  same class of bug for any *future* schema field that isn't a column, not
  just the one known today. Prefer this pattern over destructure+spread in
  steps 5/6 too.
- **Invalid phone on write is `422 INVALID_PHONE`** (not the step card's
  guessed `400`), matching the one existing precedent in the repo,
  `src/app/api/appointments/route.ts:77-84`. Repo consistency beat the step
  card's assumption here — check for an existing precedent before inventing a
  status code.
- **The 409 `DUPLICATE_CANDIDATES` response is audited** as
  `PATIENT_RECORD_VIEWED` with `detail: { scope: "duplicate-check",
  candidateCount, matchedOn }` — because it's a side-effect-free, replayable
  read of other patients' identity (id/firstName/lastName/phone) that
  otherwise leaves zero trace. Same reasoning applies anywhere else a
  duplicate-check-shaped read could occur (e.g. `PATCH` in step 5 changing
  phone).
- The `GET` list route **is** audited too (`PATIENT_RECORD_VIEWED`, `detail:
  { scope: "list", resultCount }`) per a later, dated user ruling
  (task-13.md §Exigences point 6) that overrides step 4's own card text
  ("GET list does not audit") — see [[project-task13-relay-file-is-authoritative]].
  The search string `q` (and any submitted name/phone, on the 409 path too)
  must NEVER appear in `AuditLog.detail` — verify with
  `JSON.stringify(detail).not.toContain(...)`, not just "key absent", since a
  value could leak nested or concatenated into another field.
- `tests/authz-matrix.test.ts` rows for a route file must reference the
  route's exported function directly as `handler` (e.g. `handler:
  patientsListRoute`), never an arrow-wrapped closure — the coverage test
  asserts `row.handler === routeModule[method]` by reference identity.

See also [[project-patient-duplicates-accent-tradeoff]] for the duplicate
matcher these routes call, and [[feedback-authz-matrix-hardening]] for why
`okStatus` is type-restricted.
