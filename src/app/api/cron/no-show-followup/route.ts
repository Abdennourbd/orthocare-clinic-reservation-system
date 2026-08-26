import { NextRequest, NextResponse } from "next/server";
import { markNoShows } from "@/lib/cron/noShow";
import { requireCronSecret } from "@/lib/security/cronAuth";

/**
 * Cron: mark past CONFIRMED appointments as NO_SHOW and send the follow-up
 * SMS (Task 9). Authenticated with the `CRON_SECRET` header. Idempotent — the
 * CONFIRMED→NO_SHOW transition guard means a re-run marks nothing.
 *
 * Schedule (see `vercel.json`): daily 17:00 UTC = 18:00 clinic-local, after
 * the clinic closes (working hours end 17:00 local).
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const marked = await markNoShows();
  return NextResponse.json({ ok: true, marked });
}