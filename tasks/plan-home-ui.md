# Implementation Plan: Home UI De-slop (Hero-first Redesign)

## Overview

The home page (`src/app/[locale]/page.tsx`) reads as AI slop, worst in the first viewport (`HeroHome`). The fix is a hero-first, vertically-sliced redesign: replace the generic centered-gradient + floating-icons + gradient-text hero with a proof-first editorial hero built around real clinic identity (Rouiba/Alger, real smile photo, live Google rating, hours/phone, booking promise), then de-slop the immediately adjacent sections (TrustStrip stats, page composition, motion/system) so the new hero doesn't sit on top of the same slop. No backend, schema, or API changes. Copy stays trilingual (FR/AR/EN, RTL-safe).

## Why the current hero reads as slop (read-only diagnosis)

Evidence from `src/components/public/home/HeroHome.tsx:1-142`:

- Centered `max-w-5xl text-center` column on `bg-gradient-to-b from-teal-50 via-white to-white` — the default AI-hero scaffold.
- 5 hand-tuned floating `ToothIcon`/`SparkleIcon` glyphs on infinite framer-motion loops (`floaters`, `HeroHome.tsx:22-28,48-64`) + parallax `yText`/`opacity` scroll transform + `CursorGlow` mounted in `page.tsx:32`. Decorative motion substituting for content.
- Pill badge (`heroBadge`), `text-4xl sm:text-6xl md:text-7xl` title with `bg-gradient-to-r from-teal-600 to-emerald-500 bg-clip-text` accent span (`HeroHome.tsx:70-86`), generic subtitle, two `rounded-full` CTAs, 5 amber `StarIcon`s + `heroRating` string, bouncing scroll cue (`HeroHome.tsx:127-139`). Every element is a known template tell.
- Zero real proof in the first viewport: no photo (we own `public/images/smile.jpg`, `smile-640.webp`, before/after whitening shots — none used in hero), no address, no hours, no phone, no doctor, no "we call you to confirm" promise (that copy only exists deeper in the booking flow, `messages/fr.json: Booking.intro/summaryConfirmNote`).
- Repetition below the fold amplifies it: `TrustStrip.tsx:9-14` hardcodes `10+ / 5000+ / 4.9★ / 98%` floating cards; `ServicesPreview`, `FeaturesSection`, `CtaBand` all reuse the same `rounded-2xl border + FloatCard + Reveal + teal icon tile` card grid; the `ToothBrushGameSection` game sits mid-page and breaks medical trust.

## Architecture Decisions

- **No new dependencies.** Reuse `next/image`, existing `next-intl` namespaces, existing `GoogleReviews`/`ClinicMap`/`DirectionsButton` components. Remove motion (`floaters`, `CursorGlow` on home, scroll cue, parallax) rather than adding animation libraries.
- **Real photo over illustration.** Hero art = one optimized real image (`smile-640.webp` / `smile.jpg` via `next/image`, with `before/after` available for the results section). No AI-generated teeth, no icon collage. If the clinic supplies a real storefront/chair photo later, it swaps in with zero layout change.
- **Proof-first copy.** Hero answers in 5 seconds: where (Rouiba, Alger), what (orthodontie), why trust (live Google rating card, not a hardcoded `4.9★` string), what next (book online → we call to confirm; or call now). Stats with unverifiable numbers (`5000+`, `98%`) are removed unless the clinic provides audited figures.
- **Editorial split, not centered column.** `lg:grid-cols-[1.05fr_0.95fr]` — copy left (RTL-flips automatically via logical properties), photo right with a small overlay proof card (rating + address + hours). Centered layout is reserved for the final `CtaBand` only.
- **Motion budget.** Static hero paint (keep the existing CSS-only `hero-enter` LCP pattern from `globals.css:46-59`, no framer-motion `initial={{opacity:0}}` on LCP). `prefers-reduced-motion` already collapses animations globally — the redesign must not reintroduce JS-driven hero motion.
- **i18n/RTL is a constraint, not a follow-up.** Every task ships FR+AR+EN strings and an Arabic RTL check (hero art must not mirror text; overlay card uses logical `start/end`).

## Dependency Graph

```
Hero copy (FR/AR/EN strings in messages/*.json)
  └── Task 1: HeroHome redesign (layout + photo + proof, floaters/CursorGlow/scroll-cue removed)
        ├── Task 2: TrustStrip replacement (consumes hero proof pattern; removes fake stats)
        │     └── Task 3: Home composition reorder (hero → proof → booking shortcut → services → results → FAQ → location/CTA; game demoted/moved)
        │           └── Task 4: Visual-system de-slop (buttons/radius/teal budget/motion removal/next/image/RTL/a11y — applied to files touched in 1-3)
        └── Task 5 (verification) runs after each of 1-4, full pass at the end
```

