// One-off admin utility: reset the admin account's password directly in the DB.
// For when the current password is unknown (seeded hash never matched a
// successful first login, or the password was lost).
//
// Usage:
//   npx tsx scripts/reset-admin-password.ts <new-password>
//
// Reads DATABASE_URL from .env (Neon by default in this project). Enforces the
// same 12-char minimum as the app's password policy. Clears
// mustChangePassword so the next login lands straight on the dashboard.
// Audited as PASSWORD_RESET.
import { PrismaClient, AuditAction } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as argon2 from "argon2";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const newPassword = process.argv[2];

async function main() {
  if (!newPassword || newPassword.length < 12) {
    console.error("Usage: npx tsx scripts/reset-admin-password.ts <new-password>  (min 12 chars)");
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

  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: { increment: 1 }, // revoke any session open elsewhere
      },
    }),
    prisma.auditLog.create({
      data: {
        actorType: "STAFF",
        userId: admin.id,
        action: AuditAction.PASSWORD_RESET,
        entityType: "User",
        entityId: admin.id,
        detail: { field: "password", reason: "manual reset via scripts/reset-admin-password.ts" },
      },
    }),
  ]);

  // tokenVersion bump revokes any session that might still be open elsewhere.
  console.log(`Password reset for ${admin.email}. Log in now at /admin/login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
