---
name: project-patient-duplicates-accent-tradeoff
description: Task 13 step 3 — findDuplicateCandidates does a full non-anonymized Patient table scan in TS, not an indexed SQL name filter, because Postgres ILIKE cannot fold diacritics without the unaccent extension
metadata:
  type: project
---

`src/lib/patients/duplicates.ts` (`findDuplicateCandidates`) does **not**
filter by name in SQL at all. It fetches every non-anonymized,
non-`excludeId` `Patient` row (strict `select` whitelist: id/firstName/
lastName/phone/phoneE164/active — never notes/email/birthDate) and decides
the `NAME` half of `matchedOn` entirely in TypeScript via a `normalizeName()`
helper (NFD decompose + strip combining marks + trim + collapse whitespace +
lowercase).

**Updated 2026-08-29 (step-3 tour-2, [MAJEUR-2] fix)**: `PHONE` is **no
longer** part of that full scan. It's now its own indexed query
(`where: { phoneE164, anonymizedAt: null, ... }`, finally using
`@@index([phoneE164])`), because a single unbounded/unordered `findMany`
with a post-hoc `MAX_CANDIDATES` `break` could silently drop a phone match
if 10+ name homonyms happened to be scanned first — order from Postgres
without `orderBy` is not guaranteed. Results are merged phone-first via a
`Map<id, DuplicateCandidate>`, deduped by id, THEN capped to
`MAX_CANDIDATES`. The name scan itself still has no `take` (capping the raw
query would silently drop rows before comparison — the exact bug this fix
removed) but now has `orderBy: { id: "asc" }` for reproducibility. Also,
`normalizeName()`'s diacritic class now covers Arabic harakat
(U+064B-U+0652), tatweel (U+0640), and Quranic marks (U+0610-U+061A,
U+06D6-U+06ED) in addition to the original Latin range (U+0300-U+036F) — the
clinic is in Algiers, Arabic-script names are the common case. See
[[trap-unicode-escape-vs-literal-glyph]] for how that character class must be
written.

**Why**: Prisma's `mode: "insensitive"` compiles to Postgres `ILIKE`, which
folds case only — never diacritics. No `WHERE` clause built from the raw
query string can match "Bénali" against a stored "Benali" (or vice versa)
without the `unaccent` extension or a normalized/indexed column, and both
were explicitly out of scope for step 3 (no new DB dependency, no
migration — user arbitrage 2026-08-28 §Exigences point 5, which demanded
exact-after-normalization name matching, not fuzzy). Narrowing the SQL
predicate to one field, or `OR` instead of `AND`, does not help — the
limitation is `ILIKE` itself, not the shape of the filter.

**How to apply**: if a later task (e.g. Task 13 step 4's `GET
/api/admin/patients?q=` search, or any future search feature) needs
accent-insensitive matching, it hits the exact same wall. Either accept the
same full-scan-and-normalize-in-TS trade-off (documented as acceptable for a
single clinic's realistic patient count, not for a search index at scale),
or treat it as a separate ticket to add a normalized+indexed column via a
real migration. Don't assume `mode: "insensitive"` alone solves accent
matching anywhere in this codebase — it only solves case and (after
`.trim()`) leading/trailing whitespace.

See also [[project-task13-relay-file-is-authoritative]] for how the
§Exigences arbitrage overrode the step-3 card's original single-`findMany`-
with-`OR`-clause spec.