Build order is bottom-up: hero first (the ask), then the strip that overlaps it (`-mt-10`), then composition, then system polish. Nothing depends on backend, DB, or API work.

## Task List

### Phase 1: First viewport (the ask)

- [ ] Task 1: Proof-first editorial hero (replaces HeroHome slop)
- [ ] Task 2: TrustStrip → real proof bar (removes fake stats)

### Checkpoint: Hero + proof

- [ ] Hero paints statically with no floaters/parallax/CursorGlow/scroll cue
- [ ] Real photo renders optimized in 3 locales + RTL
- [ ] `npm run typecheck && npm run lint && npm test` green
- [ ] Human reviews screenshots (desktop + mobile + AR) before proceeding

### Phase 2: Composition + system

- [ ] Task 3: Home composition reorder + game demotion
- [ ] Task 4: Visual-system de-slop (buttons, color, motion, images, a11y)

### Checkpoint: Complete

- [ ] Full home reads as one clinic voice, not card-grid repetition
- [ ] Lighthouse mobile spot-check + keyboard-only pass + 3-locale visual pass
- [ ] Human approves before any merge

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Real clinic photo not available (only `smile.jpg` stock-like asset) | Med — hero still beats icons, but weaker | Ship with best owned asset via `next/image`; leave a named slot + `Open Question` for clinic to supply storefront/chair photo; no layout rework when it arrives |
| Hardcoded stats (`5000+`, `98%`) are actually wanted by clinic | Low | Task 2 removes by default; if clinic provides audited numbers, re-add as sourced figures with dates, not floating cards |
| Removing `CursorGlow`/parallax feels "less premium" to someone | Low | Stillness + photo + proof converts better for a medical booking page; motion budget is documented; game stays (demoted) for playfulness |
| AR/RT photo + overlay overlap breaks | Med | Task 1 acceptance includes explicit AR screenshot; overlay uses logical properties, never physical `left/right` |
| Scope creep into full rebrand (logo, palette, typography) | High | Explicitly out of scope — keep teal/zinc, Geist + Arabic fonts; only spend is consistency (radius/button/teal budget) |

## Resolved Decisions (human review 2026-09-07)

