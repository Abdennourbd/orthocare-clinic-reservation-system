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
 * Schedule (see `vercel.json`): hourly at minute 0 UTC. Clinic-local hour
 * varies (UTC+1, no DST); an hourly cadence keeps stale slots freed promptly.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const expired = await expirePendingBookings();
  return NextResponse.json({ ok: true, expired });
}