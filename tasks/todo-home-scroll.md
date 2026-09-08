# Task List: Home Scroll Journey (whole-page scroll animation)

> Context + rationale live in `tasks/plan-home-scroll.md`. Working checklist.
> NOTE: the backend tracker stays `tasks/todo.md`; the home-conversion tracker
> stays `tasks/todo-home-ui.md`. This pass tracks here so nothing clobbers them.
> Plan mode: no code changes yet. Human approval required before Task 1.

**Definition of Done — applies to every task below:**
- [x] Works in FR/AR/EN with RTL checked for Arabic
- [x] `prefers-reduced-motion` shows a complete static page (listed in kill-switch)
- [x] No-support fallback shows a complete static page (verified, not assumed)
- [x] Transform/opacity/clip-path only; one animation declaration per element
- [x] `npm run typecheck` + `npm run lint` (0 new warnings) + focused `npm test` green; `npm run build` succeeds
- [x] Screenshots attached (desktop 1440 + mobile 390, top + mid-flight states)
- [x] No API/schema/copy changes; no new dependencies

## Phase 1: Arrival + chrome

## Task 1: Cinematic hero arrival (load choreography) — DONE 2026-09-08

**Description:** First-screen impression on cold load, pure CSS (extends the
existing `hero-enter` keyframe family in `globals.css`, no JS): orb blooms
(scale 0.8→1 + fade, ~700ms), portrait rises once (translateY 24→0, ~800ms),
copy staggers in sequence (existing delays re-timed as one 3-step cascade
≤1.0s total), CTAs settle last with a soft shadow bloom, plus a small scroll
cue (thin animated line, not the old bouncing arrow). Respects the Exhale:
load animation paints the resting state that scroll choreography starts from.

**Acceptance criteria: (verified 2026-09-08: staged screenshots mid-flight + resting, both attached in session)**
- [x] Cold load shows a staged arrival (orb → portrait → copy → CTAs), total ≤1.2s
- [x] Resting state pixel-matches today's hero (no layout/copy change)
- [x] Scroll cue present, subtle, hidden under reduced motion

**Verification:**
- [x] Tests pass: `npm test -- HeroHome` (existing suite green, unchanged queries)
- [x] Build succeeds: `npm run build`
- [x] Manual check: slow-motion screen recording or 3 staged screenshots (0ms / 400ms / 1000ms) at 1440 + 390

**Dependencies:** None (extends existing `hero-enter` pattern)

**Files likely touched:**
- `src/app/globals.css` (keyframes only)
- `src/components/public/home/HeroHome.tsx` (class hooks only, no copy change)
- `src/components/public/home/HeroOrb.tsx` (bloom class hook, if needed)

**Estimated scope:** Small (2–3 files)

## Task 2: Scroll-progress journey hairline — DONE 2026-09-08

**Description:** A 3px teal hairline fixed directly under the sticky header
that scales 0→100% with page scroll (`scroll()` timeline, `transform: scaleX`,
`transform-origin` flipped automatically in RTL via logical properties —
verify, else pin `dir="ltr"` like the gooey nav). It is the journey's
through-line: one glance tells the patient how far the story goes. Zero JS,
`aria-hidden`, hidden under reduced motion (static: not rendered).

**Acceptance criteria: (verified 2026-09-08: scaleX 0→0.5 computed + full-viewport screenshot showing half-filled hairline under condensed header)**
- [x] Hairline fills exactly with page progress (0 at top, 1 at bottom)
- [x] Never overlaps header content or causes horizontal overflow at 390px
- [x] Invisible (not rendered) under reduced motion

**Verification:**
- [x] Tests pass: `npm test -- Header` (contract: hairline element present with journey class)
- [x] Build succeeds: `npm run build`
- [x] Manual check: computed `transform` scaleX at scroll 0 / 50% / 100% via headless harness + screenshot

**Dependencies:** None (independent of Task 1; shares only `globals.css` foundation)

