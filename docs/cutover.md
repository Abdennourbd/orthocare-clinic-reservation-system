# Launch cutover plan (Task 23)

## Pre-cutover (24h before)

1. Lower DNS TTL to 300s (5 min) so rollback is fast.
2. Verify staging: full booking → confirm → reminder cron → self-service cancel
   against staging DB + mock provider.
3. Confirm `APP_URL=https://<prod-domain>`, `SENTRY_DSN`, `CRON_SECRET`,
   `SESSION_SECRET`, messaging + Blob env vars set in Vercel production env.
4. Verify 301s: `curl -I https://<prod-domain>/privacy-policy/` → 301 to `/fr/privacy`.
   Full mapping audited in `src/lib/seo/redirects.ts` (old WordPress site had 2
   indexed URLs: `/` and `/privacy-policy/`; anchor sections need no redirect).
5. Submit per-locale sitemaps: `https://<prod-domain>/sitemap.xml` in Google
   Search Console (contains /fr, /ar, /en variants with hreflang alternates).

## Cutover

1. Switch DNS A/CNAME to Vercel (or add domain in Vercel → verify).
2. Keep the old WordPress site reachable on a parked subdomain
   (e.g. `old.clinicorthocare.com`) until verified — do not delete it day one.
3. Verify live: homepage in 3 locales, booking wizard, `/api/health` 200,
   security headers (`curl -I`: CSP, HSTS, frame-ancestors, Referrer-Policy, nosniff),
   JSON-LD present, hreflang + canonical in view-source.
4. Trigger each cron manually once with `x-cron-secret`, confirm idempotent success.

## Rollback

- Revert DNS to the old site (TTL 300s → traffic flips back in minutes).
- New bookings made during the window exist only in the new DB — export the
  day sheet (`/api/admin/exports/day-sheet?date=`) before rollback and re-enter
  or reconcile manually. This is why the day-sheet paper fallback exists.

## Post-cutover

- Resubmit sitemaps, request re-index of `/` in Search Console.
- Monitor Sentry + uptime + cron freshness for 48h (see `docs/monitoring.md`).
- Raise DNS TTL back to 3600s+ after 72h stable.
