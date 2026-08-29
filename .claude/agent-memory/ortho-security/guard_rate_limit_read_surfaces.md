---
name: guard-rate-limit-read-surfaces
description: This repo already throttles a read route (/api/slots, 120/min) — so "reads are not rate-limited here" is never a valid precedent; check every new list/search route for a limiter and a page-size cap
metadata:
  type: reference
---

`checkRateLimit()` (`src/lib/security/rateLimit.ts`, Postgres fixed window) is
called from the public booking, self-service, login and slots routes. Two call
sites decide the shape of any new one:

- `src/app/api/slots/route.ts` — a **read** limited to 120/min. Proof that
  throttling a read is an accepted pattern here, not an innovation.
- `src/app/api/auth/change-password/route.ts` — key `pwchange:${guard.user.id}`.
  Precedent for keying on the **session userId** rather than the IP, which is
  the right key for staff routes: a single-site clinic is behind one public IP,
  so an IP key is either a shared bucket or an internal DoS.

How to apply: when a new authenticated list/search route appears, compute the
harvest cost out loud — `ceil(total_rows / max_page_size)` requests — and check
three things: a limiter keyed on the session, the schema's `limit` ceiling, and
whether the write-side limiter of the same feature can simply be side-stepped by
reading instead. A limiter placed on the narrow channel while the wide one stays
open is worth reporting as such. Related:
[[pattern-unaudited-read-on-rejection-path]].
