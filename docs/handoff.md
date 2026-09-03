# Handoff guide — Ortho'Care Clinic owner (Task 23)

## Logging in

- Dashboard: `https://<prod-domain>/admin/login` (French only, by design).
- Accounts are created by an admin in Team management — there is no public
  "forgot password". If you forget yours, another admin issues a one-time reset;
  you must set a new password at next login.
- Roles: ADMIN sees everything (team, settings, exports, audit). RECEPTIONIST
  handles daily scheduling (day view, call queue, patients, SMS single sends).

## Daily work

- **Call queue** (`/admin/appointments/pending`): online bookings awaiting your
  confirmation call, oldest first with time left before auto-expiry (24h default).
  Call, then Confirm — the patient gets a confirmation SMS with a self-service link.
- **Day view**: today's schedule. Confirm / complete / no-show / cancel / reschedule.
- **Search**: find an appointment by patient phone or name when they call.
- **Day sheet** (`/admin/exports/day-sheet?date=`): print this every morning. If the
  site is unreachable during clinic hours, the paper copy is the appointment book.

## Content editing

- Services (incl. durations — they change the booking slots), gallery,
  testimonials, FAQ: `/admin/content`. Changes appear on the public site within
  the hour (ISR) or immediately after the cache tag revalidates.
- Working hours, slot granularity, buffer, lunch break, booking policy
  (lead time 2h, horizon 90 days, PENDING expiry 24h), message templates:
  `/admin/settings` (ADMIN only).
- **Closures** (`/admin/closures`): holidays, Eid, vacation, emergency closures.
  Adding a closure that covers booked appointments shows the affected list — choose
  bulk cancel-and-notify or reschedule. Appointments are never dropped silently.

## SMS

- Single SMS to a patient + broadcast to a day's appointments (delay template:
  "delayed by X min"). Broadcasts show a preview with recipient count and need an
  idempotency key — double-clicking sends once.
- Provider: `MESSAGE_PROVIDER=whatsapp-first` (WhatsApp, SMS fallback) once
  WhatsApp templates are approved; until then `twilio` (SMS-only). Costs:
  Twilio SMS to DZ ~$0.27/segment, WhatsApp ~$0.01–0.02/msg (see
  `docs/messaging-production.md`). Unusual volume alerts fire above 200 msgs/hour.
- Every non-essential message carries an opt-out; patients with `messagingOptOut`
  never get waitlist/delay/follow-up messages (booking confirmations always send).

## If the site is down

1. Use the printed day sheet for today's appointments.
2. Check `https://<prod-domain>/api/health` — 200 = app+DB up, 503 = DB down.
3. Contact the developer with: time, what you clicked, screenshot, and whether
   `/api/health` loads. Do not paste patient phone numbers into chat.
4. Uptime + cron-freshness alerts go to the contacts in `docs/monitoring.md`.

## Your data: retention + processors

| Data | Kept | Then |
|---|---|---|
| Appointments + patient profiles | as long as needed for care + legal obligations | anonymized on request (`anonymizedAt`, appointment shell kept for stats) |
| Visit notes / documents | same as above | scrubbed on erasure (ADMIN-only, audited) |
| SMS bodies (`SmsMessage`) | operational history | neutralized on patient erasure |
| Audit log | append-only, never deleted by the app | retention per legal advice |
| Sentry error events | 30–90 days (Sentry default) | auto-expire; never contain patient names (scrubbed) |

Processors (all outside Algeria — disclosed in the privacy notice):
hosting (Vercel), database (hosted Postgres/Neon), messaging (Twilio, Meta/WhatsApp),
error monitoring (Sentry), embeds (Google Reviews/Maps). Whether a formal
declaration under Algeria's Law 18-07 is required is a paperwork question for the
clinic — settle before go-live.

## Contacts

- Developer: _fill in_
- Hosting (Vercel): _fill in team/project_
- SMS (Twilio): _fill in SID owner_
- Domain registrar: _fill in_
