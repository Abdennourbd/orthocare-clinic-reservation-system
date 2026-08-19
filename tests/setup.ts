// Test setup — runs before every test suite.
//
// 1. Point the Prisma client at the dedicated test database. This must happen
//    before any module imports `src/lib/db.ts`, so the singleton picks up the
//    test URL.
// 2. Reset all tables between suites so tests are isolated and deterministic.
import "dotenv/config";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://abdennour@localhost:5432/orthocare_test";

import { beforeEach } from "vitest";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  // Truncate all tables, restarting identity sequences. Safe because the test
  // DB contains only synthetic data and each suite starts clean.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "RateLimitCounter" RESTART IDENTITY CASCADE;
  `);
});
