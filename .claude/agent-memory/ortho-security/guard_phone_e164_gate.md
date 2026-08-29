---
name: guard-phone-e164-gate
description: The 422 INVALID_PHONE gate in the public booking route is what keeps Patient.phoneE164 trustworthy; any new patient-write path must mirror it
metadata:
  type: project
---

`src/app/api/appointments/route.ts` rejects a phone that `normalizePhoneE164()`
cannot parse with **422 `INVALID_PHONE`, before any `Patient` row is written**.
That route-level gate — not the Zod schema — is the only thing that makes
`Patient.phoneE164` (a NOT NULL column, `@@index([phoneE164])`) reliably a real
E.164 number.

**Why:** every downstream mechanism keys off `phoneE164`: the per-phone rate
limit, the PENDING cap, `upsertPatient()`'s patient matching
(`src/lib/booking/createBooking.ts`), SMS/WhatsApp delivery, and the Task 13
duplicate engine. The shared Zod shape only checks `phone` length (`min(6)
.max(30)`), so `"!!!!!!"` validates fine — a write path that skips the gate
stores a garbage `phoneE164` and every one of those mechanisms fails *silently*,
including duplicate detection (split patient record = split clinical history).

**How to apply:** when auditing any new route that creates or updates a
`Patient` (admin CRUD, imports, seeds), check for the explicit
`if (!phoneE164) return errorResponse(422, "INVALID_PHONE", …)` before the
write. Its absence is a finding even though nothing "leaks" — it is a
patient-safety defect, not just data quality. See
[[invariant-minimum-disclosure-read-vs-return]] for the companion read-side rule.
