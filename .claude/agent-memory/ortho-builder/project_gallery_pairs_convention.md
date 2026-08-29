---
name: project-gallery-pairs-convention
description: prisma/seed.ts gallery items use zero-padded keys (g01..g12) with 3 before/after pairs on consecutive keys, relied on by the gallery page layout
metadata:
  type: project
---

`prisma/seed.ts` seeds 12 `GalleryItem` rows with zero-padded keys `g01`..`g12`
so `orderBy: { key: "asc" }` gives a stable, intentional order. Three pairs of
consecutive keys are "before/after" comparisons of the same treatment (as of
2026-08-27: g01/g02 whitening, g05/g06 incisor alignment, g09/g10 restoration),
each caption explicitly containing the words before/after (or قبل/بعد) in all
three locales.

`src/app/[locale]/gallery/page.tsx` detects these pairs at render time by
regexing the localized caption text for before/after markers on two adjacent
items (function `groupIntoBlocks`), and renders them as one wide side-by-side
comparison card instead of two separate tiles. It never re-sorts the array —
detection only groups items that are already adjacent from the DB query.

**Why:** keeps the pairing resilient to future caption edits without hardcoding
key names in the UI layer, and avoids adding a schema field (`pairId` or
similar) that would need a migration against the shared production Neon DB.

**How to apply:** if the seed data's caption wording changes (e.g. drops the
literal "avant"/"après"/"before"/"after"/"قبل"/"بعد" words), the pairing in the
gallery page will silently stop grouping — check `BEFORE_MARKERS`/
`AFTER_MARKERS` in `page.tsx` if pairs stop rendering as comparison cards.
Related: [[project-public-content-cache]] for the `orderBy` that makes this
ordering deterministic in the first place.
