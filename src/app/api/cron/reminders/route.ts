import { NextRequest, NextResponse } from "next/server";
import { sendReminders } from "@/lib/cron/reminders";
import { requireCronSecret } from "@/lib/security/cronAuth";

/**
 * Cron: send 24h-before reminders to CONFIRMED appointments (Task 9).
 * Authenticated with the `CRON_SECRET` header. Idempotent — see
 * `src/lib/cron/reminders.ts` (`reminderSentAt` + unique index).
 *
 * Schedule (see `vercel.json`): daily 08:00 UTC = 09:00 clinic-local.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const sent = await sendReminders();
  return NextResponse.json({ ok: true, sent });
}