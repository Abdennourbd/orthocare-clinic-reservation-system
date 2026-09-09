# Task List: ClinicSection Revamp ("three moments" editorial)

Details + rationale live in `tasks/plan-clinic-revamp.md`. Strictly sequential — each task leaves a working homepage. **Review gate waived by explicit instruction ("execute it directly"); checkpoints are verified with screenshots instead of questions.**

**Definition of Done — applies to every task below:**
- [ ] Works in FR/AR/EN with RTL checked for Arabic
- [ ] Keyboard-navigable with visible focus states; `prefers-reduced-motion` shows complete static content
- [ ] `npm run typecheck` + `npm run lint` + focused `npm test` green; `npm run build` succeeds
- [ ] Screenshots attached (desktop 1440 + mobile 390 + AR)
- [ ] No API/schema change; no new dependency; no patient data touched
- [ ] Small commits with minimal messages, local only — never pushed

## Phase 1: Rebuild

## Task C1: Editorial restructure + trilingual copy — DONE 2026-09-09 — DONE 2026-09-09

**Description:** Rewrite `ClinicSection.tsx` as a `zinc-50` band with three alternating photo/text rows (01 waiting room → 02 reception → 03 equipment), each with a moment title + one benefit line, numerals echoing `SmileResults` beats, and a closing Book + About (`/about`, reused `doctorAboutCta`) CTA row. Keep the same 3 photos with `band-photo` parallax untouched. Add 7 i18n keys (`clinicEyebrow`, `clinicStep{1,2,3}Title/Desc`) and refresh `clinicTitle`/`clinicDesc` values in FR/AR/EN; `clinicCap1-3` stay as photo alts.

**Acceptance criteria:**
- [ ] Rows alternate sides on desktop, stack photo-then-text on mobile, with zero horizontal overflow at 390px in all locales
- [ ] Every new key exists in FR/AR/EN; no dead keys (`clinicCap*` still used as alts)
- [ ] Parallax still hooked (`band-photo` on all 3 images, `band-frame` on frames)
- [ ] Both CTAs resolve to live routes with visible focus states

**Verification:**
- [ ] Tests pass: `npm test -- Conversion` (updated in C2)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: desktop + mobile + AR screenshots read as alternating editorial, not a grid

**Dependencies:** None

**Files likely touched:**
- `src/components/public/home/ClinicSection.tsx`
- `messages/fr.json`, `messages/ar.json`, `messages/en.json`

**Estimated scope:** Medium (4 files)

## Task C2: Test update + static verification — DONE 2026-09-09 — DONE 2026-09-09

**Description:** Update the `ClinicSection` block in `Conversion.test.tsx` (it asserts the old captions) to the new moment titles/copy and CTA links; run typecheck + lint + focused suites; take first screenshots and fix static issues (overflow, wrapping, alt text) before the full audit.

**Acceptance criteria:**
- [ ] Test asserts the three moment titles, the two CTA links, and the three parallax images
- [ ] `npm run typecheck`, `npm run lint` (0 errors), `npm test -- Conversion` green

**Verification:**
- [ ] Tests pass: `npm test -- Conversion`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: first screenshots attached, no layout breakage

**Dependencies:** C1

**Files likely touched:**
- `src/components/public/home/Conversion.test.tsx`

**Estimated scope:** Small (1 file)

## Checkpoint: Rebuilt

- [ ] New shape renders in FR/AR/EN, no overflow at 390px
- [ ] Typecheck + lint + focused tests green
- [ ] Screenshots self-reviewed against the plan diagnosis

## Phase 2: Audit

## Task C3: Browser audit + polish loop + full gate — DONE 2026-09-09 (verified: EN/AR × 1440/390, alternating rows, RTL mirror, zero overflow, console clean for this section, 1187 tests green, build clean; no findings requiring code changes)

**Description:** Real-Chromium audit over `/fr`, `/ar`, `/en` × desktop + mobile 390: full-section screenshots, keyboard-only pass through both CTAs, contrast check on zinc-50, reduced-motion static run, failure-signature grep (double-animation). Fix every finding with small minimal-message commits (local only, never pushed); close with full `npm test` + `npm run build`.

**Acceptance criteria:**
- [ ] Screenshots prove distinct shape, readable copy, working CTAs in all locales
- [ ] Keyboard-only pass succeeds with visible focus; contrast passes on zinc-50
- [ ] Reduced-motion run shows complete static content
- [ ] Every finding fixed, one small commit per fix, none pushed

**Verification:**
- [ ] Tests pass: `npm test` full suite
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: screenshot tour attached to the final summary

**Dependencies:** C2

**Files likely touched:** only what findings require (0–3 files)

**Estimated scope:** Small (0–3 files)

## Checkpoint: Complete

- [ ] Section reads as one clinic voice, distinct from every neighbor
- [ ] Reduced-motion shows complete static content
- [ ] Full suite + build green
