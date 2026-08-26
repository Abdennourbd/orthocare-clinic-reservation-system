# Task 11 — Public Content Pages + Flagship Homepage

Master tracking stays in `tasks/todo.md`; this file breaks the task into shippable slices.
Skill: frontend-design + web-performance.

## Decisions
- Animation lib: `framer-motion` (installed this task). Game loop: hand-written canvas + rAF.
- Brand: teal-600 + zinc. Mini-game: decorative, reduced-motion fallback.
- Home/content pages: ISR `revalidate=3600`; content via `unstable_cache` tags (Task 21 revalidates).

## Phase A — Animation system + content data layer
- [ ] Install framer-motion; verify React 19 / Next 16 compat
- [ ] globals.css tokens/keyframes + reduced-motion guards
- [ ] motion/Reveal, FloatCard, CursorGlow, Marquee
- [ ] lib/public/content.ts (testimonials/faq/gallery, localized, cached) + unit tests

## Phase B — Flagship homepage
- [ ] Home page ISR + compose sections
- [ ] HeroHome, TrustStrip, ServicesPreview, FeaturesSection
- [ ] TestimonialsPreview, GalleryPreview, FaqPreview, CtaBand
- [ ] lib/game/toothBrush.ts (pure logic) + unit tests
- [ ] game/ToothBrushGame.tsx (canvas, dynamic, viewport-gated, fallback)
- [ ] CursorGlow mounted (home only)
- [ ] Browser-test: 3 locales, RTL, reduced-motion, mobile

## Phase C — Other public content pages
- [ ] /services + /services/[slug]
- [ ] /testimonials, /faq, /gallery
- [ ] /about, /contact (reuse Task 10 map/directions)
- [ ] /privacy (3 locales; linked from booking form + footer)
- [ ] All pages 3 locales + FR fallback + RTL; ISR; images lazy/optimized; throttled-mobile spot-check

## Phase D — Definition of Done
- [ ] lint + typecheck + tests green
- [ ] Manual /fr /ar /en (RTL) check
- [ ] Reduced-motion verified for every animated section
- [ ] Mini-game mouse+touch; "Reveal clean smile" works
- [ ] Pages cached/revalidated, not fresh every request
- [ ] Gallery lazy/optimized; page weight measured on throttled mobile
- [ ] Privacy notice published + linked from booking form + footer
- [ ] Update tasks/todo.md Task 11 boxes; write tasks/task11-summary.md