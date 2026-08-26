import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

/**
 * Uptime probe (plan.md §Uptime & delivery monitoring, Task 9). No auth, no
 * data: it reports whether the app is up AND can reach its database — an
 * uptime check that only proves the process is running misses a dead DB.
 * 200 when healthy, 503 when the DB is unreachable.
 */
export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}