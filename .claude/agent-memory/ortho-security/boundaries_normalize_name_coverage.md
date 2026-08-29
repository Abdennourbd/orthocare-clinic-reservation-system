---
name: boundaries-normalize-name-coverage
description: Exactly what normalizeName() folds and what it does NOT — alef-hamza and ZWJ/ZWNJ diverge, which fragments a patient's records instead of leaking them
metadata:
  type: project
---

`normalizeName()` (`src/lib/patients/duplicates.ts`) = NFD → strip
`[̀-ͯؐ-ؚـً-ْۖ-ۭ]` → trim → collapse
whitespace → lowercase. Verified by running the real function, not by reading it:

- **Folds:** Latin accents (`Bénali`/`benali`), case, leading/trailing and
  non-breaking whitespace, Arabic harakat (`مُحَمَّد`/`محمد`), tatweel (`محـمد`).
- **Does NOT fold:** alef-hamza `أ` U+0623 and `إ` U+0625 vs plain alef `ا`
  (the hamza mark decomposes to U+0654/U+0655, outside the class) — i.e.
  `أحمد` ≠ `احمد`, the single most common Algerian name-spelling variant; and
  zero-width joiner/non-joiner U+200D/U+200C.

**Why it matters:** since Task 13 étape 4 tour 2 this function is load-bearing on
the *public booking* path ([[guard-upsert-patient-phone-name]]). Every divergence
fails **open toward creating a new record**, never toward overwriting someone
else's — so it is a health-record *fragmentation* risk, not a disclosure one.
Rank it accordingly and say which direction it fails in.

**How to apply:** before widening the class, check both call sites
(`findDuplicateCandidates` and `upsertPatient`) stay symmetric — they must use the
identical function or the booking path and the admin duplicate banner will
disagree. Note the admin list search (`GET /api/admin/patients`) uses Postgres
ILIKE and folds **case only**, so it is already asymmetric with both.
