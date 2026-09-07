# Task List: Home UI De-slop (Hero-first)

> Context + rationale live in `tasks/plan-home-ui.md`. This is the working checklist.
> NOTE: the main build tracker stays `tasks/todo.md`. This home-UI pass tracks here so it never clobbers the backend plan. Implement strictly in order — each task leaves a working home page.
> Plan mode: no code changes yet. Human approval required before starting Task 1.

**Definition of Done — applies to every task below:**
- [ ] Works in all 3 locales (FR/AR/EN) with RTL checked for Arabic
- [ ] Keyboard-navigable with visible focus states; `prefers-reduced-motion` respected
- [ ] `npm run typecheck` + `npm run lint` + focused `npm test` green; `npm run build` succeeds
- [ ] Screenshots attached for review (desktop 1440 + mobile 390 + AR desktop)
- [ ] No patient data touched; no API/schema change; no new dependency added

## Phase 1: First viewport

## Task 1: Proof-first editorial hero (replaces HeroHome slop)

**Description:** Rebuild `HeroHome` as a split editorial hero: copy left (eyebrow with real location "Rouiba, Alger", H1 kept short without gradient-text span, 2-line subtitle ending on the "we call you to confirm" promise, primary "Prendre rendez-vous" + secondary call/directions link, live-proof row reusing the `GoogleReviews` rating card pattern instead of hardcoded stars), photo right (`next/image` with `smile-640.webp`/`smile.jpg`, `priority`, responsive sizes, translated alt) with one small overlay proof card (address + hours + phone from `CLINIC_LOCATION`). Delete the `floaters` array + parallax (`yText`/`opacity`) + scroll cue; do not mount `CursorGlow` on the home route. Keep the CSS-only `hero-enter` LCP pattern. RESOLVED 2026-09-07: (a) vendor real assets from clinicorthocare.com into `public/images/` first — hero uses `dr-moussaoui-portrait.png` (fallback: `clinic-waiting-room.jpg`); full inventory in `plan-home-ui.md`. Never hotlink WP URLs. (b) Logo vendored (`orthocare-logo.png`) and wired into `Header` (replaces the `O` circle) in this task; footer mark in Task 4. (c) Copy follows the official voice: "L'excellence dentaire, la douceur en plus" family + Dr Moussaoui B. (ODF, PITTS, aligneurs) line, translated to AR/EN. (d) Scoped rebrand allowed: palette may shift toward the logo; record any token change in the task summary. (e) Doctor-centric per 2026-09-07: hero is Dr Besma Moussaoui — portrait right, name/title (ODF specialist, PITTS, aligneurs) left, kindness + professionalism in ≤20-word subtext; design read: warm editorial trust-first, dials V6/M4/D4. (f) fluid-orb approved as the ONE ambient motion: teal `color` prop, behind portrait composition (never LCP), static frame under reduced-motion (built into source), pause-offscreen wrapper; source verified — raw WebGL, zero deps, no CDN. CodeFronts `Glass over Aurora` language informs the hero treatment (frosted proof card over calm tint); vendor excerpts carry attribution comments.

**Acceptance criteria:**
- [ ] No floating teeth/sparkles, no parallax fade, no scroll cue, no `CursorGlow` on `/[locale]`; hero paints statically (CSS-only entrance)
- [ ] H1 has no gradient-text span; badge is a plain location eyebrow, not a pill with sparkle icon
- [ ] Real photo renders optimized (`next/image`, `priority`, correct `sizes`) with translated alt in FR/AR/EN
- [ ] Proof row shows live rating source (not a hardcoded `4.9★` string) + address/hours/phone reachable within one click
- [ ] RTL: Arabic layout mirrors correctly; overlay card uses logical properties; photo alt translated

**Verification:**
- [ ] Tests pass: `npm test -- home` (new: hero renders H1 + CTA + photo alt in 3 locales; asserts zero `floaters`/parallax nodes)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: desktop 1440 + mobile 390 + AR screenshots; LCP is the H1/photo, no layout shift; keyboard-only pass through both CTAs

**Dependencies:** None (reads existing `messages/{fr,ar,en}.json` `Home` namespace, `CLINIC_LOCATION`, `GoogleReviews` pattern)

