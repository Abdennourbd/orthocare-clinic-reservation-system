// Seed script — Task 1 placeholder.
// Task 3a adds the real seed (admin user, services, patient) once the domain
// models exist. Keeping this minimal so `prisma db seed` is wired and green.
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // No seed data required for Task 1's schema (rate-limit store only).
  console.log("Seed: nothing to seed yet — domain models land in Task 3a.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