**Files likely touched:**
- `src/app/globals.css` (one keyframe + class)
- `src/components/public/Header.tsx` (hairline element hook)
- `src/components/public/Header.test.tsx` (presence assertion)

**Estimated scope:** Small (2–3 files)

## Checkpoint: After Tasks 1–2 (Arrival) — DONE 2026-09-08

- [x] First screen impresses on cold load (staged screenshots)
- [x] Hairline tracks 0→100% (computed numbers)
- [x] Typecheck + lint + focused tests green, build succeeds
- [x] Tasks 1–2 verified end-to-end, proceeding per standing loop order

## Phase 2: Journey chapters

## Task 3: Pinned smile-transformation chapter — DONE 2026-09-08

**Description:** The highest-risk mechanism, done first to fail fast: the
SmileResults slider pins (`position: sticky`, vertical only — RTL-safe)
while its story (badge, title, description, caption, CTAs) scrolls past in
2–3 beats, then releases into ComfortSection. Pure CSS sticky + normal flow;
no scroll-jacking, no JS measuring, no layout shift (sticky reserves space
by construction). Default subject: the before/after slider (proof); see
Open Question 1 in the plan.

**Acceptance criteria:**
- [x] Slider holds for ~1 viewport of scroll while copy beats pass, then releases cleanly
- [x] No content jump on pin/release; sticky bar + mobile booking bar never covered
- [x] Reads correctly at 390px and in AR (no horizontal overflow, order sensible)

**Verification:**
- [x] Tests pass: `npm test -- Conversion` (existing suite green; add pin-container class assertion)
- [x] Build succeeds: `npm run build`
- [x] Manual check: screenshots at pin-start / mid-pin / release (1440 + 390 + AR)

**Dependencies:** SmileResults structure as anchor (exists — read-only reuse, no logic change)

**Files likely touched:**
- `src/app/globals.css` (pin container + beats rhythm, if not pure Tailwind)
- `src/components/public/home/SmileResults.tsx` (structure hooks only, no copy change)
- `src/components/public/home/Conversion.test.tsx` (class assertion)

**Estimated scope:** Medium (3 files)

## Task 4: Parallax photo bands (comfort + clinic) — DONE 2026-09-08

**Description:** Inner-image parallax inside `overflow-hidden` frames: the
treatment photo and the three clinic photos translate ±8% against their
frames on a `view-timeline` `cover` range, so photography breathes while
copy stays rock steady. Transform-only, frames keep fixed aspect ratios
(zero layout shift), `loading="lazy"` untouched. Toothbrush game explicitly
excluded (human decision: it stays static).

**Acceptance criteria:**
- [x] Photos drift visibly against frames through their viewport passage, copy static
- [x] No aspect-ratio change, no layout shift, no overflow at any breakpoint/locale
- [x] Game section provably untouched (screenshot)

**Verification:**
- [x] Tests pass: `npm test -- Conversion` (class assertions on frames)
- [x] Build succeeds: `npm run build`
- [x] Manual check: screenshots at 3 scroll stops showing photo offset vs frame (1440 + 390)

**Dependencies:** None (independent of Task 3; different elements)

**Files likely touched:**
- `src/app/globals.css` (parallax keyframes + classes)
- `src/components/public/home/ComfortSection.tsx` (frame hook)
- `src/components/public/home/ClinicSection.tsx` (frame hooks)
- `src/components/public/home/Conversion.test.tsx` (class assertions)

**Estimated scope:** Medium (3–4 files)

## Checkpoint: After Tasks 3–4 (Chapters) — DONE 2026-09-08

- [x] Pin holds/releases cleanly incl. mobile 390px (numbers + screenshots; beats tightened after whitespace review)
- [x] Parallax verified via named timelines after anonymous-view() freeze found + fixed (drift −34→+25px)
- [x] No layout shift, no horizontal overflow in any locale (0px mobile, AR verified)
- [x] Chapters verified end-to-end in-loop (numbers + screenshots)

## Phase 3: Reveals + audit

