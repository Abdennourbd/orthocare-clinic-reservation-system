import { describe, it, expect } from "vitest";
import { getPrisma } from "@/lib/db";
import { findDuplicateCandidates } from "@/lib/patients/duplicates";

// Task 13 step 3 — this is the file named by the todo.md verification
// command (`npm test -- patient-duplicates`). Its job is to prove that
// findDuplicateCandidates actually uses normalizePhoneE164 rather than
// comparing raw strings: one patient stored with phoneE164 = "+213550123456"
// must be found by every common way an Algerian patient (or staff member)
// might type that number, arabic-indic digits included.

describe("findDuplicateCandidates — phone-format normalization proof", () => {
  it("finds the same patient across 5 different input formats of the same number", async () => {
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Karim",
        lastName: "Hadj",
        phone: "0550123456",
        phoneE164: "+213550123456",
      },
    });

    const formats = [
      "0550123456",
      "+213 550 12 34 56",
      "00213550123456",
      "213550123456",
      "٠٥٥٠١٢٣٤٥٦", // arabic-indic digits
    ];

    for (const phone of formats) {
      const result = await findDuplicateCandidates({
        // Deliberately mismatched name so only the PHONE criterion can fire —
        // proves the phone match, not the name match, is what found the row.
        firstName: "Unrelated",
        lastName: "Person",
        phone,
      });

      expect(result, `format "${phone}" should find the patient`).toHaveLength(1);
      expect(result[0].id).toBe(patient.id);
      expect(result[0].matchedOn).toContain("PHONE");
    }
  });

  it("matches a name across case, diacritics, and surrounding whitespace (user arbitrage §5)", async () => {
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Amine",
        lastName: "Bénali",
        phone: "0661112233",
        phoneE164: "+213661112233",
      },
    });

    const variants = [
      { firstName: "Amine", lastName: "benali" },
      { firstName: "amine", lastName: "  BENALI  " },
      { firstName: "  AMINE  ", lastName: "Bénali" },
    ];

    for (const variant of variants) {
      const result = await findDuplicateCandidates({
        ...variant,
        phone: null, // isolate the NAME criterion
      });

      expect(
        result,
        `variant ${JSON.stringify(variant)} should find the patient by name`,
      ).toHaveLength(1);
      expect(result[0].id).toBe(patient.id);
      expect(result[0].matchedOn).toEqual(["NAME"]);
    }
  });

  // Task 13 step 3 tour 2 [MAJEUR-1] — orchestrator ruling: the clinic is in
  // Algiers, so Arabic-script names are the common case, not an edge case.
  // Three measured comparisons from the security audit, each proven to
  // converge here (the first already converged before this fix; the other
  // two previously diverged and are the reason for this test).
  it("converges Latin accented/unaccented spellings — 'Bénali' vs 'benali' (baseline, already worked)", async () => {
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Karim",
        lastName: "Bénali",
        phone: "0550111222",
        phoneE164: "+213550111222",
      },
    });

    const result = await findDuplicateCandidates({
      firstName: "Karim",
      lastName: "benali",
      phone: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patient.id);
    expect(result[0].matchedOn).toEqual(["NAME"]);
  });

  it("converges Arabic vocalized/unvocalized spellings — 'محمد' vs 'مُحَمَّد' (harakat U+064B-U+0652)", async () => {
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "محمد",
        lastName: "بلعربي",
        phone: "0550222333",
        phoneE164: "+213550222333",
      },
    });

    const result = await findDuplicateCandidates({
      firstName: "مُحَمَّد",
      lastName: "بلعربي",
      phone: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patient.id);
    expect(result[0].matchedOn).toEqual(["NAME"]);
  });

  it("converges tatweel-elongated/plain Arabic spellings — 'محمد' vs 'محـمد' (tatweel U+0640)", async () => {
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "محمد",
        lastName: "بلعربي",
        phone: "0550333444",
        phoneE164: "+213550333444",
      },
    });

    const result = await findDuplicateCandidates({
      firstName: "محـمد",
      lastName: "بلعربي",
      phone: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patient.id);
    expect(result[0].matchedOn).toEqual(["NAME"]);
  });
});

// Task 13 step 3 tour 2 [MAJEUR-2] — justesse, not just performance. The old
// implementation ran a single unbounded, unordered `findMany` and applied the
// MAX_CANDIDATES=10 cap with a `break` in TypeScript *after* reading rows in
// whatever order Postgres happened to return them. With more than 10 NAME
// homonyms ahead of it in that order, a PHONE match — the strongest possible
// duplicate signal — could be silently dropped before the loop ever reached
// it. This test proves the fixed implementation (phone match found by its
// own indexed query, merged phone-first, capped only after merging) always
// surfaces the phone match regardless of how many homonyms exist.
describe("findDuplicateCandidates — justesse: a PHONE match must survive more than MAX_CANDIDATES NAME homonyms", () => {
  it("still returns the phone-matching patient when 12 unrelated name homonyms exist", async () => {
    const prisma = getPrisma();

    // 12 patients that all match the NAME criterion the search will use, but
    // whose phone numbers do NOT match the search phone. 12 > MAX_CANDIDATES
    // (10), so if the cap were applied before the phone match is considered,
    // the phone-matching patient below would be pushed out.
    for (let i = 0; i < 12; i++) {
      await prisma.patient.create({
        data: {
          firstName: "Yacine",
          lastName: "Meziane",
          phone: `05501120${String(i).padStart(2, "0")}`,
          phoneE164: `+21355012${String(1000 + i)}`,
        },
      });
    }

    // The real target: same phone number the search will use, but a
    // completely different, non-matching name — only PHONE can find it.
    const phoneMatchPatient = await prisma.patient.create({
      data: {
        firstName: "Rachid",
        lastName: "Boudiaf",
        phone: "0550999888",
        phoneE164: "+213550999888",
      },
    });

    const result = await findDuplicateCandidates({
      firstName: "Yacine",
      lastName: "Meziane",
      phone: "0550999888",
    });

    const phoneMatchInResult = result.find((c) => c.id === phoneMatchPatient.id);
    expect(
      phoneMatchInResult,
      "the PHONE match must be present in the result even though 12 NAME " +
        "homonyms exist ahead of MAX_CANDIDATES",
    ).toBeDefined();
    expect(phoneMatchInResult?.matchedOn).toContain("PHONE");
  });
});
