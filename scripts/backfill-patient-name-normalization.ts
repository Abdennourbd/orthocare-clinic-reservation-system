/**
 * One-shot backfill for `Patient.firstNameNormalized` / `lastNameNormalized`
 * (Task 13 step 9a). The two columns are nullable because no `unaccent`
 * extension exists in this project, so the migration cannot compute them in
 * SQL — every row that predates the migration is filled here instead.
 *
 *   npm run db:backfill-patient-names
 *
 * Idempotent by construction: the value written is a pure function of the name
 * currently stored, so re-running it converges on the same result. No
 * "already done" detection is needed, and none is attempted.
 *
 * PATIENT HEALTH DATA. It reads `id, firstName, lastName` only — never
 * `notes`, `email` or `birthDate` — and logs a COUNT, never a name nor an id.
 *
 * LOCAL ONLY. Unlike `dev-reset-bookings.ts` (which touched rate-limit
 * counters and PENDING appointments), this script writes to EVERY `Patient`
 * row of the database it is pointed at, so it refuses to start unless
 * `DATABASE_URL` targets localhost. The connection string is never printed:
 * it is a live credential and echoing it would force a rotation in Neon.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";
// Imported, never re-implemented: a second copy of this folding rule could
// drift from the one the search and the write paths use, and the mismatch
// would silently make records unfindable rather than fail loudly.
import { normalizeName } from "../src/lib/patients/duplicates";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set. Aborting without writing anything.");
  process.exit(1);
}

// Host-only check, and the value itself stays out of the output on every path.
let hostname: string;
try {
  hostname = new URL(connectionString).hostname;
} catch {
  console.error(
    "DATABASE_URL is not a parseable URL. Aborting without writing anything.",
  );
  process.exit(1);
}

if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  console.error(
    "Refusing to run: DATABASE_URL does not point at localhost. " +
      "This script rewrites every Patient row and must never touch a shared " +
      "or production database. (Connection string intentionally not shown.)",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const patients = await prisma.patient.findMany({
    // Minimal select: the id to address the row, the two fields to fold.
    // `anonymizedAt` is a flag, not patient data, and is needed to avoid
    // resurrecting a searchable value on an erased record (see below).
    select: {
      id: true,
      firstName: true,
      lastName: true,
      anonymizedAt: true,
    },
  });

  let updated = 0;
  for (const patient of patients) {
    // Erased records keep the same empty sentinel as `phone`/`phoneE164`.
    // Folding the placeholder instead would store "patient"/"anonymise",
    // values that would match a future search on those words and add nothing
    // (task-13.md step 9a, point 7).
    const erased = patient.anonymizedAt !== null;
    await prisma.patient.update({
      where: { id: patient.id },
      data: {
        firstNameNormalized: erased ? "" : normalizeName(patient.firstName),
        lastNameNormalized: erased ? "" : normalizeName(patient.lastName),
      },
    });
    updated += 1;
  }

  // Counter only — never a name, never an id.
  console.log(`Backfill done. Normalized names on ${updated} patient row(s).`);
}

main()
  .catch((e) => {
    // Task 13 étape 9b (ortho-security MINEUR-2 on étape 9a) — a Prisma
    // error on `patient.update` serializes its `data` argument, which
    // carries the patient's normalized name. Logging `e` directly would
    // contradict this file's own header ("logs a COUNT, never a name nor an
    // id"). Only the error's class name, never its message or the caught
    // value itself, ever reaches the console.
    console.error(e instanceof Error ? e.name : "unknown error");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
