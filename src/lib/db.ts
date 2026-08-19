import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma client singleton.
//
// IMPORTANT: the client is created LAZILY (on first call to `getPrisma()`),
// NOT at module load. This is required so the Vitest test setup
// (`tests/setup.ts`) can override `process.env.DATABASE_URL` to the dedicated
// test database before any connection is opened. Creating the client at import
// time would read the env var too early (ESM imports are hoisted above the
// test setup's assignment) and point tests at the dev/shared database.
//
// A descriptive error is thrown when DATABASE_URL is missing, rather than
// silently falling back to a hardcoded local URL that may not exist on another
// developer's machine.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in your environment (see .env.example).",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  globalForPrisma.prisma = client;
  return client;
}
