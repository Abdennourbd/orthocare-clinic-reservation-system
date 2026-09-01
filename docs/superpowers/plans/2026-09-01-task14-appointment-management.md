# Task 14 — Appointment Management (Admin Core)

## Overview

Day view of appointments; **call queue** (`GET /api/admin/appointments/pending` —
PENDING bookings awaiting a confirmation call, oldest first, showing time left
before auto-expiry); **search by phone or name** (`GET /api/admin/appointments/search`);
confirm-after-call, cancel, reschedule (re-checks availability via Task 5),
mark completed/no-show, manual booking creation (CONFIRMED, blocks slot).

All status changes set the matching timestamp (`confirmedAt`/`cancelledAt`/
`completedAt`/`noShowAt`), call `logAction`, and fire SMS. Cancel/reschedule
route through `releaseSlot()`/`rescheduleSlot()` so the waitlist fires later.
Appointment findable by phone or name in one search.

**Routes:** `GET/POST /api/admin/appointments`, `GET/PATCH .../[id]`,
`POST .../[id]/reschedule`, plus `/pending` and `/search`.

## Acceptance criteria (from tasks/todo.md Task 14)

- [ ] Receptionist changes status; SMS fires + action audited on each change
- [ ] Reschedule re-checks slot availability via `bookSlot`/`rescheduleSlot`
- [ ] Manual booking creates CONFIRMED appointment that blocks its slot
- [ ] Cancel/reschedule route through `releaseSlot()` with the right `cancelReason`
- [ ] Per-status timestamps set correctly
- [ ] Call queue lists PENDING oldest-first with time remaining before expiry
- [ ] Appointment findable by phone or name in one search

## Definition of Done (all tasks)

- Code reviewed and merged; lint + typecheck + tests green
- Tests at the right level (unit for pure logic, route-level integration for endpoints)
- `logAction()` called with the right actor on every staff action
- Every added endpoint gets a row in `tests/authz-matrix.test.ts`
- Input validated with a shared Zod schema
- Works in the FR dashboard; keyboard-navigable; accessible

## Global constraints that bind every step (verbatim from repo conventions)

- **Order is load-bearing in every admin handler:** requireStaff -> (CSRF on
  state-changing) -> rate limit -> Zod -> domain checks (404/role gate) -> DB
  write. A 404 must NEVER precede a 401/403.
- **Explicit roles:** use `requireStaff(request, { roles: ["ADMIN","RECEPTIONIST"] })`
  (or ADMIN-only where required), never a bare `requireStaff(request)`.
- **`params` is a Promise** in Next 16 — await it before use.
- **Audit `detail` never carries patient-identifying values** — field names,
  counters, enums, ids only. Never a name, phone, or the search query `q`.
- **Rate-limit keyed on staff session userId**, not IP, for staff reads/writes.
- **Never `...data` spread into Prisma** — name every field (spread leaks
  non-column keys like `duplicateAcknowledged` and can serialize PII in a
  PrismaClientValidationError).
- **Phone normalized to E.164** on write (`normalizePhoneE164`), reject
  422 INVALID_PHONE when it fails.
- **All date maths through `lib/time/clinicTime.ts`** — "today" = clinic's today.
- **Messaging failures never propagate** — a message that fails must not fail
  the status change it accompanies (see `src/lib/messaging/appointmentChanges.ts`).
- **SMS on change uses the existing senders** in `src/lib/messaging/appointmentChanges.ts`:
  `sendAppointmentConfirmation`, `sendAppointmentCancelled`,
  `sendAppointmentRescheduled`.
- **Actor for staff actions is `{ type: STAFF, userId }`** via `logAction`.
- Authorization matrix rows reference the route module's export BY REFERENCE
  (`handler: appointmentsListRoute`), never a wrapper closure.

## Work plan (ordered steps)

1. **Step 1 — Schemas + domain status-transition module.** Zod schemas in
   `src/schemas/appointment.ts`: `appointmentListQuerySchema` (date, status),
   `manualBookingSchema` (patientId, serviceId, startTime ISO, notes?, locale?),
   `appointmentStatusChangeSchema` (action: CONFIRM|CANCEL|COMPLETE|NO_SHOW).
   A pure/lib domain module `src/lib/booking/adminTransitions.ts` with pure
   functions mapping each action -> { newStatus, timestampField, auditAction,
   cancelReason, smsSender } so routes and tests share one source of truth.
2. **Step 2 — Routes.** `/api/admin/appointments/route.ts` (GET day view +
   POST manual booking), `/api/admin/appointments/[id]/route.ts` (GET detail +
   PATCH status change), `/api/admin/appointments/[id]/reschedule/route.ts`
   (POST reschedule), `/api/admin/appointments/pending/route.ts` (GET call
   queue), `/api/admin/appointments/search/route.ts` (GET search by phone/name).
3. **Step 3 — Authz matrix rows** in `tests/authz-matrix.test.ts` for all new
   routes × {anonymous, receptionist, admin, deactivated}.
4. **Step 4 — Route-level integration tests** `tests/integration/appointments-api.test.ts`:
   status transitions (each sets timestamp + audit + SMS), manual booking blocks
   slot, reschedule re-checks availability, cancel via releaseSlot, call queue
   oldest-first with time-remaining, search by phone and by name.
5. **Step 5 — Admin UI screens (FR, frontend-ui-engineering).** Day view
   (`AppointmentDayView`), call queue (`CallQueue`), search, manual booking
   form, appointment actions (confirm/cancel/reschedule/complete/no-show).
   Wire into `/admin/appointments` page + Sidebar nav. Accessible,
   keyboard-navigable, loading/empty/error states.
6. **Step 6 — Full verification:** lint, typecheck, build, full test suite.

## Notes

- Dashboard is FR only. No `[locale]` under /admin.
- Reschedule: use `rescheduleSlot()` (Task 5) with `reason: CancelReason.STAFF`
  and `newStatus: CONFIRMED` (a staff-rescheduled, already-managed appointment
  stays confirmed). Re-check availability is inherent in `bookSlotInTx`.
- Manual booking uses `bookSlot()` with `source: MANUAL`, `status: CONFIRMED`.
- Confirm-after-call: set `confirmedAt` + `confirmedByUserId`, send
  `sendAppointmentConfirmation`, audit `APPOINTMENT_CONFIRMED`.
- Cancel: `releaseSlot(appointmentId, CancelReason.STAFF)`, send
  `sendAppointmentCancelled`, audit `APPOINTMENT_CANCELLED`.
- Complete/no-show: set timestamps directly (no slot change), audit
  `APPOINTMENT_COMPLETED` / `APPOINTMENT_NO_SHOW`. No SMS for these (not in
  existing senders).