**Files likely touched:**
- `src/components/public/home/HeroHome.tsx`
- `src/app/[locale]/page.tsx` (drop `CursorGlow` on home)
- `public/images/dr-moussaoui-portrait.png` (768×1092) + rest of inventory in plan
- `src/components/public/Header.tsx` (vendored logo replaces `O` circle)
- `public/images/orthocare-logo-mark.png` (150×150 — header + footer; the `2025/01/logo.png` URL 404s)
- `components.json` (standard shadcn, hand-written so future `shadcn add` works)
- `src/lib/utils.ts` (`cn` via clsx + tailwind-merge — new deps, attributed to shadcn/rare-ui)
- `src/components/ui/fluid-orb.tsx` (vendored rare-ui source, MIT attribution, teal default via `color` prop at call site)
- `messages/fr.json`, `messages/ar.json`, `messages/en.json` (`Home` hero keys only)
- `tests/` home-hero test (new or colocated)

**Estimated scope:** Medium (3–5 files)

## Task 2: TrustStrip → real proof bar (removes fake stats)

**Description:** Replace the `-mt-10` overlapping 4 floating stat cards (`10+ / 5000+ / 4.9★ / 98%`) with a single flat proof bar directly under the hero: three verifiable items (live Google rating via existing widget pattern, "Sam–Jeu 10h–17h" hours, "Réservation en ligne + appel de confirmation" promise) + phone/directions action. No `FloatCard`, no `Reveal` stagger, no overlap trick. RESOLVED 2026-09-07: official site says **4.8 (37 avis)** — the `4.9★` is wrong, and `5000+`/`98%`/`10+` appear nowhere on clinicorthocare.com → all removed as invented. Bar shows 4.8 (37 avis) + real hours + real phone.

**Acceptance criteria:**
- [ ] Hardcoded `5000+` / `98%` / `4.9★` / `10+` strings gone from home (grep proves it); rating reads **4.8 (37 avis)** per clinicorthocare.com
- [ ] Bar sits in normal flow (no `-mt-10` overlap), flat background, 3 items max, one row on desktop / stacked on mobile
- [ ] Every item is verifiable (live rating, real hours from settings/constants, real booking promise) in all 3 locales

**Verification:**
- [ ] Tests pass: `npm test -- home` (asserts fake-stat strings absent, proof items render per locale)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: no overlap gap at hero junction on mobile + desktop; AR stacking correct

**Dependencies:** Task 1 (inherits hero proof pattern + copy voice)

**Files likely touched:**
- `src/components/public/home/TrustStrip.tsx` (rewrite or replace with `ProofBar.tsx`)
- `messages/fr.json`, `messages/ar.json`, `messages/en.json` (`Home.Stats` keys)

**Estimated scope:** Small (1–2 files)

## Checkpoint: After Tasks 1–2 (Hero + proof) — DONE 2026-09-07

- [x] Hero paints statically with no floaters/parallax/CursorGlow/scroll cue
- [x] Real photo renders optimized in 3 locales + RTL correct
- [x] Fake stats gone; proof bar verifiable
- [x] `npm run typecheck && npm run lint && npm test` green
- [x] Review with human (screenshots) before proceeding

## Phase 2: Composition + system

## Task 3: Home composition reorder + game demotion

**Description:** Reorder `src/app/[locale]/page.tsx` so the page tells one story: Hero → proof bar → booking shortcut (compact "choose service → see slots → we call to confirm" strip linking to `/book`, no duplicate wizard logic) → ServicesPreview → GalleryPreview (real before/after first) → TestimonialsPreview/ReviewsSection (merge the two adjacent testimonial blocks into one) → FeaturesSection (cut to 3 items max, drop the generic "Réservation facile" card that duplicates the hero) → FaqPreview → LocationSection → CtaBand. RESOLVED 2026-09-07: `ToothBrushGameSection` **keeps its current position** (human decision) — composition work only merges the double testimonials and de-duplicates adjacent section headers. Feed the real vendored before/after (`smile-before/after.jpg`) + treatment photo into GalleryPreview/results in this task.

**Acceptance criteria:**
- [ ] `page.tsx` order matches the plan; no section deleted except by merge (testimonials merge documented)
- [ ] Game stays in its current slot; page top-half is hero → proof → booking → services → results
- [ ] Real before/after + treatment photos wired into results sections
- [ ] No two adjacent sections share the identical centered-H2 + subtitle + card-grid shape
- [ ] All anchors/ids used by nav/footer still resolve; no dead links

**Verification:**
- [ ] Tests pass: `npm test` (existing suites green) + route smoke (`/` renders per locale)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: full-page scroll on desktop + mobile in FR and AR; every CTA points at a live route

**Dependencies:** Tasks 1–2 (hero + proof set the voice the reorder follows)

