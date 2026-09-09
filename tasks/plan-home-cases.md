# Implementation Plan: Homepage Cases Showcase (scroll-animated, admin-pinned)

## Overview

Add a scroll-animated patient-cases showcase by extending the existing `SmileResults` pinned transformation chapter on the homepage (`src/app/[locale]/page.tsx`, human decision 2026-09-09). Each card shows an interactive before/after slider, a quick admin-written description, a scrollable extras strip from the case, and a "see more about the case" button linking to `/gallery/[key]`. Which cases appear — and in which order — is chosen by the admin via the existing `featured` + `featuredOrder` pick (max 4, enforced by the admin API). No schema, API, or admin-UI changes: the backend for this feature is already shipped (G1–G3). This is a frontend/UI-only vertical slice: data wiring → animated cards → motion-system integration → i18n/a11y polish → browser-verified audit.

Spec context: project-wide spec lives in `tasks/plan.md`. Gallery/cases backend spec lives in `tasks/plan-gallery.md` (SmileCase model, featured cap, consent gate, fetchers). Scroll-motion language lives in `tasks/plan-home-scroll.md` + `tasks/home-conversion.md`. There is no homepage-cases SPEC file, so this document is the spec + plan for this feature. Codebase sections read (plan mode, no app code changed): `src/app/[locale]/page.tsx` (no cases section mounted — `GalleryPreview` exists but is unmounted), `src/components/public/home/GalleryPreview.tsx` (featured fetch + after-image cards + CTA), `src/components/public/home/SmileResults.tsx` (static vendored before/after, pinned chapter anchor), `src/components/public/BeforeAfterSlider.tsx` (pointer + keyboard + RTL-isolated slider), `src/lib/public/content.ts` (`listFeaturedSmileCases` + `listActiveSmileCases` + `getSmileCaseByKey`, `gallery` cache tag), `src/app/globals.css` (scroll/view timelines, kill-switch, one-animation rule), `messages/fr.json` (`Home.gallery*` + `GalleryPage.*` keys), `prisma/schema.prisma` (`SmileCase.featured/featuredOrder`, consent gate).

> **File-note:** the request said to save to `tasks/plan.md` / `tasks/todo.md`, but those files already hold the whole-project plan and checklist (Tasks 1–23). Overwriting them would destroy project history — the established convention in this repo (see `tasks/plan-gallery.md`, `tasks/plan-home-scroll.md`, `tasks/plan-home-ui.md`) is one `tasks/plan-<feature>.md` + `tasks/todo-<feature>.md` pair per feature. So this feature plan lives here (`tasks/plan-home-cases.md`) with its task list in `tasks/todo-home-cases.md`.

## Architecture Decisions

- **Reuse the admin pin, don't rebuild it.** `SmileCase.featured` (bool) + `featuredOrder` (int), API caps at 4, admin UI shows live `featuredCount/4` (`CasesTab.tsx`, `CaseForm.tsx`), public fetcher `listFeaturedSmileCases(locale)` ordered by `featuredOrder` with fallback to latest active cases. The homepage reads exactly the same source as `GalleryPreview` — admin pins once, gallery + home update together via the `gallery` cache tag. Rationale: zero new backend, zero new admin UI, zero new consent logic; the consent gate (`active` requires `consentConfirmed`) is inherited for free.
- **Extend `SmileResults`, keep `GalleryPreview` (human decisions 2026-09-09).** The live admin cases dock into the existing pinned transformation chapter (`SmileResults.tsx`) rather than a new standalone section. `GalleryPreview.tsx` (currently unmounted, after-image-only cards) stays in the tree for possible reuse — not deleted.
- **Card layout: slider hero + extras strip + text + actions (human decision 2026-09-09).** Each card: large `BeforeAfterSlider` (reuse as-is, `dir="ltr"` mechanics isolation), a scrollable extras strip from the case (`SmileCaseImage` rows via the detail fetcher shape, plain `next/image`, non-interactive), title (admin free text via `localized()`), 2-line clamped quick description (admin `description`), "Voir le cas" button → `/gallery/[key]` detail (more pictures), plus section-level "Voir plus de cas" CTA → `/gallery`.
- **Scroll animation = scroll-snap rail + view-timeline reveals, zero new deps.** Horizontal `scroll-snap-x` rail on mobile (one card per view, edge-peek), 2-col grid on desktop with `view-timeline` entry wipes (`wipe-media` pattern, reading-start edge, RTL-mirrored). Cards enter via existing `Reveal` (IntersectionObserver, plays once); rail scroll is native (no JS carousel lib, no scroll-jacking). Rationale: consistent with the home-scroll journey (`plan-home-scroll.md`), calm medical budget, works without JS for content (images + text render; slider degrades to after-image).
- **Motion rules inherited, non-negotiable.** Transform/opacity/clip-path only; one `animation` declaration per element (hard rule learned twice in this repo); static fallback is the designed default; full kill-switch listing in `prefers-reduced-motion` block; `aria-hidden` on decorative motion; sticky/pin budget already spent on `SmileResults` — this section does NOT pin.
- **i18n/RTL/a11y is a constraint, not a follow-up.** New strings in `Home.cases*` namespace (FR+AR+EN, FR fallback via `localized()` for admin content); slider keeps `role="slider"` + `aria-valuenow`; rail has labelled prev/next buttons + keyboard scroll (arrow keys scroll the rail, focus-visible rings); Arabic mirrors layout via logical properties, slider mechanics stay `dir="ltr"`.
- **Images: `next/image`, lazy below fold, Blob hosts already allow-listed.** `beforeImageUrl`/`afterImageUrl` may be Blob public URLs or pasted URLs — `next.config.ts` already allow-lists Blob hosts (verified in G5). `sizes` set per breakpoint; thumbs use small widths; page-weight spot check on throttled mobile in the audit task.

