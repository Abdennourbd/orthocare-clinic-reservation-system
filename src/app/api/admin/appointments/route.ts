import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { logAction } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { bookSlot, SlotConflictError } from "@/lib/booking/bookSlot";
import { ServiceNotFoundError } from "@/lib/booking/errors";
import {
  APPOINTMENTS_READ_RATE_LIMIT,
  APPOINTMENTS_WRITE_RATE_LIMIT,
} from "@/lib/booking/rateLimits";
import { appointmentListQuerySchema, manualBookingSchema } from "@/schemas/appointment";
import { toClinicLocalDateString, getClinicDayBoundsUTC } from "@/lib/time/clinicTime";
import {
  AppointmentSource,
  AppointmentStatus,
  AuditAction,
  AuditActorType,
} from "@/generated/prisma/client";

// Task 14 step 2 — GET (day view) + POST (manual booking) for
// /api/admin/appointments. Both staff roles can read the day view and create
// a manual booking (explicit roles, never a bare requireStaff — a third role
// added later must fail closed).
//
// Order is load-bearing in every handler: requireStaff -> (CSRF, on POST) ->
// rate limit -> Zod -> domain checks (404 patient / 409 slot) -> DB write.
// A 404 must NEVER precede a 401/403.
//
// Rate limits are keyed on the staff session's userId, never the IP (see
// src/lib/booking/rateLimits.ts — one shared public IP for the whole front
// desk). Audit `detail` never carries patient-identifying values: dates,
// counters, enums and ids only.
//
// Reads ARE audited (PATIENT_RECORD_VIEWED, same user ruling as the patient
// directory — a day view / its rows expose patient names and phone numbers,
// and the route family convention is that reads of patient-identifying data
// leave a trace).

// GET's row shape: named fields only (never a model spread — a spread leaks
// non-column keys and can serialize PII in a PrismaClientValidationError).
const appointmentRowSelect = {
  id: true,
  startTime: true,
  endTime: true,
  status: true,
  source: true,
  patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
} as const;

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

  const url = new URL(request.url);
  const parsedQuery = appointmentListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }

  // "Today" is the CLINIC's today (Africa/Algiers), not the server's — all
  // date maths goes through lib/time/clinicTime.ts, the only module that
  // knows the timezone.
  const date = parsedQuery.data.date ?? toClinicLocalDateString(new Date());
  const { startUTC, endUTC } = getClinicDayBoundsUTC(date);

  const appointments = await getPrisma().appointment.findMany({
    where: {
      startTime: { gte: startUTC, lte: endUTC },
      ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    select: appointmentRowSelect,
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Appointment",
    "list",
    // Date + counter + optional enum only — never a patient name/phone.
    { scope: "day-view", date, resultCount: appointments.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ date, appointments }), guard);
}

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:appointments-write`, APPOINTMENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = manualBookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const { patientId, serviceId, startTime, resourceId, notes, locale } = parsed.data;

  const startUTC = new Date(startTime);
  if (Number.isNaN(startUTC.getTime())) {
    return errorResponse(400, "VALIDATION_ERROR", "Date/heure de début invalide.");
  }

  // Domain check BEFORE any write: the patient must exist. The service's
  // existence is checked inside bookSlot (ServiceNotFoundError below) — one
  // 404 shape per missing entity, never a spread of internals.
  const patient = await getPrisma().patient.findUnique({
    where: { id: patientId },
    select: { id: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // Manual booking = CONFIRMED appointment that BLOCKS its slot, created
  // through bookSlot() so the availability re-check (working hours, lead
  // time, horizon, overlap, closures) and the per-day advisory lock apply
  // exactly as to a public booking. No slot-conflict retries here: the front
  // desk picks another time, like the online patient.
  let appointment;
  try {
    appointment = await bookSlot({
      patientId,
      serviceId,
      startUTC,
      resourceId: resourceId ?? null,
      source: AppointmentSource.MANUAL,
      status: AppointmentStatus.CONFIRMED,
    });
  } catch (e) {
    if (e instanceof SlotConflictError) {
      return errorResponse(409, "SLOT_CONFLICT", "Ce créneau n'est pas disponible.");
    }
    if (e instanceof ServiceNotFoundError) {
      return errorResponse(404, "NOT_FOUND", "Service introuvable.");
    }
    throw e;
  }

  // bookSlot() does not know the staff actor or the free-text note (it is the
  // shared public-booking path); stamp them right after the commit. Named
  // fields only, never a spread.
  const [updated] = await getPrisma().$transaction([
    getPrisma().appointment.update({
      where: { id: appointment.id },
      data: {
        createdByUserId: guard.user.id,
        // The Appointment model's only free-text column — the front-desk
        // note rides on the appointment itself.
        ...(notes !== undefined ? { visitNotes: notes } : {}),
      },
      select: appointmentRowSelect,
    }),
    // Same convention as the public booking (locale -> preferredLocale so
    // later messaging knows the patient's language without asking again).
    getPrisma().patient.update({
      where: { id: patientId },
      data: { preferredLocale: locale },
      select: { id: true },
    }),
  ]);

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    // No dedicated creation action exists; the appointment is created
    // CONFIRMED, so APPOINTMENT_CONFIRMED is the semantically correct trace.
    AuditAction.APPOINTMENT_CONFIRMED,
    "Appointment",
    appointment.id,
    // Ids, enum and the slot instant only — no patient name/phone, no note.
    {
      scope: "manual-booking",
      source: AppointmentSource.MANUAL,
      serviceId,
      startTime: startUTC.toISOString(),
    },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(updated, { status: 201 }), guard);
}
