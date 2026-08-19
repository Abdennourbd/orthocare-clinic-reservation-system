import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma client singleton.
// Reads DATABASE_URL at first use so the Vitest test setup can point it at the
// dedicated test database (TEST_DATABASE_URL) before anything imports this.
function createClient() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://abdennour@localhost:5432/orthocare_dev";
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
