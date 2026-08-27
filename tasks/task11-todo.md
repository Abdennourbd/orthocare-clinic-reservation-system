# Task 11 — Public Content Pages + Flagship Homepage

Master tracking stays in `tasks/todo.md`; this file breaks the task into shippable slices.
Skill: frontend-design + web-performance.

## Decisions
- Animation lib: `framer-motion` (installed this task). Game loop: hand-written canvas + rAF.
- Brand: teal-600 + zinc. Mini-game: decorative, reduced-motion fallback.
- Home/content pages: ISR `revalidate=3600`; content via `unstable_cache` tags (Task 21 revalidates).

## Phase A — Animation system + content data layer
- [x] Install framer-motion; verify React 19 / Next 16 compat
- [x] globals.css tokens/keyframes + reduced-motion guards
- [x] motion/Reveal, FloatCard, CursorGlow, Marquee
- [x] lib/public/content.ts (testimonials/faq/gallery, localized, cached) + unit tests

## Phase B — Flagship homepage
- [x] Home page ISR + compose sections
- [x] HeroHome, TrustStrip, ServicesPreview, FeaturesSection
- [x] TestimonialsPreview, GalleryPreview, FaqPreview, CtaBand
- [x] lib/game/toothBrush.ts (pure logic) + unit tests
- [x] game/ToothBrushGameClient.tsx (canvas, dynamic, viewport-gated, fallback)
- [x] CursorGlow mounted (home only)
- [x] Browser-test: 3 locales, RTL, reduced-motion, mobile

## Phase C — Other public content pages
- [x] /services + /services/[slug]
- [x] /testimonials, /faq, /gallery
- [x] /about, /contact (reuse Task 10 map/directions)
- [x] /privacy (3 locales; linked from booking form + footer)
- [x] All pages 3 locales + FR fallback + RTL; ISR; images lazy/optimized; throttled-mobile spot-check

## Phase D — Definition of Done
- [x] lint + typecheck + tests green (255 tests passing)
- [x] Manual /fr /ar /en (RTL) check
- [x] Reduced-motion fallback present for every animated section + mini-game
- [x] Mini-game mouse+touch; "Reveal clean smile" fallback works
- [x] Pages cached/revalidated (`revalidate = 3600`), not fresh every request
- [x] Gallery lazy/optimized (empty-state shown until images are seeded)
- [x] Privacy notice published + linked from booking form + footer
- [ ] Update tasks/todo.md Task 11 boxes; write tasks/task11-summary.md
