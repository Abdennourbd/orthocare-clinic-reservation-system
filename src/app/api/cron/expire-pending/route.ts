import { NextRequest, NextResponse } from "next/server";
import { expirePendingBookings } from "@/lib/cron/expirePending";
import { requireCronSecret } from "@/lib/security/cronAuth";

/**
 * Cron: auto-cancel unconfirmed PENDING bookings past `pendingExpiryHours` —
 * and always before the appointment would start — via `releaseSlot()` so the
 * slot frees and the waitlist fires (Task 9). Authenticated with the
 * `CRON_SECRET` header. Idempotent — the PENDING status filter plus
 * `releaseSlot`'s active-only guard make a re-run a no-op.
 *
 * Schedule (see `vercel.json`): daily at 02:00 UTC (03:00 local). The Hobby
 * plan limits cron jobs to once per day, so this runs daily rather than
 * hourly; `pendingExpiryHours` (default 24h) plus the "always before start"
 * rule make the exact cadence a latency choice, not a correctness one. On the
 * Pro plan it can be tightened back to hourly if the clinic wants stale slots
 * freed faster.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const expired = await expirePendingBookings();
  return NextResponse.json({ ok: true, expired });
}