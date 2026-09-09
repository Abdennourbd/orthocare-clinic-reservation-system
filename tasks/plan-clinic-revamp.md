# Implementation Plan: ClinicSection Revamp ("three moments" editorial)

## Overview

Rebuild the homepage `ClinicSection` ("A clinic where you feel at ease") from a static 3-photo caption grid into a "three moments" alternating editorial: numbered moments (01 arrive somewhere calm → 02 met by a smiling team → 03 treated with modern tools), each pairing one real clinic photo with one patient-benefit line, closing with Book + Discover-the-clinic CTAs. Same 3 photos, same parallax system, flat `zinc-50` band so it stops blending into its white neighbors. Copy ships in FR/AR/EN.

Spec context: project spec `tasks/plan.md`; conversion rationale `tasks/home-conversion.md` (ClinicSection answers *"is it clean and modern?"*); motion language `tasks/plan-home-scroll.md` (parallax bands, one-animation-per-element, kill-switch). Codebase read (plan mode, no code changed): `ClinicSection.tsx` (68 lines, 3-col grid + `band-photo` parallax + caption bars), `ComfortSection.tsx` (frosted-caption pattern, teal band — not reused here), `LocationSection.tsx` (owns address/hours/map — this revamp must NOT duplicate those facts), neighbor backgrounds (game plain, testimonials white, features teal-50/60), `Conversion.test.tsx` (ClinicSection test asserts current captions — must be updated), `messages/{fr,ar,en}.json` (`Home.clinic*` keys).

> **File-note:** the request said `tasks/plan.md` / `tasks/todo.md`, but those hold the whole-project plan (Tasks 1–23); repo convention is one `tasks/plan-<feature>.md` + `tasks/todo-<feature>.md` pair per feature. This plan lives here with its list in `tasks/todo-clinic-revamp.md`.
> **Review gate:** the skill requires human plan approval, but the requester explicitly instructed *"don't ask me anything, execute it directly"* — approval is taken as given by instruction; the plan below is followed strictly and every checkpoint is verified with screenshots instead of questions.

## Architecture Decisions

- **Alternating editorial rows, not another grid or rail.** The page already has 3-col grids (services, features), rails (testimonials, cases), a centered promise (comfort) and a pinned split (results). Alternating photo/text rows exist nowhere else on the page — the one shape that is both new here and proven elsewhere (hero split, detail pages).
- **`zinc-50` flat band.** White neighbors above (game, testimonials) and below make the current white section invisible; teal tints are budget-capped (comfort, features, location already spend it). Neutral `zinc-50` alternation is explicitly allowed by the home-ui system and needs no new token.
- **Meaning per row, not labels.** Each caption becomes a moment: title (what happens) + one benefit line (why it matters to an anxious patient). No address/hours repetition (LocationSection owns those), no fear copy (ComfortSection owns that).
- **Numbered 01/02/03 moments.** Echoes the `SmileResults` beat numerals — one voice across the page, zero new components (local `BeatNumeral`-style element, teal-600, aria-hidden).
- **Keep `band-photo` parallax exactly as-is.** Same images, same frames, same calm ±6% drift; text enters via existing `Reveal`. Figures may additionally carry `wipe-media` (their `band-frame` class only names a timeline — no animation — so the one-animation rule still holds).
- **CTAs close the section.** Primary "Prendre rendez-vous" (existing `Home.cta`) + secondary "Découvrir la clinique" → `/about` (existing `Home.doctorAboutCta` key, reused — no dead-end section anymore).
- **i18n: reuse `clinicTitle`/`clinicDesc`/`clinicCap1-3` keys with new values; add 7 keys** (`clinicEyebrow`, `clinicStep{1,2,3}Title/Desc`) in FR/AR/EN. `clinicCap*` stay on as photo `alt`s so no key goes dead.

## Dependency Graph

```
messages/{fr,ar,en}.json (7 new keys + 5 new values)
    │
    └── Task C1: ClinicSection rewrite (alternating rows, numerals, CTA row, parallax kept)
            │
            ├── Task C2: test update (new captions) + typecheck/lint + first screenshots
            │       │
            │       └── Task C3: screenshot audit FR/AR/EN × desktop/mobile + polish loop + full suite/build
```

Single component + messages + test. Strictly sequential, each step leaves a working homepage.

## Task List

### Phase 1: Rebuild

- [ ] Task C1: Editorial restructure + trilingual copy
- [ ] Task C2: Test update + static verification

### Checkpoint: Rebuilt

- [ ] New shape renders in FR/AR/EN, no overflow at 390px
- [ ] Typecheck + lint + focused tests green
- [ ] Screenshots (desktop + mobile + AR) self-reviewed against the diagnosis below

### Phase 2: Audit

- [ ] Task C3: Browser audit + polish loop + full gate (small commits, never pushed)

### Checkpoint: Complete

- [ ] Section reads as one clinic voice, distinct from every neighbor
- [ ] Reduced-motion shows complete static content
- [ ] Full suite + build green, screenshots attached to summary

## Diagnosis of the current section (what "better" means)

| Problem | Evidence | Fix in C1 |
|---|---|---|
| Same shape as everywhere (H2 + subtitle + 3-col grid) | `ClinicSection.tsx:35-65` vs services/features grids | Alternating rows, numbered moments, zinc-50 band |
| Captions label photos instead of meaning anything | "Calm waiting room" / "A warm welcome" describe pixels | Title (what happens) + benefit line (why it matters) per row |
| Dead end — no CTA, answers nothing actionable | No link in the section; location facts live two screens down | Book + About CTAs close the section |
| Invisible between white neighbors | Game plain → clinic white → testimonials white | Flat zinc-50 band |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Alternating rows feel like SmileResults repetition | Med | Numerals echo deliberately (one voice); layout (stacked rows, band bg, CTA close) differs from the pinned split |
| My AR translations sound off | Med | Short, plain sentences; clinical terms reused from existing AR keys; screenshots reviewed |
| Wipe + parallax on one figure janks | Low | Different elements (clip on figure, translate on img); drop the wipe at the first sign of trouble — parallax alone is the safe base |
| Caption-key churn orphans strings | Low | `clinicCap*` kept as alts; full-suite + grep verify no dead/missing keys |

## Open Questions

None — decided by instruction (no questions asked): zinc-50 band, three moments, Book + About close, parallax kept. If the human dislikes the direction on sight, the whole change is one component + messages (trivially revertable per-commit).

## Parallelization Opportunities

None — strictly sequential (one component, one author, one browser).