## Dependency Graph

```
SmileCase.featured + featuredOrder + consent gate (SHIPPED G1-G3, read-only reuse)
  ├── listFeaturedSmileCases(locale) + gallery cache tag (SHIPPED, read-only reuse)
  │     │
  │     ├── Task H1: SmileResults data wiring (featured feed into pinned chapter, fallback, empty state)
  │     │     │
  │     │     ├── Task H2: scroll cards (slider reuse + extras strip + desc + view-case button + rail/grid)
  │     │     │     │
  │     │     │     └── Task H3: scroll animation + motion-system integration (snap + wipes + Reveal, no pin)
  │     │     │           │
  │     │     │           └── Task H4: i18n/RTL/a11y/responsive polish + audit (chrome-devtools screenshots, bugfix loop)
```

Implementation order follows the graph bottom-up, sliced vertically so each task leaves a working homepage.

## Task List

### Phase 1: Data + static cards (working section, no animation)

- [ ] Task H1: Section skeleton + featured data wiring
- [ ] Task H2: Case cards (slider + side thumbs + description + view-case button)

### Checkpoint: Static showcase

- [ ] Featured pin from admin renders on home in FR/AR/EN; fallback + empty states correct
- [ ] Typecheck + lint + focused tests green, build succeeds
- [ ] Human reviews desktop + mobile + AR screenshots before animation work

### Phase 2: Motion + polish + audit

- [ ] Task H3: Scroll animation (snap rail + entry wipes, motion-system integration)
- [ ] Task H4: i18n/RTL/a11y/responsive polish + browser audit (screenshots, bugfix loop, small commits)

### Checkpoint: Complete

- [ ] Whole section scrolls as one calm journey in FR/AR/EN; reduced-motion shows complete static content
- [ ] Admin pin → home update verified end-to-end (feature/unfeature in dashboard, revalidation observed)
- [ ] All acceptance criteria met, ready for human merge review (commits local only, never pushed)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Horizontal rail traps keyboard / screen-reader users | High | Native scroll + labelled prev/next buttons + focus-visible; slider keeps its own `role="slider"`; audit task does a keyboard-only pass |
| Slider + side thumbs confuse ("which one drags?") | Med | Only the central slider is interactive; thumbs are static `next/image` with captions; visual hierarchy (large slider, small thumbs) decided in H2 review |
| Admin description too long, breaks card rhythm | Med | 2-line clamp (`line-clamp-2`) + full text on detail page; H2 acceptance includes a long-description fixture |
| Animation collides with SmileResults pin / journey hairline (one-animation rule) | Med | New keyframes/classes prefixed `cases-*`; hooks only on new elements; grep verification in H3 |
| Featured images heavy on mobile (4 cases × 2+ images) | Med | Lazy below fold, `sizes` set, thumbs at small widths, throttled-connection spot check in H4 |
| No featured cases / only drafts (empty home) | Low | Fallback to latest active cases (same as GalleryPreview); null-render when zero active; covered by test |
| Over-animation hurts medical trust | High | Snap + one wipe per card max, no pin, no infinite loops, ≤1.2s entrances; human reviews screenshots at every checkpoint |

## Open Questions (for human review — see chat)

Resolved by human (2026-09-09):
1. Placement → **extend `SmileResults`**, not a standalone section after `ServicesPreview`. The live admin cases dock into the existing pinned transformation chapter.
2. Rail vs grid → **rail on mobile + 2-col grid on desktop** (recommended default confirmed).
3. Side thumbs → **extras strip** (scrollable extras from the case), not the static before/after pair.
4. `GalleryPreview` → **keep** (unmounted file stays for possible reuse; new showcase does not delete it).
5. Description length: 2-line clamp on card + full on detail (default, pending review).
6. Buttons: per-card "Voir le cas" → detail AND section "Voir plus de cas" → gallery (default, pending review).

---
*Plan mode: read-only, no app code changed. Tasks tracked in `tasks/todo-home-cases.md` — `tasks/plan.md` / `tasks/todo.md` own the backend build and were deliberately not touched.*
