---
name: task13-phone-sharing-fix
description: Task 13 étape 4 tour 2 — how phone-sharing vs. homonym duplicate acknowledgement is split, and how upsertPatient() now resolves. Relevant to étape 5 (PATCH /[id]) and any future patient-matching code.
metadata:
  type: project
---

**The bug (ortho-security BLOCKING finding, 2026-08-29)**: `Patient.phoneE164`
is indexed but deliberately NOT `@unique` (Algerian families share phones).
`upsertPatient()` in `src/lib/booking/createBooking.ts` used to resolve on
phone ALONE (`findFirst({phoneE164}, orderBy: createdAt desc)`), so a public
booking with a shared phone silently overwrote whichever record was most
recently created — regardless of whose name was actually booking. Fixed to
resolve on phone AND `normalizeName()`-matched name (now exported from
`src/lib/patients/duplicates.ts`); no match on a known phone creates a new
record instead of overwriting a stranger's. Also stopped forcing `active:
true` on update — a public booking must never silently reverse an ADMIN's
soft-delete (étape 5).

**The API-side split (`src/app/api/admin/patients/route.ts` POST)**: one
acknowledgement flag used to gate both "this is a homonym" and "this phone is
already registered" — dismissing one silently dismissed the other. Now two
independent gates: `duplicateAcknowledged` for candidates with `"NAME"` in
`matchedOn` (409 `DUPLICATE_CANDIDATES`), `phoneSharingAcknowledged`
(`src/schemas/patient.ts`) for candidates with `"PHONE"` in `matchedOn` (409
`PHONE_ALREADY_REGISTERED`). A candidate matching BOTH name and phone requires
BOTH flags (literal reading of the user's ruling — rare case, not separately
tested).

**Relevant to étape 5**: `PATCH /api/admin/patients/[id]` will likely need the
same phone-sharing distinction if it re-runs duplicate detection on edit —
check whether the fiche for that step already accounts for
`phoneSharingAcknowledged` or only mentions `duplicateAcknowledged`, and flag
the gap if not (it wasn't written yet as of this fix).

**Update (étape 7, 2026-08-30) — correction, the "BOTH flags" line above is
no longer accurate for `POST`.** Étape 5 tour 2 gave `PATCH /[id]` a THIRD,
dedicated 409 code — `INDISTINGUISHABLE_RECORDS` (`dualMatches`, candidates
matching name AND phone at once, required because `PATCH`'s guards are
conditioned on `nameChanged`/`phoneChanged` and a single-field edit could
otherwise slip through with only one flag acknowledged). **`POST
/api/admin/patients` was never given this third code** — its two guards
(`nameMatches`/`phoneMatches`) are unconditional and evaluated in the same
fixed order every time, so a candidate matching both is still caught, just
via two sequential 409s (`DUPLICATE_CANDIDATES` first, then
`PHONE_ALREADY_REGISTERED` once acknowledged) rather than one combined
response. If you build anything that reads a duplicate-warning UI's 409
`code` and assumes `INDISTINGUISHABLE_RECORDS` can come from `POST`, it
cannot — verified by reading `src/app/api/admin/patients/route.ts` directly
(2026-08-30), not by relying on this memory or on task-13.md's étape 7 card
text (which describes it as if `POST` had it too).

See `.claude/tasks/task-13.md` étape 4 tour-2 Journal entry for full detail,
including proof methodology (git stash to demonstrate the bug on unfixed
code, then restore).

**Tour 3 follow-up (ortho-security counter-check, 2026-08-29)**: `orderBy:
{ createdAt: "desc" }` alone has no tiebreaker. `Patient.createdAt` is
`timestamp(3)` and back-to-back INSERTs commonly tie on the millisecond
(measured locally: 49/59 consecutive pairs tied) — a tied `ORDER BY` then
follows Postgres physical row order, which an `UPDATE` on one of the tied
rows (exactly what `upsertPatient()` does) can silently flip on the next
query. Fixed with `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` — same
tiebreak convention as `src/app/api/admin/audit/route.ts` and
`src/app/api/admin/patients/route.ts`. See [[trap_createdAt_tie_no_tiebreak]].
Also fixed the test fixture itself: two `Patient` rows created back-to-back
in a test with no explicit `createdAt` have ~50% odds of tying, making a
recency-dependent assertion a coin flip — give the earlier one an explicit
`createdAt: new Date(Date.now() - 60_000)`.
