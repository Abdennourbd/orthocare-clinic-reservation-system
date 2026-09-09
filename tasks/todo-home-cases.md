# Task List: Homepage Cases Showcase (scroll-animated, admin-pinned)

Details + rationale live in `tasks/plan-home-cases.md`. Implement strictly in order — each task leaves a working homepage. **Plan mode was used for planning (no app code changed); implementation starts only after human approval of this plan.**

**Definition of Done — applies to every task below (inherits project `tasks/todo.md` + gallery `tasks/todo-gallery.md`):**
- [ ] Works in all 3 locales (FR/AR/EN) with RTL checked for Arabic
- [ ] Keyboard-navigable with visible focus states; `prefers-reduced-motion` shows a complete static section
- [ ] `npm run typecheck` + `npm run lint` + focused `npm test` green; `npm run build` succeeds
- [ ] Screenshots attached for review (desktop 1440 + mobile 390 + AR desktop, top + scrolled states)
- [ ] No patient data touched (cases carry admin free text only, never `Patient` rows); no schema/API change; no new dependency
- [ ] Small commits with minimal messages, local only — never pushed (per standing instruction)

## Phase 1: Data + static cards

## Task H1: SmileResults data wiring (extend, don't add a section) — DONE 2026-09-09

**Description:** Extend the existing `SmileResults` pinned chapter (`src/components/public/home/SmileResults.tsx`, human decision 2026-09-09) with the live admin feed instead of mounting a new standalone section. It reads `listFeaturedSmileCases(locale)` with fallback to `listActiveSmileCases(locale).slice(0,4)` (same rule as `GalleryPreview`), renders the featured cases in `featuredOrder` inside/adjacent to the pinned chapter + empty-state handling when zero active cases. `GalleryPreview.tsx` is explicitly KEPT (human decision — no deletion, no reference churn). No animation in this task — static cards prove the data path. Note: the pinned-chapter structure (`lg:sticky` slider column + copy beats) constrains where the feed docks — H1 decides the exact dock point (default: cases rail directly under the pinned grid, inside the same `<section>`).

**Acceptance criteria:**
- [ ] Admin featuring/unfeaturing a case (dashboard "Cas patients" tab, existing UI) changes the `SmileResults` showcase in `featuredOrder` after revalidation
- [ ] Fallback renders latest active cases when none featured; showcase handles zero active cases gracefully (no broken shell)
- [ ] Showcase renders in FR/AR/EN with FR fallback for admin title/description via `localized()`
- [ ] `GalleryPreview.tsx` untouched; pin structure (`lg:sticky`) still holds/releases cleanly

**Verification:**
- [ ] Tests pass: `npm test -- cases` (new: featured ordering + fallback + empty-state unit/component assertions)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: feature/unfeature in admin → home updates; `/fr`, `/ar`, `/en` render; mobile 390 stacks without overflow

**Dependencies:** None (reuses shipped G1–G3 backend + fetchers read-only)

**Files likely touched:**
- `src/components/public/home/SmileResults.tsx` (extend with live feed — dock point decided here)
- `src/components/public/home/CaseScrollCard.tsx` (new, or inline in SmileResults if simpler)
- `messages/fr.json`, `messages/ar.json`, `messages/en.json` (`Home.cases*` header keys)

**Estimated scope:** Small (2–3 files)

## Task H2: Case cards (slider + extras strip + description + view-case button) — DONE 2026-09-09

**Description:** Build the per-case card (`CaseScrollCard.tsx`, client component): large reused `BeforeAfterSlider` (before/after URLs from the case, localized labels), a scrollable extras strip from the case (`SmileCaseImage` rows — procedure/detail pictures, plain `next/image`, captioned, non-interactive; human decision 2026-09-09), admin title + 2-line-clamped quick description (`line-clamp-2`, full text lives on `/gallery/[key]`), per-card "Voir le cas" button → `/gallery/[key]` detail, plus section-level "Voir plus de cas" CTA → `/gallery`. Long-description and missing-image/extras fixtures handled (clamp + graceful fallback when a case has zero extras).

**Acceptance criteria:**
- [ ] Each featured case renders slider (drag mouse + touch, arrows move handle, `aria-valuenow` announces) with extras strip clearly static beside/below it
- [ ] Quick description shows admin text clamped to 2 lines; title + description fall back to FR when locale missing; zero-extras cases render slider + text cleanly
- [ ] Quick description shows admin text clamped to 2 lines; title + description fall back to FR when locale missing
- [ ] "Voir le cas" links to `/gallery/[key]`; section CTA links to `/gallery`; both focus-visible and labelled per locale
- [ ] Images lazy-loaded below fold with correct `sizes`; no layout shift on load

**Verification:**
- [ ] Tests pass: `npm test -- HomeCases` (new: card renders title/desc/links/slider labels per locale; clamp class present)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: drag + keyboard pass on one card in `/fr`, `/ar` (RTL: mechanics stay LTR-isolated, labels localized), `/en`; long-description fixture stays 2 lines

**Dependencies:** H1

