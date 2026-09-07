# Task List: Gallery → Real Patient Before/After Cases

Details + rationale live in `tasks/plan-gallery.md`. Implement strictly in order — each task leaves a working system. **Plan mode was used for planning (no app code changed); implementation starts only after human approval of this plan.**

**Definition of Done — applies to every task below (inherits project `tasks/todo.md`):**
- [ ] Lint + typecheck + tests green (`npm run lint`, `npm run typecheck`, `npm test`)
- [ ] Route-level integration test against the test DB for every new endpoint
- [ ] New admin routes added to the authorization matrix test (`tests/authz-matrix.test.ts`)
- [ ] Input validated with a Zod schema shared between route handler and form
- [ ] Staff writes audited via `logActionSafe`; no patient-adjacent data in logs/details
- [ ] Works in all 3 locales where user-facing (RTL checked for Arabic)
- [ ] Test/seed data is synthetic only — no real patient photo, name, or detail in code or seed

## Phase 1: Foundation + admin backbone

## Task G1: Schema, migration, seed, public fetchers — DONE (2026-09-07)

**Description:** (as above; migration hand-written in repo style because the dev Neon DB is unreachable from this environment — apply with `prisma migrate deploy` where reachable; applied + verified on the local test DB. Upload cap set to 4 Mo, not ~5 Mo — Vercel body limit ~4.5 Mo; see `src/lib/gallery/images.ts`.)

**Description:** Add `SmileCase` (key unique, title/description as per-locale JSON — free text written by the admin: what the patient had, how it was treated; beforeImageUrl, afterImageUrl, active, sortOrder, featured bool + featuredOrder, consentConfirmed, consentAt) and `SmileCaseImage` (caseId FK, imageUrl, caption JSON, sortOrder) models; migrate; seed 3 clearly synthetic cases; add `listActiveSmileCases` + `listFeaturedCases` + `getSmileCaseByKey` fetchers in `src/lib/public/content.ts` using `localized()` and the `gallery` cache tag, with unit tests for ordering, active-filtering, featured ordering, and locale fallback.

**Acceptance criteria:**
- [ ] Migration applies cleanly (`prisma migrate dev`) without touching existing tables
- [ ] Seed creates 3 synthetic cases (placeholder images, invented labels, zero real-patient data)
- [ ] Fetchers return only `active` cases ordered by `sortOrder`; locale fallback to FR works
- [ ] Unit tests cover ordering, inactive exclusion, missing-locale fallback

**Verification:**
- [ ] Tests pass: `npm test -- gallery` (new suites green)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: query seeded cases via `prisma studio` or script; no real data present

**Dependencies:** None

