/**
 * Dry-run the Task 9 cron jobs against the current (dev) database.
 *
 * Run against a SEEDED database to see the mock SMS logging behave:
 *   npm run db:seed      # dev DB, synthetic data only
 *   npx tsx scripts/cron-dry-run.ts
 *
 * Each job is idempotent and safe to re-run. Actions taken are audited as
 * SYSTEM. Use MESSAGE_PROVIDER=mock (default) so nothing leaves the machine.
 */
import "dotenv/config";
import { getPrisma } from "../src/lib/db";
import { sendReminders } from "../src/lib/cron/reminders";
import { markNoShows } from "../src/lib/cron/noShow";
import { expirePendingBookings } from "../src/lib/cron/expirePending";
import { SmsMessageType } from "../src/generated/prisma/client";

async function main() {
  console.log("Cron dry-run (mock provider)…\n");

  const sent = await sendReminders();
  console.log(`reminders:        ${sent} reminder(s) sent`);

  const marked = await markNoShows();
  console.log(`no-show:          ${marked} appointment(s) marked NO_SHOW`);

  const expired = await expirePendingBookings();
  console.log(`expire-pending:   ${expired} PENDING booking(s) auto-cancelled`);

  const rows = await getPrisma().smsMessage.findMany({
    orderBy: { createdAt: "asc" },
  });
  const byType = (t: SmsMessageType) =>
    rows.filter((r) => r.type === t).length;
  console.log("\nSmsMessage rows now logged:");
  console.log(`  REMINDER:       ${byType(SmsMessageType.REMINDER)}`);
  console.log(`  NO_SHOW:        ${byType(SmsMessageType.NO_SHOW)}`);
  console.log(`  EXPIRED:        ${byType(SmsMessageType.EXPIRED)}`);
  console.log(`  other types:    ${rows.length - byType(SmsMessageType.REMINDER) - byType(SmsMessageType.NO_SHOW) - byType(SmsMessageType.EXPIRED)}`);
  console.log("\nDone. Re-running the same script sends nothing twice (idempotent).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => getPrisma().$disconnect());