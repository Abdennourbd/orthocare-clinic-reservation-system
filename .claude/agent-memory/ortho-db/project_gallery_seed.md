---
name: project-gallery-seed
description: GalleryItem seed conventions (12 rows, zero-padded keys g01..g12, consecutive before/after pairs, deliberately heavy images) and the enumerated g1..g6 cleanup that must never become a prefix filter
metadata:
  type: project
---

`prisma/seed.ts` section 8 seeds 12 `GalleryItem` rows reusing only the three
files in `public/images/` (two of them ~2.8 MB). Placeholders for real clinic
photos.

**Why:** the user wants /gallery visually checkable *and* wants to weigh the page
on a slow connection, so duplicate heavy images are intentional, not an
oversight. Two conventions are load-bearing and easy to break:
- Keys are **zero-padded** (`g01`…`g12`). The gallery is ordered by `key` as a
  string; unpadded, `g10` sorts between `g1` and `g2`. Any new item must keep the
  padding — and a 100th item would force a re-pad of the whole set.
- Before/after pairs sit on **consecutive** keys (g01/g02, g05/g06, g09/g10)
  because the UI renders neighbours side by side. Never insert an item between a
  pair.

**How to apply:** do not "fix" the image duplication or swap in lighter images.
Captions are trilingual `{fr, ar, en}` with real Arabic and must identify nobody
(no name, age or recognisable detail) — same bar as testimonials/FAQ. Known
separate work: `src/app/[locale]/gallery/page.tsx` and
`src/components/public/home/GalleryPreview.tsx` use raw `<img>` instead of
`next/image` — out of scope unless asked. See [[env-database-targets]].

**Legacy rows (2026-08-27):** the shared Neon database still holds six rows from
the pre-padding generation of this seed, keyed `g1`…`g6`. Section 8 now opens
with a `deleteMany` on that explicit six-key list, because `upsert` can never
reach rows whose key shape changed. That list must stay enumerated: any
`startsWith`/`contains` filter on `"g"` would also match `g01`…`g12`. The
cleanup already exists — do not add a second one; it becomes a no-op once the
user has run `npm run db:seed` against Neon.
