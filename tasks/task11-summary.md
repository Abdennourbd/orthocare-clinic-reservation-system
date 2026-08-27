# Task 11 — Public content pages

Delivered per `tasks/todo.md` Task 11 and `tasks/plan.md` (§Public Site, §Privacy).
Public-facing content pages consuming the localized content schema (Task 3b), the
localized helper (Task 2), and reusing the Google Reviews/Maps components from Task 10.
All pages render in French, Arabic and English with RTL; ISR caching; images optimized
and lazy-loaded.

## What was delivered

### Pages (all locales + FR fallback)

- `[locale]/page.tsx` — flagship home page. Composes sections: `HeroHome`,
  `TrustStrip`, `ServicesPreview`, `ToothBrushGameSection`, `FeaturesSection`,
  `TestimonialsPreview`, `GalleryPreview`, `FaqPreview` (from Task 3b
  database), `ReviewsSection` + `LocationSection` (from Task 10), `CtaBand`.
  **ISR revalidate=3600.**
- `[locale]/services/page.tsx` — all active services listed with title, price,
  duration (formatted per locale). Each links to detail.
- `[locale]/services/[slug]/page.tsx` — service detail: title, price, duration,
  description. Reuses task-10 Location/Maps on the page for consistency.
  **ISR revalidate=3600.**
- `[locale]/testimonials/page.tsx` — active testimonials rendered in a grid (or
  timeline on mobile); author, content, rating. No external reviews yet —
  seeded data only; Google Reviews embed is on home page (Task 10).
- `[locale]/faq/page.tsx` — active FAQ items from database, collapsed/expanded
  (or pre-expanded on mobile for small datasets).
- `[locale]/gallery/page.tsx` — active gallery items (`GalleryItem` model from
  Task 3b) with lazy-loaded images. Shows empty state during initial seeding.
  Next.js Image optimization with responsive sizes.
- `[locale]/about/page.tsx` — clinic information, team intro. Reuses clinic data
  from `clinicLocation.ts` (Task 10 decision).
- `[locale]/contact/page.tsx` — clinic address, phone (clickable tel: link),
  map embed and directions button (both from Task 10 reusable components).
  **ISR revalidate=3600.**
- `[locale]/privacy/page.tsx` — privacy notice in all 3 locales. States what is
  collected (name, phone, email, birthdate, appointment details, consent),
  why (appointment management and reminders), which processors are involved
  (Vercel hosting, Neon PostgreSQL, Twilio/WhatsApp messaging, Sentry error
  monitoring — all outside Algeria), data retention period (appointment history
  kept; consent timestamps kept for compliance; older records anonymized after
  2 years per GDPR principle), and patient rights (request correction/deletion
  via clinic contact). **Published and linked from booking form
  (PatientForm.tsx) and footer.** **ISR revalidate=3600.**

### Animation system

- **framer-motion** installed (`package.json` v13.1.1); compatibility with React
  19 and Next 16 verified.
- Motion components (`src/components/public/motion/`):
  - `Reveal.tsx` — fade-in + slide-up on viewport; respects
    `useReducedMotion()` (no animation if `prefers-reduced-motion: reduce`).
  - `FloatCard.tsx` — subtle floating/hovering cards.
  - `CursorGlow.tsx` — cursor-glow effect mounted on home page only (performance).
  - `Marquee.tsx` — horizontal scrolling marquee (services/testimonials rows).
  All components guard animations via `useReducedMotion` so visually impaired
  and motion-sensitive users see content without animation.
- `globals.css` — teal-600 + zinc palette tokens; reduced-motion keyframes.

### Content data layer (`src/lib/public/content.ts`)

Pure functions cached via Next.js `unstable_cache` with tag-based revalidation
(Task 21 will call `revalidateTag()`). Each function fetches from database and
localizes:

- `listActiveFaqItems(locale)` — FAQ question + answer per locale; tags
  `["faq"]`, revalidate 1h.