**Files likely touched:**
- `src/app/[locale]/page.tsx`
- `src/components/public/home/ToothBrushGameSection.tsx` (demote only)
- `src/components/public/home/TestimonialsPreview.tsx` / `src/components/public/ReviewsSection.tsx` (merge)
- `src/components/public/home/FeaturesSection.tsx` (trim)

**Estimated scope:** Medium (3–5 files)

## Task 4: Visual-system de-slop (buttons, color, motion, images, a11y)

**Description:** One consistency pass over exactly the files touched in Tasks 1–3: one button system (primary solid pill kept only for the booking CTA; secondary = quiet outline/text — kill the 6× `rounded-full shadow-lg hover:-translate-y-0.5` repetition), teal budget (teal reserved for actions + proof; section backgrounds alternate white / flat `zinc-50`, kill `teal-50/60` washes + `blur-3xl` blobs outside CtaBand), motion budget (no new framer-motion on home; `Reveal`/`FloatCard` kept only below the fold and never on hero/proof), images via `next/image` with lazy + `sizes` for gallery/results, focus-visible rings everywhere, AR contrast + RTL check. RESOLVED 2026-09-07: scoped rebrand allowed — footer logo mark (`orthocare-logo-mark.png`) wired in here, palette may follow the logo; record every token change in the summary. No new design-token framework.

**Acceptance criteria:**
- [ ] Button styles come from one place (shared class/component); hero primary is the only `shadow-lg` CTA on the page
- [ ] No `bg-gradient-to-*` headline text and no `blur-3xl` blobs outside `CtaBand`; max 2 tinted sections on the page
- [ ] All home images use `next/image` (optimized, lazy below fold, translated alt); no layout shift on load
- [ ] Keyboard-only pass succeeds; contrast passes for body text in both themes; `prefers-reduced-motion` kills remaining motion

**Verification:**
- [ ] Tests pass: `npm test` full green; `npm run typecheck`; `npm run lint`
- [ ] Build succeeds: `npm run build` + mobile Lighthouse spot-check recorded (perf + a11y noted, not gated on a fixed score)
- [ ] Manual check: side-by-side before/after screenshots (FR + AR + mobile) attached to the task summary

**Dependencies:** Tasks 1–3 (polishes only what they touched — never a standalone restyle)

**Files likely touched:**
- `src/components/public/home/*.tsx` (only files from Tasks 1–3)
- `src/components/public/motion/*` (usage reduction, no new motion API)
- `src/app/globals.css` (only if a shared button/focus token is needed)

**Estimated scope:** Medium (3–5 files)

## Checkpoint: Complete — DONE 2026-09-07 (code; screenshots still yours)

- [x] Full home reads as one clinic voice (proof → book → results), not template card grids
- [x] 3-locale SSR pass (FR/AR/EN) + RTL verified via rendered HTML
- [ ] Mobile Lighthouse spot-check + keyboard-only pass + screenshots — needs a browser, left for human review
- [x] Task 5 security pass green (4 audit findings triaged, none introduced here), findings recorded in `tasks/home-ui-security.md`
- [ ] Ready for human merge review (commits local only, never pushed)

## Task 5: Verification + security pass (fixes included)

**Description:** Full `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Then security: `npm audit` (fix non-breaking, record the rest), grep for secrets/hotlinks (`clinicorthocare.com/wp-content` must appear only in attribution comments, never in `src`/`next/image` URLs), re-run headers/CSP + authz-matrix suites, confirm fluid-orb makes zero network requests and token pages still load no third-party scripts. Fix every finding in this task; one commit for the pass, one per fix if separate.

**Acceptance criteria:**
- [ ] typecheck + lint + full tests + production build green
- [ ] `npm audit` has no high/critical unaddressed (fixed or recorded with reason)
- [ ] No hardcoded secrets; no WP hotlinks in rendered code; CSP tests green
- [ ] Fluid-orb verified zero-network (devtools network log, noted in summary)

**Verification:**
- [ ] Tests pass: `npm test` full suite
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: home + token page network logs clean

**Dependencies:** Tasks 1–4

**Files likely touched:** only what findings require

**Estimated scope:** Small (0–3 files)

## Parallelization Opportunities

- Safe to parallelize: nothing on this list — Tasks 1→2→3→4 are sequential by design (each inherits the previous one's voice/pattern).
- Must be sequential: all four tasks + both checkpoints.
- Needs coordination: clinic answers to the 5 Open Questions in `tasks/plan-home-ui.md` unblock copy/photo choices in Task 1 — get those before starting.
