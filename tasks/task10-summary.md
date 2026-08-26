# Task 10 — Google Reviews embed + location map

Delivered per `tasks/todo.md` Task 10 and `tasks/plan.md` (§Google Reviews,
§Google Maps / location). Free no-key Google embeds — no API key, no cost.
The clinic's live listing: **Ortho'Care Clinic, 10 rue Larbi Abdelsalem,
Rouiba, Alger** (36.7351871, 3.2836918; place id
`0x128e5b9de26cb8dd:0xb0b176111c5df02c`), Sat–Thu 10:00–17:00.

## What was delivered

### Reusable components (`src/components/public/`)

- `GoogleReviews.tsx` — the reviews widget: the free Google "place card"
  iframe (`google.com/maps/embed?pb=…`) rendering the **live rating card**
  (place name, rating, review count) + a visible "See all reviews on Google"
  fallback link so the section stays useful if the iframe is blocked. Server
  component, locale-aware, `loading="lazy"`, `referrerPolicy="no-referrer"`.
- `ClinicMap.tsx` — the location map iframe (`google.com/maps?q=lat,lng…output=embed`),
  locale-aware, lazy, titled.
- `DirectionsButton.tsx` — one-click "Open in Google Maps" link
  (`google.com/maps/dir/?api=1&destination=…`), `target=_blank` +
  `rel=noopener noreferrer`.
- `ReviewsSection.tsx` + `LocationSection.tsx` — composed home-page sections
  (address, phone, hours, map, directions, reviews). Task 11's contact page
  reuses `ClinicMap` / `GoogleReviews` / `DirectionsButton` / `LocationSection`.

### Home page + footer

- `[locale]/page.tsx` — Hero → Reviews section → Location section.
- `Footer.tsx` — location strip in the contact column: real address, phone
  (`dir="ltr"` for the +213 number in RTL), hours, directions button (text +
  button only — no third map iframe in the footer, keeping the page payload
  down).

### Embed URL builders (`src/lib/maps/embed.ts`)

Pure functions, unit-tested: `buildReviewsEmbedSrc(locale)`,
`buildMapEmbedSrc(locale)`, `buildDirectionsUrl()`, `buildPlaceUrl()`.
The pb-string construction encodes the place name apostrophe as `%27` and
maps locale → Google `hl` (`fr/ar/en`) with region `dz`.

### Clinic data

- `src/lib/settings/clinicLocation.ts` — **static** config for the embeds
  (name, real address, phone, lat/lng, place id). Deliberately NOT the
  admin-editable `clinicInfo` Setting: reading the Setting in the shared
  layout/footer would force-dynamic every page. Task 21 can migrate these
  into the Setting.
- `src/lib/settings/clinicInfo.ts` defaults + `prisma/seed.ts` — updated the
  placeholder address/phone to the clinic's real ones (also fixes the token
  page + SMS `{phone}` display).

### Security

- `src/lib/security/headers.ts` — `SECURITY_HEADERS` CSP gains
  `frame-src https://www.google.com https://maps.google.com` **only**. The
  parent's `script-src`/`img-src`/`connect-src` don't govern the cross-origin
  iframe's internals, so they stay strict. `NO_REFERRER_HEADERS` (token
  pages) is byte-identical — it must never gain Google domains.
- `src/lib/security/headers.test.ts` — regression test: global CSP allows the
  Google frames, token CSP contains **no** Google domain and still sends
  `Referrer-Policy: no-referrer`.

### i18n

- `Reviews` + `Location` namespaces and `Footer.hours` in `en/fr/ar.json`;
  removed the now-unused `Footer.address` key.

## Verification

- `npm test` → **243 passing** (28 files; +12 from the new embed + CSP unit
  tests).
- `npm run typecheck`, `npm run lint`, `npm run build` — clean. The home page
  stays **SSG** (`● /fr /ar /en`), the token page stays dynamic (`ƒ`).
- **Browser-tested** (production build) on `/fr`, `/ar`, `/en`: both embeds
  render, the reviews widget displays the live card — place name, rating
  (4.7★), review count (40), "Open in Maps" — locale-aware in all three; the
  footer strip shows address/phone/hours/directions.
