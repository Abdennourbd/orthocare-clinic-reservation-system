/**
 * Dev-only reset: clears the booking rate-limit counters and cancels every
 * PENDING appointment so a solo tester is not locked out by the per-phone
 * (5/h) limit or the active-PENDING cap (3) after repeated test bookings.
 *
 *   npx tsx scripts/dev-reset-bookings.ts
 *
 * It touches ONLY `RateLimitCounter` rows whose key ends with
 * `:appointments` and appointments still `PENDING`. It does NOT call
 * `releaseSlot()` (no waitlist subscriber exists yet in dev), and it does not
 * touch confirmed/completed history. Never run this against production.
 */
import {
  PrismaClient,
  AppointmentStatus,
  CancelReason,
} from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const rl = await prisma.rateLimitCounter.deleteMany({
    where: { key: { endsWith: ":appointments" } },
  });
  const now = new Date();
  const appts = await prisma.appointment.updateMany({
    where: { status: AppointmentStatus.PENDING },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancelledAt: now,
      cancelReason: CancelReason.AUTO_EXPIRED,
    },
  });
  console.log(
    `Dev reset done. Cleared ${rl.count} rate-limit counter(s), cancelled ${appts.count} PENDING appointment(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
