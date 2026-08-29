import { describe, it, expect } from "vitest";
import { getPrisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { findDuplicateCandidates, DUPLICATE_SELECT } from "./duplicates";

// Task 13 step 3 — unit tests for the pure duplicate-detection engine.
// Colocated with the module per CLAUDE.md ("unit tests live beside their
// module"). The phone-normalization end-to-end proof across 5 formats lives
// in tests/integration/patient-duplicates.test.ts (that is the file named by
// the todo.md verification command).

async function createPatient(overrides: Partial<Prisma.PatientCreateInput> = {}) {
  return getPrisma().patient.create({
    data: {
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0550123456",
      phoneE164: "+213550123456",
      ...overrides,
    },
  });
}

describe("findDuplicateCandidates", () => {
  it("excludes excludeId — a patient is never its own duplicate", async () => {
    const patient = await createPatient();

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0550123456",
      excludeId: patient.id,
    });

    expect(result).toEqual([]);
  });

  it("excludes anonymized patients — their identity is erased, they cannot be a duplicate", async () => {
    await createPatient({ anonymizedAt: new Date() });

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0550123456",
    });

    expect(result).toEqual([]);
  });

  it("includes inactive (soft-deleted) patients — they remain a real duplicate risk", async () => {
    const patient = await createPatient({ active: false });

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0550123456",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patient.id);
    expect(result[0].active).toBe(false);
    expect(result[0].matchedOn).toEqual(expect.arrayContaining(["PHONE", "NAME"]));
  });

  it("matches on name after normalizing case, diacritics, and whitespace", async () => {
    const patient = await createPatient({
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0661112233",
      phoneE164: "+213661112233",
    });

    const result = await findDuplicateCandidates({
      firstName: "  AMINE  ",
      lastName: "benali",
      // Different phone on purpose: proves the NAME match fires independently
      // of the PHONE match.
      phone: "0777889900",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patient.id);
    expect(result[0].matchedOn).toEqual(["NAME"]);
  });

  it("does not match when only one of firstName/lastName matches", async () => {
    await createPatient({ firstName: "Amine", lastName: "Bénali" });

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Kaci",
      phone: "0555000000",
    });

    expect(result).toEqual([]);
  });

  it("does not crash on an invalid phone — the PHONE criterion is simply inactive", async () => {
    await createPatient({ firstName: "Sonia", lastName: "Zeroual" });

    const result = await findDuplicateCandidates({
      firstName: "Nadia",
      lastName: "Kaci",
      phone: "not-a-phone",
    });

    expect(result).toEqual([]);
  });

  it("returns only the whitelisted fields — never notes, email, or birthDate", async () => {
    await createPatient({
      firstName: "Amine",
      lastName: "Bénali",
      notes: "Allergie à la pénicilline",
      email: "amine@example.com",
      birthDate: new Date("1990-01-01"),
    });

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Bénali",
      phone: "0550123456",
    });

    expect(result).toHaveLength(1);
    // Task 13 step 3 tour 2 [MINEUR-3]: assert against DUPLICATE_SELECT
    // itself (what actually leaves Postgres), not just the shape of the
    // return literal — a test on the literal alone would stay green even if
    // DUPLICATE_SELECT grew `notes: true`. `matchedOn` is the one field
    // DuplicateCandidate adds on top of the select (computed in TypeScript,
    // never read from the DB), so it is asserted alongside it.
    const selectedColumns = Object.keys(DUPLICATE_SELECT);
    expect(selectedColumns).not.toContain("notes");
    expect(selectedColumns).not.toContain("email");
    expect(selectedColumns).not.toContain("birthDate");
    expect(Object.keys(result[0]).sort()).toEqual(
      [...selectedColumns.filter((key) => key !== "phoneE164"), "matchedOn"].sort(),
    );
  });

  it("treats a null/empty phone input as no phone criterion at all", async () => {
    await createPatient({ firstName: "Amine", lastName: "Bénali" });

    const result = await findDuplicateCandidates({
      firstName: "Amine",
      lastName: "Bénali",
      phone: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchedOn).toEqual(["NAME"]);
  });
});
