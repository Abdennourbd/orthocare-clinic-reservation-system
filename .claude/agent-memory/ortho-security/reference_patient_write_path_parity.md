---
name: reference-patient-write-path-parity
description: Audit method — diff every new Patient write path against the reference public write path (appointments route + upsertPatient), field by field, before judging it complete
metadata:
  type: reference
---

The reference write path for `Patient` is `src/app/api/appointments/route.ts`
(consent gate + payload assembly) feeding `upsertPatient()` in
`src/lib/booking/createBooking.ts`. Read both before auditing any new route
that creates or updates a `Patient`, and compare column by column.

Three properties live there and nowhere else — a new write path inherits none
of them automatically:

- **Consent provenance.** The public path stamps `consentAt` + `consentVersion`
  and refuses a stale consent version. `Patient.consentAt` is nullable, so a
  path that omits it produces a record with no consent trace; the messaging
  suppression check (`src/lib/messaging/index.ts`) reads only
  `messagingOptOut` (default `false`), so it will not catch the omission.
- **Phone identity.** `upsertPatient()` resolves a booking by
  `findFirst({ where: { phoneE164 }, orderBy: { createdAt: "desc" } })` and
  then **overwrites** `firstName`/`lastName`/`phone`/consent/locale on the row
  it finds. `Patient.phoneE164` is indexed but **not unique**
  (`prisma/schema.prisma`). Any path that can produce two rows sharing a
  `phoneE164` therefore changes the meaning of every later booking with that
  number. Families sharing one phone make this an ordinary case, not an edge.
- **E.164 gate.** See [[guard-phone-e164-gate]].

How to apply: for each `patient.create`/`patient.update` in the diff, list the
columns written, then list the columns the reference path writes, and name every
difference out loud in the report — including the ones the step card never
mentioned. Related: [[invariant-minimum-disclosure-read-vs-return]].