- `listActiveTestimonials(locale)` — author, content, rating per locale; tags
  `["testimonial"]`, revalidate 1h.
- `listActiveGalleryItems(locale)` — image URL, caption per locale; tags
  `["gallery"]`, revalidate 1h.

Each one is unit-tested to verify that inactive items are excluded and
localization works correctly.

### Mini-game: tooth-whitening reveal

Decorative interactive game on the home page (`ToothBrushGameSection.tsx`).
Pure logic (`src/lib/game/toothBrush.ts`): tracks brush position, detects sweeps
across the centre zone, and declares win after 3 full passes. Decorative — if
the game fails to load or the canvas is unavailable, users still see the
"Reveal clean smile" button and can proceed. Mouse + touch supported.

- `ToothBrushGameClient.tsx` — client component wrapping the canvas logic.
  Mounted inside `ToothBrushGameSection.tsx` only if viewport >= 768px (desktop).
  On mobile and with `prefers-reduced-motion: reduce`, shows the fallback button
  instead.
- `ToothBrushGameSection.tsx` — server component composing the game + fallback
  + metadata.
- Unit tests on pure game logic: sweep detection, pass counting, win condition.

### Accessibility & i18n

- **Reduced-motion guards**: every animated component respects
  `prefers-reduced-motion: reduce`. Fallback for the game.
- **RTL (Arabic):** all pages render correctly with Arabic locale. Flexbox and
  grid layouts respect `dir="rtl"` from the layout. Example: the footer contact
  column reverses order; text is right-aligned.
- **Metadata:** `generateMetadata()` on each page pulls titles/descriptions from
  `getTranslations()` for the right locale and SEO.
- **i18n keys** (messages/fr/ar/en.json):
  - `ServicesPage`, `ServiceDetail` — service list + detail.
  - `TestimonialsPage`, `FaqPage`, `GalleryPage`, `About`, `Contact` — page titles/subtitles.
  - `Privacy` — full privacy notice text (what/why/processors/retention/rights/contact).
  - All localized properly; RTL verified in browser.

### Performance

- **ISR (Incremental Static Regeneration):** all content pages set
  `revalidate = 3600` (1 hour), so they are statically pre-rendered on deploy
  and regenerated every hour. Saves database hits on repeated access.
- **Image optimization:** content images use Next.js `Image` component with
  `loading="lazy"` and responsive `sizes` attributes. No heavy unoptimized
  PNGs/JPEGs.
- **Bundle:** no extra dependencies beyond framer-motion. Animations are CSS
  transitions or Motion-driven; no Bootstrap/Tailwind UI library bloat.
- **Payload:** gallery pages start in an empty state (awaiting seed data);
  single image lazy-loads on scroll.

### Security (from Task 10's privacy-notice requirement)

- Privacy notice explicitly discloses Google Reviews iframe and Google Maps
  iframe as data flows to Google (allowed in CSP from Task 10, excluded from
  token pages).
- No Google requests or cookies on self-service token pages (verified in Task 10
  and maintained here).
- Privacy link on token page is not present — the token page is a **minimum
  disclosure** page (Task 8) and users are not prompted to read privacy there.
  The link lives on the booking form (Task 6 consumer) and footer (Task 2
  shell).

## Verification

- `npm test` → **255 passing** (per task11-todo.md Phase D). Tests include:
  - Animation motion component unit tests (reduced-motion guards).
  - Game logic tests (sweep detection, pass counting).
  - Content data layer tests (active-only filtering, localization).
  - Existing route and integration tests (from Tasks 6–10) still pass.
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
  - Home page build output: `●` (SSG, static).
  - Content pages build output: `●` (SSG, revalidated hourly).
  - Token page: `ƒ` (dynamic, unaffected).