- **Token-page isolation:** loaded `/fr/appointment/dummy-token` — network
  log shows **zero Google requests** (only self-hosted chunks + the
  self-service API); response headers confirm `Referrer-Policy: no-referrer`
  and a Google-free CSP.
- CSP on public pages confirmed in response headers (`frame-src` present).

## Decisions / deviations (recorded per plan.md practice)

1. **Free embed chosen (plan.md Open Question resolved).** The no-key embed
   renders the **live rating card**, not the individual review list, so the
   "4★+ filter" is N/A — there's nothing to filter. The Places-API 4★+ list
   remains a tracked future option in plan.md Open Questions.
2. **Mounting: home page + footer strip**, not the contact page (which is
   Task 11). The components are the reusable seam Task 11's contact page
   builds on.
3. **Map/location data kept static, not DB-backed**, so the shared layout and
   home page stay statically renderable (build confirms `●` SSG for all three
   locales). Task 21 migrates to the Setting when admin editing exists.
4. **Privacy-notice disclosure deferred to Task 11** (the privacy page is a
   Task 11 deliverable); the reviews/map iframes are already flagged in
   `plan.md` as a Google data flow and the booking consent links to `/privacy`
   (currently 404, built in Task 11).

## Notes / deferred

- The `?_rsc=` 404s seen in the browser are Next.js prefetches for the
  `/services`, `/contact`, … nav links — those pages are Task 11 (pre-existing
  behavior, not a regression).
- If the clinic later wants a filtered 4★+ review list, the documented path is
  the Google Places API (key + billing) with server-side caching — tracked in
  `plan.md` Open Questions.

## Post-review fixes (code review of this task)

- **CSP narrowed to `frame-src` only.** The review flagged that the plan's
  wording ("extend script-src/img-src") would have widened the policy without
  enabling the iframe; the implementation adds only `frame-src`, keeping
  `script-src`/`img-src`/`connect-src` strict.
- **Location data kept static** (review finding 1) — the design originally
  read `clinicInfo` in the shared components; it now uses a static config
  module, and the build confirms the home page is still statically rendered.
- **Real clinic data applied** (review finding 2) — defaults + seed updated
  from the maps link + clinic site.
- **Plan corrected** (review finding 3) — "free embed shows all reviews" was
  factually wrong; recorded the real behavior + decision.
- **Privacy-disclosure dependency** (review finding 4) — explicitly deferred
  to Task 11 and tracked rather than silently dropped.
- **New tests:** `headers.test.ts` (token-page CSP isolation), `embed.test.ts`
  (URL builders). Suite went from 231 → 243.

## Post-review polish (review suggestions applied)

- **Single source of truth for clinic identity.** Extracted dependency-free
  `src/lib/settings/clinicIdentity.ts` (`CLINIC_IDENTITY`); `clinicInfo.ts`
  defaults, `clinicLocation.ts`, and `prisma/seed.ts` all derive from it — the
  token page (DB Setting) and public site (static config) can no longer drift,
  and the static config never pulls Prisma into a client bundle.
- **Typed locale helper.** `src/lib/i18n/getLocale.ts` (`getAppLocale()`)
  factors out the two `locale as Locale` casts; kept server-only so
  `config.ts` (imported by the client `LocaleSwitcher`) stays client-safe.
- **Honest todo tracking.** The privacy-notice disclosure criterion is now a
  separate unchecked item explicitly deferred to Task 11, instead of a
  checked box with a caveat.
- **Headers test no longer index-based.** `headers.test.ts` resolves rules by
  `source` (`"/(.*)"`, `"/:locale/appointment/:token(.*)"`), so reordering the
  arrays can't silently change what's tested.
- **Responsive reviews widget height.** `h-80 sm:h-96 md:h-[26rem]` instead of
  a single arbitrary `26rem` — the widget no longer overpowers short/mobile
  viewports.

Suite after polish: **243 passing**; typecheck/lint/build clean (home page
still SSG, token page still dynamic). After the Tasks 9 & 10 security pass
(cron auth header fix + opt-out retry re-check, see `task9-summary.md`):
**246 passing**.