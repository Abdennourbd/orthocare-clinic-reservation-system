import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { APPOINTMENTS_READ_RATE_LIMIT } from "@/lib/booking/rateLimits";
import { readBookingPolicy } from "@/lib/booking/policy";
import { AppointmentStatus, AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 14 step 2 — GET /api/admin/appointments/pending: the call queue.
// PENDING bookings awaiting a confirmation call, OLDEST FIRST (createdAt asc,
// id as the deterministic tiebreaker), each with the moment it auto-expires
// (createdAt + the booking policy's pendingExpiryHours — the exact window the
// expiry cron enforces, src/lib/cron/expirePending.ts) and the milliseconds
// left before it. Negative msRemaining means the cron is overdue on it.
//
// All PENDING appointments are listed, ONLINE and MANUAL alike: a MANUAL
// PENDING row is a staff decision (expirePending.ts comment) and the front
// desk still needs to call it; the queue's job is visibility, not expiry
// mechanics.
//
// Order is load-bearing: requireStaff -> rate limit -> (no body) -> DB read.
// Read budget is shared with the other appointment reads (one pool per staff
// session — see src/lib/booking/rateLimits.ts). The queue exposes patient
// names/phones, so the read IS audited — counters only, never a name/phone.

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:appointments-read`, APPOINTMENTS_READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const now = new Date();
  // Same policy value the expiry cron uses — the queue and the cron can never
  // disagree about when a pending booking dies.
  const policy = await readBookingPolicy();

  // Named fields only, never a model spread. Bounded: the queue UI pages
  // through the oldest first, and an unhealthy backlog (lapsed expiry cron)
  // must not turn the receptionist's most-opened screen into an unbounded
  // scan — the [status, createdAt] index serves this exact filter+order.
  const pending = await getPrisma().appointment.findMany({
    where: { status: AppointmentStatus.PENDING },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      createdAt: true,
      startTime: true,
      endTime: true,
      source: true,
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
    },
  });

  const appointments = pending.map((a) => {
    const expiresAt = new Date(
      a.createdAt.getTime() + policy.pendingExpiryHours * 3600_000,
    );
    // Named fields only, never a spread — same discipline as the rest of the
    // route family. expiresAt is derived, not stored. msRemaining can be
    // negative (cron overdue).
    return {
      id: a.id,
      createdAt: a.createdAt,
      startTime: a.startTime,
      endTime: a.endTime,
      source: a.source,
      patient: a.patient,
      service: a.service,
      expiresAt: expiresAt.toISOString(),
      msRemaining: expiresAt.getTime() - now.getTime(),
    };
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Appointment",
    "list",
    { scope: "call-queue", resultCount: appointments.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ appointments, now: now.toISOString() }), guard);
}
