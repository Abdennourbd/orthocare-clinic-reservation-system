# Implementation Plan: Gallery → Real Patient Before/After Cases

## Overview

Repurpose the public gallery (`src/app/[locale]/gallery/page.tsx`) from a generic photo grid (current `GalleryItem`: single image + caption, before/after faked by caption-text pairing in `src/lib/public/galleryBlocks.ts`) into **real patient case showcases**: each case has a **before photo, an after photo, an interactive before/after slider**, and a **detail view with more pictures of that patient**. Everything is **admin-controlled**: in the dashboard the admin selects which cases appear, sets the patient label, the before/after images and the extra pictures, and can add or remove cases at any time.

Spec context: the project-wide spec lives in `tasks/plan.md` (Ortho'Care Clinic website, Next.js + Prisma + Vercel Blob). There is no gallery-specific SPEC file, so this document is the spec + plan for this feature. Codebase sections read (plan mode, no code changed): `prisma/schema.prisma` (`GalleryItem` model), `prisma/seed.ts` (gallery seed), `src/schemas/content.ts` (gallery Zod schemas), `src/lib/public/content.ts` + `galleryBlocks.ts`, `src/app/[locale]/gallery/page.tsx`, `src/components/public/home/GalleryPreview.tsx`, `src/components/admin/content/GalleryTab.tsx`, `src/app/api/admin/gallery/*` routes, documents upload route (Blob pattern reference), `messages/*.json` (GalleryPage strings), `package.json`.

> **File-note:** the skill instruction says to save to `tasks/plan.md` / `tasks/todo.md`, but those files already hold the whole-project plan and checklist. Overwriting them would destroy project history, so this feature plan lives in `tasks/plan-gallery.md` and its task list in `tasks/todo-gallery.md`.

## Architecture Decisions

- **No link to `Patient` rows.** Gallery cases are public; `Patient` records are health data (names, phones, notes — never in logs, URLs, or public pages). The admin "selects the patient" by typing a **display label / pseudonym** (e.g. "Patient A · 24 ans"), never by picking a `Patient` row. No FK to `Patient`. Rationale: keeps the public surface free of health-data leakage by construction, avoids audit-trail complexity, and matches the seed rule that no real patient detail ever lands in code.
- **Explicit consent gate.** Every case carries `consentConfirmed` (bool) + `consentAt`. The admin create/edit form requires checking "written patient consent obtained" before a case can be `active`. A case without consent can be saved as draft (inactive) but never published. Rationale: real patient photos are the most sensitive content on the public site.
- **Free-text title + description per case (trust-building goal).** The whole point of the page is gaining the visitor's trust ("this patient had this problem, we treated it with that"). So each case carries a **`title`** (e.g. "Encombrement sévère — 18 mois d'orthodontie") and a **`description`** (what the patient had, how it was treated, procedure notes), both as per-locale JSON (`{fr, ar, en}`, FR required) read via `localized()`. The admin types whatever they want; extras can show procedure steps. No structured age/treatment fields.
- **Admin-chosen home features (2–4 cases).** `SmileCase.featured` (bool) + `featuredOrder` (int). The admin marks up to **4** cases as featured; the API rejects featuring a 5th. The home preview renders the featured cases in order (fallback: latest active cases if none featured yet). Below them a CTA button: FR "Voir plus de cas — trouvez un patient qui avait le même problème que vous" (AR/EN equivalents in messages).
- **Old gallery deleted (human decision).** The 12 synthetic `GalleryItem` rows are deleted and the model, its API routes, admin tab, seed block and `galleryBlocks` helper are removed in the final task — clean cutover, no legacy path left behind.
- **Per-locale JSON fields, same convention as the rest of the project.** `title`, `description`, extra captions stored as `{fr, ar, en}` JSON, read via the existing `localized()` helper with FR fallback.
- **Image storage: Vercel Blob public + URL-paste (human decision: both).** Mirror the `src/lib/documents/` upload pattern (`lib/gallery/blobStorage.ts`, byte-level MIME validation, size cap) but with `access: "public"` — gallery images must render inline on a public page (unlike private patient documents). The URL-paste option (`/images/…` or https) stays, so the admin can reuse already-hosted photos. Allow-list: JPEG, PNG, WebP; cap ~5 MB per image; **max 8 extras per case** (human decision), enforced in Zod + API.
- **Custom slider, no new dependency.** New `BeforeAfterSlider` client component: two layered `next/image`s, top layer clipped via `clip-path: inset()`, draggable divider with Pointer Events (mouse + touch), keyboard support (Arrow keys move the handle), RTL-aware. `framer-motion` is already available for the reveal animation; the slider itself is plain React.
- **Detail page over modal.** New route `/[locale]/gallery/[key]`: big slider + treatment info + extra-pictures grid. Rationale: shareable link, SEO (`pageMetadata` like the gallery index), works without JS for the images themselves; a modal would add focus-trap complexity.
- **Cache: same tag pattern as today.** New fetchers in `src/lib/public/content.ts` (`listActiveSmileCases`, `getSmileCaseByKey`) wrapped in `unstable_cache` with a `gallery` tag; admin writes call `revalidateTagSafe("gallery")`, exactly like the current gallery routes.
- **ADMIN-only, like current gallery CRUD.** Gallery content management is already ADMIN-only; cases stay ADMIN-only (receptionist blocked), audited via `logActionSafe` with `SETTINGS_UPDATED` (existing enum — no migration needed), rate-limited with the existing content limits, and added to `tests/authz-matrix.test.ts`.

## Dependency Graph

```
Prisma schema (SmileCase + SmileCaseImage) + migration + seed
    │
    ├── Zod schemas (src/schemas/case.ts or content.ts) — title/description, max 8 extras, max 4 featured
    │       │
    │       ├── Admin API (CRUD + upload + featured cap) ──► authz-matrix rows + integration tests
    │       │       │
    │       │       └── Admin UI (cases dashboard: title/desc, before/after, extras, featured pick, visibility)
    │       │
    │       └── Public fetchers (listActiveSmileCases, listFeaturedCases, getSmileCaseByKey) + cache tag
    │               │
    │               ├── BeforeAfterSlider component
    │               │       │
    │               │       └── Gallery index rework (case cards with sliders + "same problem as you" CTA)
    │               │
    │               └── Case detail page (/gallery/[key] + extras grid)
    │                       │
    │                       └── Home preview (admin-featured 2–4) + GalleryItem deletion
    │
    └── i18n strings (messages/fr|ar|en.json — GalleryPage + new CasePage)
```

Implementation order follows the graph bottom-up, sliced vertically so each task leaves a working system.

## Task List

### Phase 1: Foundation + admin backbone

- [ ] Task G1: Schema, migration, seed, public fetchers
- [ ] Task G2: Admin API (CRUD + image upload)

### Checkpoint: Foundation

- [ ] Migration applies cleanly on dev; seed creates 3 synthetic cases
- [ ] `npm test` green (new suites), `npm run typecheck` + `lint` clean
- [ ] Authz-matrix covers all new routes (admin 200, receptionist/anon blocked)
- [ ] Review with human before proceeding

### Phase 2: Admin control + public experience

- [ ] Task G3: Admin UI — case management (title/desc, before/after, extras, featured pick, visibility, add/remove)
- [ ] Task G4: Public gallery rework + before/after slider + CTA
- [ ] Task G5: Case detail page (more pictures) + home featured preview + GalleryItem deletion

### Checkpoint: Complete

- [ ] Admin can add / edit / hide / delete a case end-to-end; changes visible publicly after revalidation
- [ ] Slider works with mouse, touch, keyboard in FR/AR (RTL)/EN; images lazy-loaded, page weight spot-checked on throttled mobile
- [ ] Cases without consent can never be public (verified by test + manual attempt)
- [ ] All acceptance criteria met; ready for human review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Real patient photo published without consent | High | `consentConfirmed` gate enforced in Zod + API (active requires consent); draft-by-default; documented in admin UI copy |
| Linking cases to `Patient` rows leaks health data | High | No FK by design (see decision above); display label only |
| Image-heavy pages slow on mobile | Med | Lazy loading, `next/image` sizes, WebP, 5 MB upload cap, throttled-connection spot check in G4/G5 |
| Slider unusable by keyboard / screen reader / RTL | Med | Arrow-key handle, `role="slider"` with `aria-valuenow`, RTL-aware direction; manual pass in 3 locales |
| Orphan blobs on failed/replaced uploads | Low | Blob write only after all validations pass; delete blob on case/image delete (same pattern as Task 15 documents) |
| Old `GalleryItem` content disappears unexpectedly | Low | Rows are synthetic seed only; deletion is explicit in G5 after human confirmation (given); admin rebuilds real cases first |
| Admin features fewer than 2 / more than 4 home cases | Low | API caps featured at 4; UI shows live featured count with 2–4 guidance; home falls back to latest active cases when none featured |

## Open Questions — resolved by human (2026-09-07)

1. **Case label format → free text.** Admin types a title + description per case (patient had X, treated with Y, procedure notes/pics). Goal: visitor trust. No structured fields, no real names.
2. **Extra pictures limit → max 8** per case, enforced in Zod + API.
3. **Old gallery content → delete.** The 12 synthetic `GalleryItem` rows, model, routes, tab and seed block are removed in G5.
4. **Home preview → admin picks 2–4 featured cases** (`featured` + `featuredOrder`, API caps at 4) + CTA button "see more cases — find a patient who had the same problem as you" (3 locales).
5. **Image sourcing → both** upload to Blob public + paste URL.
