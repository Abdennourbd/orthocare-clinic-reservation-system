# Messaging production runbook (Task 22)

Real-provider wiring for Twilio SMS + WhatsApp Business (Meta Cloud API,
direct — no BSP markup). Code: `src/lib/messaging/` (`config.ts`,
`twilio.ts`, `whatsapp.ts`, `hybrid.ts`, `monitoring.ts`, dispatcher
`index.ts`).

## Channel strategy

`MESSAGE_PROVIDER=whatsapp-first` (production default): try WhatsApp, fall
back to Twilio SMS on any WhatsApp failure (not delivered ⇒ the SMS *is*
the delivery, not a duplicate). `SmsMessage.provider` records the channel
actually used (`whatsapp` | `twilio`), so WhatsApp coverage and per-message
cost stay measurable. `twilio` / `whatsapp` remain as single-channel escape
hatches; `mock` is dev/staging/test.

## Cost (DZ numbers, confirmed estimates)

| Channel | Price | Notes |
|---|---|---|
| Twilio SMS | ~$0.27 / segment | Alphanumeric sender ID required (numeric IDs fail on Mobilis). French reminders ≈ 1 segment; Arabic (UCS-2) ≈ 70 chars/segment — see `smsSegments()`. |
| WhatsApp Business API | ~$0.01–0.02 / message | Per-message billing since Jul 2025; service messages chargeable from Oct 1 2026. |

At ~600–800 msgs/month the hybrid costs ~$30–40/mo vs ~$200+/mo all-SMS
(~6–7× less). Verify the first invoice against `SmsMessage` counts grouped
by `provider` + `status = SENT`.

## Staging verification (required before production switch)

Staging has its own DB + mock messaging by default. To verify real sends:

1. In staging env set `MESSAGE_PROVIDER=whatsapp-first` plus the Twilio
   and WhatsApp credentials (never commit them; `TWILIO_*` /
   `WHATSAPP_*` are read from env only).
2. Book a test appointment with a real DZ test number (synthetic patient,
   e.g. firstName `Test`).
3. Confirm via the dashboard → expect: confirmation SMS/WhatsApp received,
   `SmsMessage` row with the real `provider` + `status = SENT`.
4. Trigger each cron with `x-cron-secret` (`reminders`, `no-show-followup`,
   `expire-pending`) → messages arrive via the real provider; run each
   twice → exactly one message (idempotency unchanged).
5. Set `MESSAGE_PROVIDER` back to `mock` when done (staging must not keep
   billing credentials hot).

Cron routes need no code change: they all go through `sendMessage()` →
`getProvider()`, so the env swap is the whole switch.

## Volume / failure alerting

- In-code tripwire: `checkMessageVolume()` (default 200 msgs/hour —
  ~600–800/mo ≈ 30/day, so 200/hr is a spike). Wire it into a periodic
  check or call it from the SMS-center broadcast path.
- Failure signal: the dispatcher logs `{"event":"message_send_failed",
  "provider","code","type"}` (no PII) on every FAILED send. Alert on a
  spike of this event or of `SmsMessage` rows with `status = FAILED`.
- Silence signal (Sentry catches errors, not silence): the existing
  external uptime check on `/api/health` plus a "cron stopped reporting"
  alert cover a reminder job that quietly stops running.

Runbook for the alert: query `SmsMessage` for the last hour grouped by
`provider, status`; a FAILED spike names the channel (`code` on the row's
`error` prefix distinguishes config vs provider vs network). First fix:
re-check the channel credentials in env (a rotated token is the common
cause); the retry-on-FAILED path in the dispatcher re-attempts automatically
on the next call for the same `(appointmentId, type)`.

## WhatsApp template approval — DECISION

**Status: deferred — launch SMS-capable, WhatsApp template pending.**
Meta requires documented patient opt-in (already captured: `Patient`
`whatsappOptIn` + `preferredLocale`, Task 7) AND pre-approved message
templates for business-initiated messages. Template submission has review
lead time, so:

- The provider ships with the `WHATSAPP_TEMPLATE_NAME` /
  `WHATSAPP_TEMPLATE_LANG` seam: set them once Meta approves the
  templates and business-initiated sends use them automatically; until
  then it sends free text (works in the sandbox / 24h window) and falls
  back to SMS otherwise.
- Submit the 9 message templates (`DEFAULT_MESSAGE_TEMPLATES` keys) for
  approval early — it is a calendar dependency, not a coding one.
- Launch order if approval is still pending: `MESSAGE_PROVIDER=twilio`,
  then flip to `whatsapp-first` once approved. No code change either way.
