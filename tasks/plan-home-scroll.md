# Implementation Plan: Home Scroll Journey (whole-page scroll animation)

## Overview

The home page today animates in fragments: a load fade here, a reveal there,
an Exhale on the hero — but scrolling it feels static, and the first screen
arrives with no impression. This plan turns the whole page into one calm,
continuous scroll journey: a cinematic hero arrival, a scroll-progress
hairline under the header, one pinned transformation moment (the before/after
slider holds while its story scrolls past), parallax photo bands, and
clip-wipe media reveals, closing with an aurora CTA finale. Everything is
pure CSS scroll/view-timelines — the mechanism already proven in this
codebase (`globals.css` header + hero Exhale) — with static fallbacks where
unsupported and a reduced-motion kill-switch following the existing pattern.
No new dependencies, no copy changes, no API/schema changes. The toothbrush
game stays exactly where it is (human decision, unchanged).

## Architecture Decisions

- **One animation per element, always.** Hard rule learned in this repo: two
  `animation`-shorthand classes on one element silently kill one of them;
  multi-animation shorthands sharing one `scroll()` timeline stick. Separate
  elements or merged keyframes — never two animation declarations per node.
- **Timelines, not triggers, for scroll-linked motion.** `scroll()` for
  page-progress chrome (progress hairline), named `view-timeline`s with
  `exit`/`entry`/`cover` ranges for section choreography. The existing
  `Reveal` (IntersectionObserver, plays once) stays for simple entrances;
  timelines own everything scrubbed by scroll position.
- **Exactly one pinned moment per page.** Pinning is the strongest device
  and the easiest to abuse: only the smile transformation pins. Everything
  else moves with normal flow (parallax = inner-image translate inside an
  `overflow-hidden` frame, never background-attachment — janky on mobile).
- **Transform/opacity/clip-path only.** No layout-property animation
  (height/margin/top). The single exception remains the header brand
  `max-width` collapse (tiny inline element, shipped and verified).
- **Static is the fallback, not an error.** Every effect degrades to a
  complete, composed static page without `animation-timeline` support.
  Reduced motion gets the full static page via the existing kill-switch
  block in `globals.css` (scroll timelines ignore duration, so they must be
  listed there explicitly — established pattern, keep following it).
- **Calm budget.** Medical page, anxious audience: load choreography ≤1.2s
  total, infinite loops stay where they are (marquee, orb); nothing new
  loops forever.

## Dependency Graph

```
globals.css scroll foundation (exists: keyframes syntax, kill-switch)
  ├── Task 1: Hero arrival choreography (load only, no scroll dependency)
  ├── Task 2: Journey chrome — scroll-progress hairline (scroll() timeline)
  │     └── Task 6 (audit) verifies 1+2 together at Checkpoint 1
  ├── Task 3: Pinned transformation chapter (sticky + view-timeline)
  │     └── needs SmileResults structure as anchor (exists, read-only use)
  ├── Task 4: Parallax photo bands (comfort + clinic inner-image translate)
  ├── Task 5: Media wipe reveals + CTA finale (entry-range clip-paths)
  │     └── Task 6 (audit): reduced-motion, fallbacks, perf, screenshots
```

Build order is bottom-up by risk: load choreography first (visible instantly,
fails safe), pinning early (highest-risk mechanism — fail fast), parallax and
wipes after (independent), audit last.

## Task List

### Phase 1: Arrival + chrome

- [ ] Task 1: Cinematic hero arrival (load choreography)
- [ ] Task 2: Scroll-progress journey hairline

### Checkpoint: Arrival

- [ ] First screen impresses on cold load (screenshot)
- [ ] Hairline tracks 0→100% top→bottom (computed-style proof)
- [ ] Typecheck + lint + focused tests green, build succeeds

### Phase 2: Journey chapters

- [ ] Task 3: Pinned smile-transformation chapter
- [ ] Task 4: Parallax photo bands (comfort + clinic)

### Checkpoint: Chapters

- [ ] Pin holds/releases cleanly incl. mobile 390px (screenshots)
- [ ] Parallax visible but calm at 3 scroll stops (screenshots)
- [ ] No layout shift, no horizontal overflow in any locale

### Phase 3: Reveals + audit

- [ ] Task 5: Media wipe reveals + CTA aurora finale
- [ ] Task 6: Motion audit pass (reduced-motion, fallbacks, perf, tests)

### Checkpoint: Complete

- [ ] Whole page scrolls as one journey in FR/AR/EN (screenshot tour)
- [ ] Reduced-motion run shows complete static page, zero animation
- [ ] All acceptance criteria met, ready for human merge review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `view-timeline` unsupported (older browser) | Med — journey lost | Static fallback is the designed default; audit task verifies it by disabling timelines |
| Sticky pin traps mobile users / breaks RTL | High | Pin is vertical-only `position: sticky` (direction-agnostic); Task 3 acceptance includes 390px + AR screenshots |
| Over-animation hurts trust/conversion | High | One pin max, calm budget (≤1.2s load), parallax ±8% translate; human reviews screenshots at every checkpoint |
| Multi-animation cascade bug (seen twice) | Med | One-animation-per-element rule in every task; verification greps for duplicate animation classes |
| Screenshot tooling flakiness (headless quirks seen before) | Low | DOM-dump ground truth + computed-style numbers alongside every screenshot; /tmp puppeteer harness recreated in Task 1 |

## Open Questions

1. Pin the before/after slider (proof — recommended) or the doctor quote band (emotion)? Default: slider.
2. Hero load budget: full choreography ~1.0–1.2s, or snappier ~0.7s? Default: ~1.0s.
3. Scroll-progress hairline: teal solid, or gradient teal→amber? Default: solid teal-600 (site palette lock).
4. Keep the toothbrush game fully static during the journey (recommended yes) or give it a gentle entry wipe with everything else?

---
*Plan mode: read-only, no code changed. Tasks tracked in `tasks/todo-home-scroll.md`
— `tasks/plan.md` / `tasks/todo.md` own the backend build and were deliberately
not touched.*