**Files likely touched:**
- `src/components/public/home/CaseScrollCard.tsx` (new — slider + extras strip + text + buttons)
- `src/components/public/home/SmileResults.tsx` (card rail/grid wiring inside extended chapter)
- `messages/fr.json`, `messages/ar.json`, `messages/en.json` (`viewCase`, CTA keys)

**Estimated scope:** Medium (3–4 files)

## Checkpoint: Static showcase

- [ ] Featured pin from admin renders on home in FR/AR/EN; fallback + empty states correct
- [ ] Cards show slider + side thumbs + clamped description + both link levels
- [ ] Typecheck + lint + focused tests green, build succeeds
- [ ] Human reviews desktop + mobile + AR screenshots before animation work

## Phase 2: Motion + polish + audit

## Task H3: Scroll animation (snap rail + entry wipes, motion-system integration) — DONE 2026-09-09

**Description:** Give the section its scroll journey without touching the pin budget (`SmileResults` owns the page's one pin): mobile = horizontal `scroll-snap-x` rail (one card per view with edge peek, labelled prev/next buttons scrolling by card width); desktop = 2-col grid; both = `view-timeline` entry wipe on card media (`wipe-media` pattern, reading-start edge, RTL-mirrored via existing `[dir="rtl"]` rule or new `cases-*` keyframes) + existing `Reveal` for text. New keyframes/classes prefixed `cases-*` in `globals.css`; one animation declaration per element; static fallback + kill-switch listing included from the start.

**Acceptance criteria:**
- [ ] Rail snaps card-to-card on mobile with no horizontal page overflow at 390px; prev/next buttons scroll one card and are keyboard-operable
- [ ] Cards wipe in from the reading-start edge in FR and AR; text uses existing `Reveal` unchanged
- [ ] No element carries two `animation` declarations (grep proves it); no new infinite loops; entrances ≤1.2s
- [ ] Reduced-motion run shows the complete static section (rail becomes plain stack/scroll, no wipe); no-support run identical

**Verification:**
- [ ] Tests pass: `npm test -- HomeCases` (class assertions: rail/snap + `cases-*` hooks present) + existing `Conversion` suite green
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: screenshots at rail start / mid-scroll / end (1440 + 390 + AR); computed `clip-path` mid-wipe recorded; failure-signature grep clean

**Dependencies:** H2 (hooks only the cards H2 built)

**Files likely touched:**
- `src/app/globals.css` (`cases-*` keyframes + classes, kill-switch entries)
- `src/components/public/home/SmileResults.tsx` (rail/grid + buttons inside extended chapter)
- `src/components/public/home/CaseScrollCard.tsx` (media hooks only)

**Estimated scope:** Medium (3 files)

## Task H4: i18n/RTL/a11y/responsive polish + browser audit (screenshots, bugfix loop, small commits) — DONE 2026-09-09 (verified: FR/AR × 1440/390, rail buttons scroll 0→421→0, wipes RTL-mirrored, zero console errors, 1187 tests green, build clean, no findings requiring code changes)

**Description:** The verification backbone of this feature (runs the chrome-devtools loop the requester asked for — only AFTER plan approval, during build): real-Chromium pass over `/fr`, `/ar`, `/en` × desktop 1440 + mobile 390 — rail/keyboard traversal, slider mouse/touch/keyboard, contrast + focus rings, thumbs `alt` translation, throttled-mobile weight spot check; fix every finding in this task with small minimal-message commits (local only, never pushed). Closes with the full Definition-of-Done gate (typecheck + lint + full tests + build + headers/CSP suites).

**Acceptance criteria:**
- [ ] Keyboard-only pass succeeds: rail buttons → card links → slider handles, visible focus throughout, in FR + AR
- [ ] Contrast passes for card text/buttons; thumbs + slider `alt`/labels translated in 3 locales; RTL mirrors layout, slider gestures stay consistent
- [ ] Throttled-mobile weight recorded; images lazy; no horizontal overflow in any locale
- [ ] Every finding fixed with one small commit per fix (minimal messages), none pushed

**Verification:**
- [ ] Tests pass: `npm test` full suite green
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: screenshot tour attached (FR/AR/EN × desktop/mobile × rail stops + reduced-motion static); admin pin → home revalidation proven end-to-end

**Dependencies:** H3 (audits everything)

**Files likely touched:** only what findings require (0–3 files) + `tasks/todo-home-cases.md` status

**Estimated scope:** Small (0–3 files)

## Checkpoint: Complete

- [ ] Whole section scrolls as one calm journey in FR/AR/EN (screenshot tour)
- [ ] Reduced-motion run shows complete static content, zero animation
- [ ] Admin pin → home update verified end-to-end; consent gate inherited (unconsented cases never public)
- [ ] All acceptance criteria met — ready for human merge review (commits local only, never pushed)

## Parallelization Opportunities

- Safe to parallelize: H1 copy/i18n drafting alongside H1 wiring; H4 test-script drafting while H3 builds
- Must be sequential: H1 → H2 → H3 → H4 (each hooks the previous one's elements — one-animation rule)
- Needs coordination: `globals.css` `cases-*` naming agreed before H3 so H4's failure-signature grep is meaningful
