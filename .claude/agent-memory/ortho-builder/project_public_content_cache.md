---
name: project-public-content-cache
description: unstable_cache in src/lib/public/content.ts had no revalidateTag call anywhere in the codebase, causing a 1h-stale gallery/faq/testimonial cache after db:seed
metadata:
  type: project
---

`src/lib/public/content.ts` wraps `listActiveFaqItems`, `listActiveTestimonials`,
`listActiveGalleryItems` in `unstable_cache` with `tags: [...]` and
`revalidate: 3600`, but as of 2026-08-27 nothing in the repo calls
`revalidateTag(...)` for those tags (`grep -rn "revalidateTag" src prisma scripts`
was empty) — there is no back-office yet to trigger it. Fixed (2026-08-27): the
three functions are only wrapped in `unstable_cache` when
`process.env.NODE_ENV !== "development"`; in dev they run raw so `db:seed`
changes show up immediately. Also added `orderBy: { key: "asc" }` to all three
queries — none had any `orderBy` before, so Postgres could return rows in an
arbitrary/unstable order across re-seeds.

**Why:** without `revalidateTag`, an hour-long stale/empty cache result made
the dev environment lie about what was actually in the database — very
confusing while iterating on seed data. `revalidate: 0` is NOT valid for
`unstable_cache` (throws — see `node_modules/next/dist/server/web/spec-extension/unstable-cache.js:38-43`), so the fix must be a NODE_ENV branch, not a TTL tweak.

**How to apply:** the real long-term fix (a `sortOrder` field + `revalidateTag`
call from a future back-office) needs a schema migration and belongs to a later
task (Task 12 area) — don't add it opportunistically; production DB is the only
Neon instance available so migrations there are high-stakes. If you touch
`content.ts` again, keep the dev/prod branch pattern.
