import { getPrisma } from "@/lib/db";
import { normalizePhoneE164 } from "@/lib/phone/normalize";
import type { Prisma } from "@/generated/prisma/client";

// Task 13 step 3 — pure duplicate-detection engine, called by the create/
// update routes (steps 4-5) before writing a Patient. Never calls logAction
// itself: the routes journalize, this module only reads and decides.

export type DuplicateMatchReason = "PHONE" | "NAME";

export interface DuplicateCandidate {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  matchedOn: DuplicateMatchReason[];
}

export interface FindDuplicateCandidatesInput {
  firstName: string;
  lastName: string;
  phone?: string | null;
  /** Editing a patient must not report them as their own duplicate. */
  excludeId?: string;
}

/**
 * Combining/vocalization marks stripped after NFD decomposition. Written as
 * `\uXXXX` escapes rather than literal combining characters on purpose
 * (task-13.md step-3 tour-2, [MINEUR-4]): a bare combining mark in source has
 * no base character to attach to, so an editor, a `.gitattributes` filter or
 * a copy/paste can silently reorder it and widen or empty the class. Escapes
 * are byte-stable.
 *
 * Ranges covered:
 *  - U+0300–U+036F: Latin/general combining diacritical marks (accents).
 *  - U+0610–U+061A: Arabic Quranic annotation signs.
 *  - U+0640: Arabic tatweel/kashida — a purely decorative elongation
 *    character, not a letter; "محـمد" and "محمد" must compare equal.
 *  - U+064B–U+0652: Arabic harakat (fatha, damma, kasra, sukun, shadda,
 *    tanwin…) — Algiers is an Arabic-script-majority clinic, so a vocalized
 *    vs. unvocalized spelling of the same name is the common case, not an
 *    edge case.
 *  - U+06D6–U+06ED: additional Arabic Quranic/recitation marks.
 */
const DIACRITIC_MARKS_REGEX =
  /[\u0300-\u036F\u0610-\u061A\u0640\u064B-\u0652\u06D6-\u06ED]/g;

/**
 * Normalizes a name for comparison: lower-cases, strips diacritics — Latin
 * accents AND Arabic vocalization marks/tatweel (NFD decompose + drop
 * combining marks — pure TypeScript, no DB extension) — and collapses/trims
 * whitespace. Brings "Bénali"/"benali"/"  BENALI  " together, and
 * "مُحَمَّد"/"محمد" and "محـمد"/"محمد" together, per the user's 2026-08-28
 * arbitrage (§Exigences point 5) as clarified by the orchestrator's tour-2
 * ruling ([MAJEUR-1]: diacritics means diacritics, Arabic included — the
 * clinic is in Algiers). This is exact-after-normalization matching, not
 * fuzzy matching, not phonetic matching, not transliteration — "Mohamed" vs
 * "Mohammed" is deliberately out of scope.
 */
// Exported (task-13.md étape 4 tour 2, user-authorized fix for the
// ortho-security BLOCKING finding): `upsertPatient()`
// (src/lib/booking/createBooking.ts) needs the exact same normalization to
// resolve a booking on phone+name instead of phone alone, and the fiche
// relais is explicit — reuse this, never re-implement it.
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITIC_MARKS_REGEX, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Exported (task-13.md step-3 tour-2, [MINEUR-3]) so the whitelist test can
// assert against the actual select clause instead of the shape of the return
// literal — the two are independent minimization boundaries (what leaves
// Postgres vs. what leaves this function) and a test on the literal alone
// would stay green even if this select grew `notes: true`.
export const DUPLICATE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  phoneE164: true,
  active: true,
} satisfies Prisma.PatientSelect;

const MAX_CANDIDATES = 10;

