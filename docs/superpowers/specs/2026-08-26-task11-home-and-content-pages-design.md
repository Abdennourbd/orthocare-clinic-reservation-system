# Task 11 — Flagship Homepage & Public Content Pages Design Spec

## Overview
This spec covers Task 11 ("Public content pages") expanded to include a flagship interactive homepage. It delivers the homepage, sub-pages (services, testimonials, FAQ, gallery, about, contact, privacy), an animation system using `framer-motion`, a localized content data layer, and a decorative canvas-based mini-game.

## 1. Scope & File Map
```text
src/
  app/[locale]/
    page.tsx                 # home (ISR, composes sections)
    services/page.tsx        # list
    services/[slug]/page.tsx # detail
    testimonials/page.tsx
    faq/page.tsx
    gallery/page.tsx
    about/page.tsx
    contact/page.tsx
    privacy/page.tsx
  components/public/
    home/                    # HeroHome, TrustStrip, ServicesPreview, FeaturesSection,
                             # TestimonialsPreview, GalleryPreview, FaqPreview, CtaBand
    motion/                  # Reveal, FloatCard, CursorGlow, Marquee (framer-motion)
    game/                    # ToothBrushGame.tsx (canvas client island)
  lib/
    public/content.ts        # testimonials/faq/gallery fetchers (localized, cached)
    game/toothBrush.ts       # pure game logic (unit-tested)
messages/{fr,ar,en}.json     # new Home.*, Services.*, Faq.*, etc. namespaces
tasks/task11-todo.md         # this task's working checklist
```

## 2. Animation System
Built using `framer-motion` (installed as part of this task, verifying React 19/Next 16 compatibility).
- **Reveal**: Wraps children, uses `whileInView` for fade+rise. Disables under `prefers-reduced-motion`.
- **FloatCard**: Uses an idle `y` float loop and `whileHover` for lift/shadow.
- **CursorGlow**: Fixed pointer-events-none div, springs toward cursor. Mounts only on `matchMedia('(pointer: fine)')` + no reduced-motion. Home-only.
- **Marquee**: Infinite track via `useAnimationFrame`. Pauses on hover, static row under reduced-motion.
- **Global**: `globals.css` extended with design tokens (teal/zinc ramps, shadow, radius) + reduced-motion guards.

## 3. Tooth-brush Mini-game (Decorative)
- **Logic**: Pure logic in `lib/game/toothBrush.ts` (`plaque` per tooth, `brushAt`, `isClean`, `progress`). Unit-tested, no DOM.
- **Component**: `ToothBrushGame.tsx` — `<canvas>` client island, dynamically imported (`ssr:false`), mounts when section is in viewport. Pointermove/touch acts as brush. Win state shows sparkles + "Book your real cleaning" CTA + "Play again".
- **Accessibility & Fallback**: "Reveal clean smile" button auto-clears plaque for reduced-motion users (single transition, no loop). Canvas gets `role="img"` and translated `aria-label`. Does not gate booking.

## 4. Homepage Sections (Top to Bottom)
1. **Hero**: Redesign with gradient mesh, floating tooth/bracket icons, headline, dual CTA, scroll cue, subtle parallax.
2. **TrustStrip**: Stat cards (years, patients, Google rating, response) as floating reveal cards.
3. **ServicesPreview**: Active services from DB as float-on-hover cards linking to `/services`.
4. **Mini-game**: Tooth-brush interactive section.
5. **FeaturesSection**: "Why choose us" icon cards (gentle care, modern tech, experienced team, easy booking).
6. **TestimonialsPreview**: Active testimonials marquee linking to `/testimonials`.
7. **GalleryPreview**: 4–6 lazy `next/image` shots linking to `/gallery`.
8. **FaqPreview**: Top items accordion linking to `/faq`.
9. **ReviewsSection**: Existing GoogleReviews kept.
10. **LocationSection**: Existing LocationSection kept.
11. **CtaBand**: Final CTA linking to `/book`.

## 5. Other Task 11 Pages
- **/services**: List of services linking to detail pages (`/services/[slug]`) with duration, price, localized name/desc, and book CTA.
- **/testimonials, /faq, /gallery**: Render active items only, localized with FR fallback.
- **/about**: Clinic story, values, team (static from messages).
- **/contact**: Reuses `ClinicMap` + `DirectionsButton` + `CLINIC_LOCATION`.
- **/privacy**: Privacy notice in 3 locales listing data collected/why/processors + how to request correction/deletion. Linked from booking form + footer.

## 6. Data Layer & Caching
- **lib/public/content.ts**: Fetches testimonials, FAQs, and gallery items (localized) mirroring `services.ts`. Wrapped in `unstable_cache` with tags (`testimonial`, `faq`, `gallery`) for ISR revalidation.
- **Home + Content Pages**: `export const revalidate = 3600` (ISR) to satisfy caching requirements without forcing dynamic rendering. Static `CLINIC_LOCATION` keeps pages static-friendly.

## 7. i18n
New namespaces added to `messages/{fr,ar,en}.json` (`Home.*`, `ServicesPage.*`, `FaqPage.*`, etc.). Verified RTL for Arabic (cursor glow and marquee direction-agnostic; logical properties used).

## 8. Accessibility & Performance
- Every animated section has a reduced-motion path.
- `Reveal` keeps content in DOM (opacity/translate only) for screen readers.
- CursorGlow is `pointer-events-none` and non-focusable.
- Gallery uses `next/image` + `loading="lazy"`. Small canvas is CSS-scaled; game rAF runs only while interacting in viewport.
- `framer-motion` imported only in client islands.

## 9. Testing
- **Unit**: `lib/game/toothBrush.ts` and `lib/public/content.ts`.
- **Manual/Browser**: 3 locales, RTL, reduced-motion, mobile throttle, Lighthouse spot-check.
