// One-off admin utility: rename the seeded admin account's login email.
//
// Usage:
//   npx tsx scripts/update-admin-email.ts <new-email>
//
// Reads DATABASE_URL from .env, so it targets whichever database is
// configured there (Neon by default in this project). The action is
// audited as PASSWORD_RESET-adjacent via the AuditLog table.
import { PrismaClient, AuditAction } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const newEmail = process.argv[2];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  if (!newEmail || !EMAIL_RE.test(newEmail)) {
    console.error("Usage: npx tsx scripts/update-admin-email.ts <new-email>");
    process.exit(1);
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { id: "asc" },
  });
  if (!admin) {
    console.error("No active ADMIN user found in this database.");
    process.exit(1);
  }
  if (admin.email === newEmail) {
    console.log(`Admin email is already ${newEmail}. Nothing to do.`);
    return;
  }

  const clash = await prisma.user.findUnique({ where: { email: newEmail } });
  if (clash) {
    console.error(`A user with email ${newEmail} already exists (id: ${clash.id}). Aborting.`);
    process.exit(1);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: admin.id },
      data: { email: newEmail },
    }),
    prisma.auditLog.create({
      data: {
        actorType: "STAFF",
        userId: admin.id,
        action: AuditAction.PASSWORD_RESET,
        entityType: "User",
        entityId: admin.id,
        detail: { field: "email", from: admin.email, to: newEmail },
      },
    }),
  ]);

  console.log(`Admin email updated: ${admin.email} → ${newEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