/**
 * Finds existing patients that look like the same person as `input`, by
 * E.164-normalized phone OR by accent/case/whitespace-normalized full name.
 * Returns only the fields a "possible duplicate" banner needs — never
 * `notes`, `email`, nor `birthDate` (§Points de vigilance, task-13.md).
 *
 * ⚠️ Known, documented limitation (not a silent gap — see the step-3 report):
 * Postgres `ILIKE` (Prisma's `mode: "insensitive"`) folds case only, never
 * diacritics. A WHERE clause built from the raw query string can therefore
 * never find a diacritic-different row without the `unaccent` extension or a
 * normalized/indexed column — both out of scope here (no new DB dependency,
 * no migration, per the same arbitrage). To make "Bénali" / "benali" /
 * "  BENALI  " actually converge end-to-end, the NAME half of this function
 * reads every non-anonymized, non-excluded patient (a strict field whitelist
 * only — no `notes`/`email`/`birthDate` ever leave Postgres) and decides
 * matches in TypeScript. That is a full scan of the clinic's patient panel
 * on every create/update call, not an indexed lookup: acceptable for a
 * single clinic's realistic patient count (low thousands), called only when
 * staff add or edit a patient — not a search index.
 *
 * Update, Task 13 étape 9a: `Patient.firstNameNormalized` /
 * `lastNameNormalized` columns (+ composite index) are now available — the
 * caveat above about needing "a normalized column + index" no longer
 * describes reality. They are deliberately NOT plugged into the NAME query
 * of this function: brancher `findDuplicateCandidates` dessus est un
 * chantier séparé qui doit d'abord mettre à jour les fixtures de
 * `patient-duplicates.test.ts` pour renseigner les deux colonnes (même
 * précédent que `phoneE164`) — non fait ici, décision documentée
 * task-13.md étape 9a. The user's 2026-08-30 request that motivated the new
 * columns was about *search* (étape 9b), not duplicate detection — this
 * function keeps scanning and comparing in TypeScript, unchanged.
 *
 * PHONE, by contrast, needs no diacritic folding at all — E.164 strings are
 * ASCII digits — so it is deliberately its OWN indexed query
 * (`@@index([phoneE164])`, unused until this fix — task-13.md step-3
 * tour-2, [MAJEUR-2]) rather than folded into the unbounded NAME scan.
 * Two consequences fixed by that split:
 *  - Correctness: the old single unbounded `findMany` had no `orderBy`, so
 *    Postgres's row order was not guaranteed. If more than `MAX_CANDIDATES`
 *    NAME matches existed, a PHONE match seen later in the scan could be
 *    silently dropped by the post-hoc `break` — even though phone is the
 *    strongest duplicate signal. Splitting the query removes that
 *    dependency on scan order entirely for PHONE.
 *  - Determinism: the NAME scan now has an explicit `orderBy: { id: "asc" }`
 *    so which rows survive the `MAX_CANDIDATES` cap is reproducible.
 * Results are merged PHONE-first, deduplicated by `id` (a row can carry
 * both matchedOn reasons), and only then capped to `MAX_CANDIDATES` — so a
 * PHONE match can never be pushed out by NAME homonyms.
 */
export async function findDuplicateCandidates(
  input: FindDuplicateCandidatesInput,
): Promise<DuplicateCandidate[]> {
  const prisma = getPrisma();

  const normalizedFirst = normalizeName(input.firstName);
  const normalizedLast = normalizeName(input.lastName);
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;

  const excludeClause: Prisma.PatientWhereInput = input.excludeId
    ? { id: { not: input.excludeId } }
    : {};

  // Indexed, exact-match phone lookup — never touches the diacritic-folding
  // code path, and never scans rows that cannot possibly match.
  const phoneMatches = phoneE164
    ? await prisma.patient.findMany({
        where: { anonymizedAt: null, phoneE164, ...excludeClause },
        select: DUPLICATE_SELECT,
      })
    : [];

  // Unbounded-by-design name scan (see doc comment above): no `take` here on
  // purpose. Capping this query directly, instead of the merged result below,
  // would silently pick 10 arbitrary rows before TypeScript ever compares
  // names — that is the exact regression this fix exists to remove.
  const nameCandidates = await prisma.patient.findMany({
    where: { anonymizedAt: null, ...excludeClause },
    select: DUPLICATE_SELECT,
    orderBy: { id: "asc" },
  });

  const merged = new Map<string, DuplicateCandidate>();

  function addMatch(
    candidate: Prisma.PatientGetPayload<{ select: typeof DUPLICATE_SELECT }>,
    reason: DuplicateMatchReason,
  ): void {
    const existing = merged.get(candidate.id);
    if (existing) {
      if (!existing.matchedOn.includes(reason)) existing.matchedOn.push(reason);
      return;
    }
    merged.set(candidate.id, {
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      phone: candidate.phone,
      active: candidate.active,
      matchedOn: [reason],
    });
  }

  // PHONE first: this ordering is the whole point of [MAJEUR-2] — a phone
  // match must always survive the cap below, regardless of how many NAME
  // homonyms exist.
  for (const candidate of phoneMatches) {
    addMatch(candidate, "PHONE");
  }
  for (const candidate of nameCandidates) {
    if (
      normalizeName(candidate.firstName) === normalizedFirst &&
      normalizeName(candidate.lastName) === normalizedLast
    ) {
      addMatch(candidate, "NAME");
    }
  }

  return Array.from(merged.values()).slice(0, MAX_CANDIDATES);
}
