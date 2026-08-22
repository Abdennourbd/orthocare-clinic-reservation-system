// Test setup — runs before every test suite.
//
// 1. Point the Prisma client at the dedicated test database. The client is
//    created LAZILY (via `getPrisma()`), so it reads `process.env.DATABASE_URL`
//    at first use — after this override has run — guaranteeing tests never
//    touch the dev/shared database.
// 2. Reset all tables between suites so tests are isolated and deterministic.
import "dotenv/config";
import { beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://abdennour@localhost:5432/orthocare_test";

// Safety guard: refuse to run the test suite against anything other than a
// LOCAL database. This prevents a misconfigured TEST_DATABASE_URL (e.g. one
// accidentally pointing at the shared Neon DB) from letting tests truncate
// real/shared data.
if (!/localhost|127\.0\.0\.1|::1/.test(TEST_DATABASE_URL)) {
  throw new Error(
    `TEST_DATABASE_URL must point at a LOCAL database, got: ${TEST_DATABASE_URL}. ` +
      "Tests must never run against a shared or production database.",
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;

beforeEach(async () => {
  // Truncate all tables, restarting identity sequences. Safe because the test
  // DB contains only synthetic data and each suite starts clean.
  await getPrisma().$executeRawUnsafe(`
    TRUNCATE TABLE "RateLimitCounter", "User", "Patient", "Service", "Appointment", "Setting", "ScheduleException", "Testimonial", "FaqItem", "GalleryItem", "WaitlistEntry" RESTART IDENTITY CASCADE;
  `);
});
