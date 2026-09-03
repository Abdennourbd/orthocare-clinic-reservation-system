# Monitoring — uptime, cron freshness, message failures (Task 23)

## Uptime

- Probe `GET /` (public homepage) + `GET /api/health` (app + DB) every 1–5 min
  from an external checker (UptimeRobot / BetterStack / Vercel Monitoring —
  provider-agnostic, clinic picks one).
- `/api/health` returns 200 `{ok:true,db:"up"}` when Prisma `SELECT 1` succeeds,
  503 `{ok:false,db:"down"}` otherwise. Alert on non-200 or >10s latency.
- Who gets paged: clinic admin + on-call dev (set in the checker, not in code).

## Cron freshness (silence ≠ health)

Sentry catches errors, not silence. A cron that stops running produces no
errors at all — so alert on *absence of success*:

| Job (UTC schedule) | Local (Africa/Algiers) | Freshness alert |
|---|---|---|
| `/api/cron/reminders` `0 8 * * *` | 09:00 | no success in 25h |
| `/api/cron/no-show-followup` `0 17 * * *` | 18:00 | no success in 25h |
| `/api/cron/expire-pending` `0 2 * * *` | 03:00 | no success in 25h |
| `/api/cron/cleanup` `0 3 * * *` | 04:00 | no success in 48h |

Implementation: Vercel Cron logs + Sentry Cron Monitors (or the uptime
checker's heartbeat feature). Each route already authenticates with
`CRON_SECRET` (`Authorization: Bearer` or `x-cron-secret`) and is idempotent.

## Message-send failures

- All sends go through `sendMessage()` → provider. Failures are returned (never
  thrown) and logged as PII-free `message_send_failed`.
- Volume tripwire: `checkMessageVolume()` (Task 22, `src/lib/messaging/monitoring.ts`)
  flags >200 msgs/hour — alert on trip + on any hour with >5% FAILED rate.
- Cost context: see `docs/messaging-production.md` (Twilio ~$0.27/segment DZ,
  WhatsApp ~$0.01–0.02/msg). An alert without cost context gets ignored.

## Sentry

- DSN via `SENTRY_DSN` (server/edge) + `NEXT_PUBLIC_SENTRY_DSN` (client, same value).
- `sendDefaultPii: false` everywhere; `beforeSend` strips request bodies,
  masks `/appointment/<token>` → `[REDACTED]`, redacts patient keys.
- Verify after deploy: trigger a test error containing a fake name + token URL,
  confirm both are scrubbed in the Sentry UI before going live.