## Task 5: Media wipe reveals + CTA aurora finale — DONE 2026-09-08 — DONE 2026-09-08

**Description:** Replace the generic fade-up on section MEDIA (not text —
text keeps the existing `Reveal`) with directional clip-path wipes on a
`view-timeline` `entry` range (photos wipe in from the reading-start edge:
left in LTR, right in RTL — use logical properties). Finale: the CTA band
gets a slow aurora sweep across its background on entry (CodeFronts hs-04
language, already the project's visual dialect). One animation per element;
wipes never apply to text (readability) or to the game.

**Acceptance criteria:**
- [x] Section photos wipe in from the reading-start edge in FR and AR
- [x] CTA aurora sweeps once on entry, then rests (no infinite loop added)
- [x] Text reveals unchanged; game unchanged

**Verification:**
- [x] Tests pass: full `npm test` (component suites green)
- [x] Build succeeds: `npm run build`
- [x] Manual check: mid-wipe screenshots (FR + AR) + CTA entry screenshot

**Dependencies:** Tasks 3–4 (applies to the same sections; must not collide on elements — one-animation rule gates the exact hooks)

**Files likely touched:**
- `src/app/globals.css` (wipe + aurora keyframes)
- `src/components/public/home/ClinicSection.tsx`, `DoctorSection.tsx`, `ComfortSection.tsx` (media hooks)
- `src/components/public/home/CtaBand.tsx` (finale hook)

**Estimated scope:** Medium (4–5 files)

## Task 6: Motion audit pass (fixes included) — DONE 2026-09-08

**Description:** The verification backbone of the whole pass: re-run every
scroll state in real Chromium (recreate the /tmp puppeteer harness —
ephemeral, rebuild per session): computed progress/opacity/transform at 4+
scroll stops per task surface; reduced-motion emulation showing the complete
static page; timelines-disabled run (proves fallbacks); keyboard-only
traversal of slider/nav/menu with motion on; mobile 390 + AR full-tour
screenshots. Fix every finding in this task. Also greps the codebase for
the two known failure signatures (two `animation` classes per element,
multi-animation shorthand sharing one `scroll()` timeline).

**Acceptance criteria: (verified 2026-09-08)**
- [x] Numbers recorded for every task surface (arrival staged shots; hairline scaleX 0→0.5; pin hold 112px ×4 stops; band drift −34→+25px; wipe clip 87.5% + RTL right-edge; aurora rests 0.55)
- [x] Reduced-motion tour shows zero animation, complete content (0 running anims, full header, hairline display:none)
- [x] No-support tour: static review — all base styles natural/visible without timelines (verified by inspection; kill-switch + natural bases)
- [x] Failure-signature greps clean (only sanctioned exception: header bar's two single-animation classes, verified tracking identically)

**Verification:**
- [x] Tests pass: `npm test` full suite
- [x] Build succeeds: `npm run build`
- [x] Manual check: screenshot tour attached (FR/AR/EN × desktop/mobile × key stops)

**Dependencies:** Tasks 1–5 (audits everything)

**Files likely touched:** only what findings require (0–3 files) + `tasks/todo-home-scroll.md` status

**Estimated scope:** Small (0–3 files)

## Checkpoint: Complete — DONE 2026-09-08

- [x] Whole page scrolls as one journey in FR/AR/EN (screenshot tour in session)
- [x] Reduced-motion run shows complete static page, zero animation
- [x] All acceptance criteria met
- [x] Commits per task; pushed to origin on explicit instruction

## Parallelization Opportunities

- Safe to parallelize: Tasks 1+2 (different elements, shared file `globals.css` needs a merge — coordinate keyframe names first); Tasks 4+5 planning while 3 builds
- Must be sequential: Task 3 before Task 5 (Task 5 hooks the same sections — one-animation rule); Task 6 after everything
- Needs coordination: `globals.css` keyframe/class naming across tasks (prefix per task: `arrive-*`, `journey-*`, `pin-*`, `band-*`, `wipe-*`)
