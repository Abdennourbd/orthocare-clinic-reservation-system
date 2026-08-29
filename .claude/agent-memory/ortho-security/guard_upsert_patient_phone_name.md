---
name: guard-upsert-patient-phone-name
description: The public booking path resolves a Patient on phoneE164 AND normalized name — this is the only guard against mixing two family members' health records
metadata:
  type: project
---

`upsertPatient()` (`src/lib/booking/createBooking.ts`) resolves an existing
Patient on `phoneE164` **plus** `normalizeName(firstName)`/`normalizeName(lastName)`
(imported from `@/lib/patients/duplicates`), never on the phone alone.

**Why:** `Patient.phoneE164` is indexed but deliberately NOT `@unique` — Algerian
families legitimately share one phone. Resolving on phone alone made a public
booking overwrite `firstName`/`lastName`/`consentAt`/… of whichever shared-phone
record was created most recently, relabelling one family member's clinical
history with another's name, unaudited. Forbidding phone sharing was explicitly
rejected by the user (2026-08-29, "option B").

**How to apply:** any future change to the public booking write path, to
`normalizeName`, or to the admin patient create/update path must preserve two
properties: (a) an unrecognized name on a known shared phone **creates** a record,
never updates a stranger's; (b) `active` is never forced back to `true` by a
public booking (that would silently undo an ADMIN soft-delete). Both are covered
by tests in `tests/integration/create-booking.test.ts`. Related:
[[reference-patient-write-path-parity]], [[boundaries-normalize-name-coverage]],
[[trap-createdat-tie-ordering]].
