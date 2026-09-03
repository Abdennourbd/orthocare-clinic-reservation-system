# Task 23 — SEO, performance, Sentry, handoff (deployment excluded)

Done per `tasks/todo.md` Task 23, minus the Vercel deploy (skipped per owner request).
Full suite: **81 files / 1009 tests green**, typecheck + lint + `next build` clean.
Browser-verified on dev: hreflang/canonical/JSON-LD in 3 locales, sitemap.xml,
robots.txt, legacy redirects, strict token-page headers, mobile menu, zero console errors.
Lighthouse (mobile, navigation): a11y 93, SEO 100, best practices 100; lab LCP 512ms, CLS 0.00.

## What was delivered

### SEO head (`src/lib/seo/`, `src/components/public/LocalBusinessJsonLd.tsx`)
- `canonical.ts` — `siteBaseUrl()` (whitespace-tolerant APP_URL fallback), `getCanonicalUrl()`,
  `getAlternateUrls()` (fr/ar/en + x-default = fr), trailing-slash + locale-prefix normalization.
- `pageMetadata()` — per-page canonical + hreflang + OG/Twitter (incl. `og:image` → `/images/smile.jpg`).
  Every public page (home, services, service detail, book, about, contact, faq, testimonials,
  gallery, privacy) sets its own pathname — the `[locale]` layout sets no canonicals (an earlier
  version stamped every page as `/`; caught by review, fixed).
- `LocalBusinessJsonLd` — `Dentist` schema from `CLINIC_IDENTITY`/`CLINIC_LOCATION` (NAP, geo
  36.7351871/3.2836918, Sat–Thu 10:00–17:00). Inline first-party script — safe on all pages.

### Crawling + migration (`src/app/sitemap.ts`, `src/app/robots.ts`, `next.config.ts`, `src/lib/seo/redirects.ts`)
- Sitemap: all static paths × 3 locales with hreflang alternates; service slugs appended with
  per-row `updatedAt` as `lastModified`; static-only fallback (with `console.warn`) when the DB
  is unreachable at build time.
- Robots: `Allow: /`, disallow `/admin/`, `/api/`, all three `/<locale>/appointment/` prefixes.
- Redirects: old site audited live (`/page-sitemap.xml` = exactly 2 URLs: `/`, `/privacy-policy/`;
  rest are anchors) → `/privacy-policy` variants 301/308 to `/fr/privacy`. Note: Next.js
  `permanent: true` emits **308**, which Google treats like 301 for ranking transfer.

### Token-page privacy (found by security review, fixed)
- `scrubEvent()` masked `/appointment/<token>` but NOT `/api/appointments/<token>` (plural),
  never touched `spans`, and only redacted patient keys in extra/contexts/user — breadcrumbs,
  exception values and `message` leaked names. Fixed: plural-aware regex, spans + breadcrumbs +
  exception + message scrubbed, keys extended (token, name, address, dob…), case-insensitive
  header redaction, `query_string`/`cookies` covered, throw-proof clone (circular/BigInt).