**Files likely touched:**
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/lib/public/content.ts`
- `src/lib/public/cases.test.ts` (new)

**Estimated scope:** Medium (3–5 files)

## Task G2: Admin API (CRUD + image upload) — DONE (2026-09-07)

**Description:** (as above; 12 integration tests + 7 new authz-matrix rows, 267 matrix tests green. Non-allow-listed MIME rejected at the Zod metadata gate with 400 — same convention as patient documents.)

**Description:** Vertical slice of the admin backbone: `GET/POST /api/admin/cases`, `GET/PATCH/DELETE /api/admin/cases/[id]`, extras `POST/DELETE /api/admin/cases/[id]/images` (max 8 extras per case — 9th rejected), featuring `PATCH` capped at 4 featured cases (5th rejected), and `POST /api/admin/cases/upload` (multipart → Vercel Blob public, JPEG/PNG/WebP, ~5 MB cap, extension/content-type agreement, blob written only after validation). ADMIN-only, CSRF + rate limits (existing content limits), `SETTINGS_UPDATED` audit, `revalidateTagSafe("gallery")` on writes. Hard rule: `active=true` rejected without `consentConfirmed=true`. Authz-matrix rows + route-level integration tests.

**Acceptance criteria:**
- [ ] CRUD + extras + upload all work for ADMIN; receptionist gets 403, anon gets 401/redirect
- [ ] Setting `active=true` without consent returns 400; draft (inactive, no consent) saves fine
- [ ] Featuring a 5th case rejected; adding a 9th extra rejected
- [ ] Oversized / wrong-type uploads rejected (413/415) with no orphan blob left behind
- [ ] Every write audited; every route pinned in the authz-matrix test
- [ ] Integration test: create draft → add extras → confirm consent → publish → read back publicly-shaped data

**Verification:**
- [ ] Tests pass: `npm test -- cases` + `npm test -- authz-matrix`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: upload via curl with admin session; verify blob URL is publicly reachable and row has no private data

**Dependencies:** G1

**Files likely touched:**
- `src/schemas/content.ts` (or new `src/schemas/case.ts`)
- `src/lib/gallery/blobStorage.ts` (new)
- `src/app/api/admin/cases/route.ts` (new)
- `src/app/api/admin/cases/[id]/route.ts` (new)
- `src/app/api/admin/cases/[id]/images/route.ts` (new)
- `src/app/api/admin/cases/upload/route.ts` (new)
- `tests/authz-matrix.test.ts`

**Estimated scope:** Medium (5 files, one vertical slice)

## Checkpoint: Foundation

- [ ] Migration + seed clean; fetchers unit-tested
- [ ] Admin API fully working via tests; authz-matrix green
- [ ] Consent gate proven by test (no-consent publish rejected)
- [ ] Review with human before proceeding

## Phase 2: Admin control + public experience

## Task G3: Admin UI — case management — DONE (2026-09-07)

**Description:** (as above; "Cas patients" tab added to ContentDashboard — old gallery tab removal deferred to G5. List route extended to include ordered extras so the edit form needs no extra endpoint.)

**Description:** The admin-facing control the requester asked for: a cases section in the dashboard (extend `ContentDashboard` with a "Cas patients" tab or a dedicated `/admin/cases` page) listing all cases with visibility + featured status; create/edit form with free-text **title** + **description** fields (FR required, AR/EN optional — "this patient had this, we treated it with that"), before-image and after-image pickers (upload new file or paste URL, with thumbnail preview), extras manager (add/remove/reorder, max 8), **featured toggle** (mark for home page, live count shown with 2–4 guidance, API caps at 4), explicit consent checkbox (required to publish), show/hide toggle, sort-order control, and two-step delete (reuse `ConfirmPanel`). FR-only, same visual language as `GalleryTab`.

**Acceptance criteria:**
- [ ] Admin can create a draft case, upload/paste before + after images, add extras, check consent, publish — all from the UI
- [ ] Admin can hide (unpublish), feature/unfeature for home (max 4), reorder, edit, and delete cases; delete removes DB rows + blobs
- [ ] Publishing without the consent checkbox is blocked in the UI with a clear message (server still enforces)
- [ ] List shows thumbnail, label, treatment, Visible/Masquée badge; loading + empty + error states defined
- [ ] Keyboard-navigable with visible focus states

**Verification:**
- [ ] Tests pass: `npm test` (component tests for the new tab) + typecheck + lint
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: full add → publish → hide → delete cycle in browser as admin; receptionist cannot open the section (nav hidden + direct URL blocked)

**Dependencies:** G2

**Files likely touched:**
- `src/components/admin/content/CasesTab.tsx` (new)
- `src/components/admin/content/ContentDashboard.tsx`
- `src/app/admin/cases/page.tsx` (only if dedicated page chosen over tab)

**Estimated scope:** Medium (2–4 files)

## Task G4: Public gallery rework + before/after slider — DONE (2026-09-07)

**Description:** (as above + CTA block; slider mechanics isolated with dir="ltr", keyboard support role="slider", i18n parity green.)

**Description:** Rework `/[locale]/gallery` from the caption-paired grid into case cards: each card shows the new `BeforeAfterSlider` (draggable divider, pointer + touch, arrow-key control with `role="slider"`, RTL-aware, Before/Après labels per locale), title + short description, and a "Voir plus" link to the detail page. Below the grid a CTA block ("see more cases — find a patient who had the same problem as you", linking to booking/contact). New i18n strings in `messages/fr|ar|en.json`. Images via `next/image`, lazy-loaded, with `sizes` set. Retire `groupIntoBlocks` usage on this page.

**Acceptance criteria:**
- [ ] Each active case renders as a card with a working slider (drag with mouse + touch; arrows move handle)
- [ ] Slider is keyboard-operable and announces position (`aria-valuenow`); direction correct in Arabic RTL
- [ ] Page renders in FR/AR/EN with FR fallback; empty state when no active cases
- [ ] No third-party requests on the page beyond existing ones; images lazy-loaded

**Verification:**
- [ ] Tests pass: `npm test -- slider` (unit: position math, clamping, keyboard) + existing gallery tests updated
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: drag + keyboard pass in `/fr`, `/ar`, `/en`; throttled-mobile weight spot-check

**Dependencies:** G1 (fetchers), G3 not required (seed cases suffice)

**Files likely touched:**
- `src/components/public/BeforeAfterSlider.tsx` (new)
- `src/app/[locale]/gallery/page.tsx`
- `messages/fr.json`, `messages/ar.json`, `messages/en.json`

**Estimated scope:** Medium (3–5 files)

## Task G5: Case detail page (more pictures) + home featured preview + GalleryItem deletion — DONE (2026-09-07)

**Description:** (as above. Verified live: FR/AR/EN gallery prerendered, detail 200 with extras, unknown key 404, home featured + CTA, full suite 1172 green, build clean. `next.config.ts` already allow-lists Blob hosts for next/image.)

**Description:** New `/[locale]/gallery/[key]` detail page: large slider, full title + description (problem → treatment → procedure), extras grid (up to 8 "more pictures about the patient", e.g. procedure steps), back-to-gallery link, per-case metadata for SEO; 404 for unknown/inactive keys. Update home `GalleryPreview` to render the admin's **featured cases** (in `featuredOrder`; fallback to latest active if none featured) as after-image cards plus the CTA button, linking to `/gallery`. Delete the old path: remove `GalleryTab` from the dashboard, delete the `GalleryItem` API routes, drop the `GalleryItem` model via migration (deletes the 12 synthetic rows — human-approved), remove its seed block and `galleryBlocks.ts` + test (updating any remaining references). Add metadata strings to the 3 locales.

**Acceptance criteria:**
- [ ] Detail page shows big slider + all extras with captions; unknown/inactive key → 404
- [ ] Home preview shows admin-featured cases (2–4) + CTA button; renders fallback when none featured
- [ ] Old gallery fully removed: tab, API routes, model + rows, seed block, `galleryBlocks` helper; full suite green with no dangling references
- [ ] Cache revalidation from admin writes refreshes index + detail pages

**Verification:**
- [ ] Tests pass: `npm test` full suite green (old `galleryBlocks` tests updated/removed deliberately)
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: card → detail → back flow in 3 locales; publish a case in admin and see it appear publicly; delete it and see it 404

**Dependencies:** G3, G4

**Files likely touched:**
- `src/app/[locale]/gallery/[key]/page.tsx` (new)
- `src/components/public/home/GalleryPreview.tsx`
- `src/components/admin/content/ContentDashboard.tsx` (remove GalleryTab)
- `src/components/admin/content/GalleryTab.tsx` (removed)
- `src/app/api/admin/gallery/route.ts` + `[id]/route.ts` (removed)
- `src/schemas/content.ts` (remove gallery schemas)
- `prisma/schema.prisma` (drop `GalleryItem` model)
- `prisma/seed.ts` (remove gallery seed block)
- `src/lib/public/galleryBlocks.ts` (+ test — removed)
- `messages/fr.json`, `messages/ar.json`, `messages/en.json`

**Estimated scope:** Medium (4–6 files)

## Checkpoint: Complete

- [ ] Admin add → publish → hide → delete cycle works end-to-end in browser
- [ ] Consent gate verified manually (publish without consent blocked UI + API)
- [ ] Slider passes mouse / touch / keyboard check in FR + AR (RTL) + EN
- [ ] Full `npm test`, typecheck, lint, build green
- [ ] All acceptance criteria met — ready for human review
