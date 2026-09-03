# Task 22 — Twilio + WhatsApp provider wiring

**Status:** ✅ Complete (TDD: failing tests first → minimal implementation, verified end-to-end)

**Skills used:** `api-and-interface-design` (contract-first, additive-only
interface changes, boundary validation, untrusted third-party responses),
`security-and-hardening` (threat model → controls, no secrets/PII in errors
or logs), `test-driven-development` (RED verified before GREEN),
`observability-and-instrumentation` (on-call questions → signals → runbook).

## What was delivered

### Real providers (no SDK, one HTTPS call each — smaller supply chain)

- **`src/lib/messaging/config.ts`** (NEW) — credential boundary. `getTwilioConfig()` / `getWhatsAppConfig()` validate env at the edge; Vercel `[SENSITIVE]` placeholders rejected as missing; errors name the variable, never its value. Providers take injected config — no `process.env` inside `send()`.
- **`src/lib/messaging/twilio.ts`** (real) — `POST …/Accounts/{SID}/Messages.json`, Basic auth, form-encoded `{To, From, Body}`. E.164 guard, 10s timeout, `{sid}` response validation, `21211`-style error detail (capped, secret-free).
- **`src/lib/messaging/whatsapp.ts`** (real) — `POST graph.facebook.com/v21.0/{phone-number-id}/messages`, Bearer. Template seam: `WHATSAPP_TEMPLATE_NAME`/`_LANG` set → template message with the body as parameter; unset → free text (sandbox / 24h window). `NOT_ON_WHATSAPP` tagged via codes 131026/131030/133010 + message fallback.
- **`src/lib/messaging/hybrid.ts`** (NEW) — `WhatsAppFirstProvider` (`MESSAGE_PROVIDER=whatsapp-first`, the production default): try WhatsApp, fall back to SMS on any WhatsApp failure; result carries the actual channel.
- **`src/lib/messaging/monitoring.ts`** (NEW) — `MESSAGE_COSTS_USD`, `smsSegments()` (GSM-7/UCS-2 aware — Arabic ≈ 70 chars/segment), `estimateCostUsd()`, `checkMessageVolume()` (200/hr tripwire).
- **`provider.ts`** (additive only) — `MessageProviderName += "whatsapp-first"`; `SendMessageResult += {code?, provider?}` (actual channel).
- **`index.ts`** (dispatcher) — selects `whatsapp-first` (+ aliases); persists `result.provider ?? provider.name` on initial + retry sends so `SmsMessage.provider` records reality; PII-free `message_send_failed` structured log on failures. Opt-out/idempotency/row-lifecycle untouched.
- **Cron routes need no code change** — all go through `sendMessage()` → `getProvider()`; the env swap is the whole switch (verified by reading the routes).

### Docs & config

- **`.env.example`** — `whatsapp-first` documented as production default, alphanumeric-sender-ID note, `WHATSAPP_TEMPLATE_NAME`/`_LANG` seam.
- **`docs/messaging-production.md`** (NEW) — cost table, staging verification runbook (5 steps), volume/failure/silence alerting + alert runbook, WhatsApp-template decision: **deferred — launch SMS-capable (`twilio`), flip to `whatsapp-first` on approval, no code change**.
- **`tasks/plan.md`** §Messaging — Task 22 wiring paragraph appended.

## Verification

```
npm test          → 78 files, 992/992 green (964 baseline + 28 new)
npm run typecheck → OK
npm run lint      → OK (0 errors, 0 warnings)
npm run build     → OK
```

New tests (all watched FAIL before implementation): `config` (7), `twilio` (5, stubbed fetch), `whatsapp` (5), `hybrid` (4), `monitoring` (6), +1 `getProvider` hybrid case. Existing suites untouched and green — incl. the `MESSAGE_PROVIDER=twilio → FAILED` integration test (placeholder env still fails loudly, as designed) and cron idempotency.

## Not done here (operator steps, tracked in the runbook)

- Real-send staging verification (steps 1–5 in the runbook) — needs live Twilio/Meta credentials; this environment holds only `[SENSITIVE]` placeholders.
- WhatsApp template submission/approval — calendar dependency; the code seam is ready.
- First-invoice cost reconciliation against `SmsMessage` provider/status counts.