1. **Hero photo → real assets vendored from clinicorthocare.com.** Download (don't hotlink) into `public/images/`: doctor portrait `dr-moussaoui-b-orthodontiste-alger-orthocare-1-768x1092.png` (hero-first choice), waiting room `salle-dattente-moderne-…jpg`, reception `orthocare-clinic-reception-dr-moussaoui-1024x843.jpg`, treatment `dr-moussaoui-orthocare-clinic-patient-care-1024x722.jpg`, equipment `modern-dental-equipment-moussaoui.jpg`, real before/after `before/after-smile-makeover-orthocare.jpg` (results section). Serve via `next/image` with local `alt` translations. Old WP URLs stay as attribution comments only.
2. **Stats → corrected from the official site.** The live site claims **Note Google 4.8 (37 avis)** — NOT the `4.9★` / `5000+` / `98%` / `10+` hardcoded in `TrustStrip`/`HeroHome`. None of `5000+`, `98%`, `10+ ans` appear on clinicorthocare.com → treated as invented, removed. Proof bar uses the verified 4.8 (37 avis) + real hours (Sam–Jeu 10h–17h) + real phone (+213 793 03 58 93) + address (10 rue Larbi Abdelsalem, Rouiba).
3. **Game → stays where it is.** `ToothBrushGameSection` keeps its current position in `page.tsx`. No reorder of the game in Task 3; composition work only fixes duplicated headers and the double-testimonial merge.
4. **Slop elements → all four removed.** `CursorGlow` on home, floating teeth/sparkles, parallax fade, scroll cue, gradient headline text — all go in Task 1.
5. **Rebrand allowed, scoped.** Logo vendored from clinicorthocare.com (`logo.png` / `orthocare-logo-1-….png`, footer uses `orthocare-clinic-logo-150x150.png`) into `public/images/` and wired into `Header`/`Footer` (replacing the `O` circle). Palette/typography may shift toward the real brand (teal family kept unless the logo demands otherwise); full new design-token system is still out of scope — Task 4 records whatever tokens change.
6. **fluid-orb REJECTED 2026-09-07, RE-APPROVED 2026-09-07 (user override).** User explicitly re-requested `swamimalode07/rare-ui/fluid-orb` + CodeFronts as the anti-slop foundation. Conditions: registry ships ONE file (`components/ui/fluid-orb.tsx`, zero npm deps, no CDN — verified in `registry.json`); vendor it by hand (no interactive `shadcn init`, but write a standard `components.json` so future `shadcn add` works); scope it to ONE motivated ambient backdrop in the hero (teal-tinted via `color` prop), static poster under `prefers-reduced-motion`, pause offscreen; hero LCP stays the portrait (`next/image priority`), never the canvas. Nothing installed yet at plan time.
7. **Doctor-centric direction (2026-09-07).** Home page focuses on **Dr Besma Moussaoui** — her face (vendored portrait), experience (ODF specialist, PITTS Protocol, aligneurs), kindness + professionalism (real patient quotes from clinicorthocare.com, max 3 lines each). Explicit goal: a better UI than clinicorthocare.com, not a copy. Copy register: warm, plain, professional — no cute AI metaphors. FR/AR/EN for every new string.
8. **CodeFronts usage (2026-09-07).** Copy-paste source (MIT, scoped `.hs-NN` CSS, reduced-motion guarded): `Glass over Aurora` (wellness/luxury hero language), `Before/After Hero` (native-range pattern — matches our `BeforeAfterSlider`), `Social Proof Hero` (rating-pill pattern). Vendor adapted excerpts with attribution comments; no framework, no CDN.
9. **Execution discipline (2026-09-07).** Subagents unavailable (model capacity errors) — implement directly. Commit after every small green step, never push. Finish with a security pass (npm audit + secrets grep + CSP/headers tests) and fix findings before declaring done.

## Open Questions — RESOLVED (see above)

1. Do you have 1–3 real photos we should use (cabinet façade, chair, doctor, real patient smile with consent)? If yes, hero uses the best one; otherwise `smile-640.webp` ships.
2. Are the TrustStrip numbers (`10+ ans`, `5000+ patients`, `98% satisfaits`) audited and OK to keep, or should they go? Default in this plan: remove, replace with verifiable proof (Google rating live card, address, hours, "appel de confirmation" promise).
3. Keep the toothbrush whitening game on home (demoted below results) or move it to `/services/blanchiment` only? Default: demote, don't delete.
4. OK to drop `CursorGlow` on home + floating teeth + scroll cue + gradient headline text? Default: yes, all four go.
5. ~~Confirm no rebrand in this pass (keep teal-600/zinc, keep `rounded-full` removal limited to hero/proof, keep fonts)?~~ RESOLVED: rebrand allowed — vendor logo from clinicorthocare.com; palette may follow the logo.

## Official-site asset inventory (vendored in Task 1, never hotlinked)

| Asset | Source URL (attribution only) | Local target | Used in |
|---|---|---|---|
| Logo (header + footer, `logo.png` 404'd → use mark) | `…/2026/03/orthocare-clinic-logo-150x150.png` | `public/images/orthocare-logo-mark.png` | Header + Footer |
| Logo alt (elementor thumb, fallback) | `…/elementor/thumbs/orthocare-logo-1-rl85jjpw6r4c2vlfipoj67q5l3eplu8seixl3v3fwg.png` | — (fallback only) | — |
| Footer mark 150×150 | — (same file as above) | `public/images/orthocare-logo-mark.png` | Footer |
| Dr Moussaoui portrait (HERO) | `…/2026/03/dr-moussaoui-b-orthodontiste-alger-orthocare-1-768x1092.png` | `public/images/dr-moussaoui-portrait.png` | Task 1 hero |
| Waiting room | `…/2025/03/salle-dattente-moderne-orthocare-clinic-alger-1-scaled.jpg` | `public/images/clinic-waiting-room.jpg` | Hero alt / about |
| Reception | `…/2026/03/orthocare-clinic-reception-dr-moussaoui-1024x843.jpg` | `public/images/clinic-reception.jpg` | Location/about |
| Doctor treating patient | `…/2026/03/dr-moussaoui-orthocare-clinic-patient-care-1024x722.jpg` | `public/images/dr-treatment.jpg` | Proof/features |
| Equipment | `…/2026/03/modern-dental-equipment-moussaoui.jpg` | `public/images/clinic-equipment.jpg` | Features |
| Before smile | `…/2026/03/before-smile-makeover-orthocare.jpg` | `public/images/smile-before.jpg` | Results/gallery |
| After smile | `…/2026/03/after-smile-makeover-orthocare.jpg` | `public/images/smile-after.jpg` | Results/gallery |

Official facts (from clinicorthocare.com, 2026-09-07): headline "L'excellence dentaire, la douceur en plus!"; lead "Dr Moussaoui B. — spécialiste ODF & orthodontie (PITTS Protocol, aligneurs)"; rating **4.8 (37 avis)**; phone **(+213) 793 03 58 93**; hours **Sam–Jeu 10h–17h**; address **10 rue Larbi Abdelsalem, Rouiba**; email `contact@clinicorthocare.com`; socials Instagram `ortho.care.odf` / Facebook `OrthoCare-Clinic-100091781343924`. No `5000+`/`98%`/`10+` anywhere → removed as invented.

---
*Plan mode: read-only. No code changed. Tasks tracked in `tasks/todo-home-ui.md` (not the main `tasks/todo.md`, which owns the backend build — see note at top of that file).*