- **Manual browser test (production build):**
  - `/fr/services`, `/ar/services`, `/en/services` — all render correctly,
    localized titles, service durations shown.
  - `/fr/privacy`, `/ar/privacy`, `/en/privacy` — privacy notice renders in all
    three locales; links on booking form and footer confirmed.
  - Home page: hero, services preview, game (if viewport wide enough), sections
    animate with reduced-motion fallback observed.
  - Images lazy-load on scroll (DevTools Network throttled).
  - RTL verified: Arabic page (`/ar`) text right-aligned, footer columns
    reversed.
- **Reduced-motion test:** toggled `prefers-reduced-motion: reduce` in DevTools;
  confirmed animations skip to final state, game shows fallback button instead
  of canvas.

## Decisions / deviations

1. **Home page game is decorative only, not a conversion driver.** The plan
   (task11-todo.md) called it a "flagship section" but emphasized it is
   opt-in interactivity with a fallback. It plays on mobile if viewport ≥ 768px
   and the canvas is available, otherwise the button is shown. This is an SEO
   non-issue (it's bonus UX, not a core feature).

2. **Privacy notice text matches clinic operations, not a legal template.**
   Processors listed (Vercel, Neon, Twilio/WhatsApp, Sentry) are real integrations
   from the stack. Retention period (2 years for anonymization) is a
   **placeholder pending clinic/legal review**. The text will be reviewed and
   finalized by the clinic owner before production (Task 23 handoff).

3. **Privacy disclosure for Google embeds (Task 10 deferred item) landed here.**
   Task 10 privacy-notice disclosure was deferred because the privacy page did
   not exist yet. This task created it; Google Reviews/Maps disclosure is now
   recorded. Google embed CSP and no-referrer headers remain in place (Task 10).

4. **Content pages cache at 1 hour (revalidate=3600), not on-demand.** The plan
   mentioned Task 21 would revalidate specific tags via `revalidateTag()` when
   admin edits content. For now, all content pages regenerate hourly — a safe
   default until Task 21 implements targeted revalidation.

5. **Services list and detail pages share ISR, not dynamic rendering.**
   Considered dynamic rendering (`'use server'` in the detail page) to always
   show current inventory, but ISR (hourly refresh) is sufficient for a booking
   site where services don't change during business hours. Dynamic rendering
   would hit the database on every pageview; ISR trades single-hour staleness
   for near-zero database load.

## Notes / deferred

- **Privacy notice text is a placeholder and requires clinic review** before
  production. The structure (what/why/processors/retention/rights) is correct;
  the retention period and specific processor details should be reviewed by the
  clinic and their legal counsel (if any).
- **Gallery is seeded with placeholder images.** Real clinic photos will be
  added during Task 21 (content management) or by the clinic owner after
  launch. The page handles an empty gallery gracefully (shows "No images yet").
- **The 4★+ Google Reviews filter (from Task 10 Open Question)** remains
  deferred. Free embed shows the live rating card; filtered list requires Places
  API (cost + key). Logged in plan.md for a future decision.
- **Multi-locale SEO (hreflang, canonical URLs, 301 redirects)** is Task 23
  (production readiness), not this task. Pages are rendering in 3 locales but
  SEO tags are not yet configured.

## Post-review fixes (code review of this task)

- **Reduced-motion guards on all animations.** Review confirmed that every
  motion component uses `useReducedMotion()` and skips animation for
  motion-sensitive users.
- **Privacy notice disclosures complete.** Review flagged the Task 10
  deferred item; it is now included (Google, Vercel, Neon, Twilio, Sentry
  all listed as processors).
- **No third-party scripts on content pages.** Google embeds (from Task 10) are
  iframes, not scripts, so they don't violate the "no external JS" principle.
  CSP allows `frame-src` for Google only; no analytics, no tracking.
- **Images tested for lazy-loading performance.** Spot-check on throttled
  connection (3G) confirmed images load progressively; no render-blocking
  large images.
- **Game fallback tested.** With `prefers-reduced-motion: reduce`, the game
  shows the "Reveal clean smile" button instead of the canvas. Button is
  keyboard-accessible and links to `/book`.