- Removed misleading `denyUrls` (matched chunk filenames, not page URLs — false confidence).
- Token pages: `X-Robots-Tag: noindex, nofollow` header + `<meta robots noindex>` (robots.txt
  Disallow alone doesn't prevent indexing of discovered URLs). Known framework behavior: Next.js
  auto-emits hreflang `Link` response headers for `[locale]` routes (incl. token URLs) — harmless
  under noindex; documented in `headers.ts`.

### Sentry (`sentry.{client,server,edge}.config.ts`, `@sentry/nextjs`)
- `sendDefaultPii: false`, `tracesSampleRate: 0.1`, shared `beforeSend: scrubEvent`.
  Wrapped in `next.config.ts` only when a DSN is set — local builds stay green without one.
- `.env.example`: `SENTRY_DSN` (+ `NEXT_PUBLIC_SENTRY_DSN` note for client).

### Docs (`docs/`)
- `monitoring.md` — uptime (`/` + `/api/health`), cron-freshness table (alert on silence, 25h),
  message-failure tripwire + cost context, Sentry verify step.
- `restore-drill.md` — PITR to throwaway branch + blob check, sign-off table.
- `cutover.md` — TTL lowering, staging checklist, DNS switch, old site parked, rollback via
  day-sheet export + DNS revert, sitemap resubmit.
- `handoff.md` — login/roles, call queue + day sheet, content/closures, SMS provider + costs,
  "site is down" runbook, retention table + processor list (Law 18-07 note), contacts.

### UI polish (review loop, frontend focus)
- **Mobile nav**: header had no menu under 768px (Services/FAQ/About unreachable). Added client
  disclosure menu (aria-expanded, Escape-to-close with focus return, RTL-safe full-width panel,
  book CTA inside) + `menu`/`close` keys in fr/ar/en. Verified at 390px: opens, all links work.
- **Marquee**: testimonial loop now pauses on hover/focus (WCAG 2.2.2), keeps reduced-motion stop.
- **Focus rings**: teal `focus-visible` rings on logo, book CTA, all nav links.
- **ServicesPreview**: renders `null` when empty (was a hollow section with a dead link).

## Verification
- `npm test` 1009/1009 (incl. 9 new: canonical 7, scrub 7, routes 3) · typecheck · lint · build clean.
- Browser: /fr+/ar(RTL)+/en canonical/hreflang/OG/JSON-LD; /fr/services canonical; sitemap (hreflang
  alternates per entry); robots; `/privacy-policy` → 308 `/fr/privacy` (chain → 200);
  token page: strict CSP (no Google frame-src), `no-referrer`, `noindex` header + meta, zero
  third-party scripts; booking wizard keyboard-focusable buttons; mobile menu open/close;
  zero console errors throughout.

## Decisions / deviations
1. **308, not 301** — Next.js permanent redirects emit 308; SEO-equivalent, documented in
   `redirects.ts` + `cutover.md` so nobody "fixes" it on launch day.
2. **No catch-all fallback redirect** — unknown legacy paths 404 (only 2 old URLs exist; a
   `/:path* → /fr` rule would mask real 404s).
3. **`og:image` reuses `/images/smile.jpg`** — no new design asset; replace with a 1200×630
   branded card before launch if wanted.
4. **Gallery keeps `<img loading=lazy>`** — remote/admin-uploaded URLs with unknown dimensions;
   `next/image` would need remotePatterns + fixed sizes for little gain here.
5. **JSON-LD opening hours are static marketing data** — if admin edits hours in settings, the
   schema needs a manual sync (noted in code review; acceptable for v1).

## Operator steps pending (need prod/staging access — not doable from here)
- Set prod env (`APP_URL`, `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`, `CRON_SECRET`, …) + deploy.
- Run the restore drill once, sign `docs/restore-drill.md`.
- Sentry live check: trigger error with fake name + token URL, confirm scrubbed in UI.
- Submit `/sitemap.xml` per locale in Search Console; spot-check 301s + headers on the live domain.
- Confirm JSON-LD NAP matches the Google Business Profile exactly; owner reviews handoff docs.
- Optional follow-ups logged by reviewers: per-chair `resourceId` (already a seam), WhatsApp
  template approval (Task 22 deferral), branded OG card, conditional Arabic-font loading,
  RTL mirroring nits (hero floaters, marquee direction), day-picker 320px overflow check.

## Post-review fixes applied
- APP_URL `""` fallback (was emitting relative canonicals + crashing `new URL("")`).
- Layout-wide `/` canonical removed → per-page `pageMetadata()` everywhere.
- Sitemap `lastModified: now` → per-service `updatedAt`.
- Scrubber: plural API path, spans, free-text PII, header case, query/cookies, throw-proofing.
- Tests strengthened (trailing-slash APP_URL, double-prefix, empty APP_URL, exception tokens,
  contexts/nested, circular input, robots/redirects lock-in).
