import { NextRequest } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { AppointmentStatus, AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 13 step 5 — GET /api/admin/patients/[id]/history: the unified
// timeline, `COMPLETED` appointments UNION `Visit` rows (plan.md §Domain /
// Data Model, prisma/schema.prisma comment on `model Visit`). Two plain
// Prisma queries, merged and sorted in TypeScript — no raw SQL, per
// task-13.md étape 5 spec.
//
// Same guard order as the sibling [id]/route.ts: requireStaff -> rate limit
// -> Zod (pagination) -> 404 -> reads. The 404 message matches [id]/route.ts
// verbatim.

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});

const DEFAULT_LIMIT = 50;

// Same key/budget as GET /api/admin/patients and GET /[id] — one shared pool
// per staff session across all read routes (task-13.md §Contraintes point 1).
const READ_RATE_LIMIT = { limit: 60, windowMs: 5 * 60_000 };

type TimelineItem = {
  kind: "APPOINTMENT" | "VISIT";
  id: string;
  date: Date;
  serviceName: string | null;
  type: string | null;
  notes: string | null;
  treatment: string | null;
  status: string | null;
};

// `params` is `Promise<Record<string, string>>` rather than the more
// specific `Promise<{ id: string }>` — see the identical comment in the
// sibling ../route.ts: it must stay assignable to RouteRow.handler in
// tests/authz-matrix.test.ts by direct reference, no wrapper closure.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  // task-13.md étape 5 tour 2, MINEUR-2 — explicit roles, see the identical
  // comment in the sibling ../route.ts.
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-read`, READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await params;

  const url = new URL(request.url);
  const parsedQuery = historyQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const limit = Math.min(parsedQuery.data.limit ?? DEFAULT_LIMIT, 200);
  const page = parsedQuery.data.page ?? 1;

  const patient = await getPrisma().patient.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-3 — `orderBy` with an `id` tiebreak on
  // BOTH source queries (not just the TS-side merge sort below): `Visit.date`
  // is routinely an exact-midnight-UTC tie (visitCreateSchema.date accepts a
  // bare "YYYY-MM-DD", so every same-day visit shares the identical
  // millisecond), and `Array.prototype.sort` on a tied key falls back to
  // whatever row order Postgres happened to return — not guaranteed, and can
  // change between two calls (an UPDATE, a VACUUM). Without a deterministic
  // order end to end, a paginated timeline can show one visit twice and skip
  // another. See also trap_createdAt_tie_no_tiebreak (agent memory) for the
  // same class of bug elsewhere in this task.
  const [appointments, visits] = await Promise.all([
    getPrisma().appointment.findMany({
      where: { patientId: id, status: AppointmentStatus.COMPLETED },
      orderBy: [{ startTime: "desc" }, { id: "desc" }],
      select: {
        id: true,
        startTime: true,
        visitNotes: true,
        status: true,
        service: { select: { name: true } },
      },
    }),
    getPrisma().visit.findMany({
      where: { patientId: id },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: {
        id: true,
        date: true,
        type: true,
        notes: true,
        treatment: true,
        service: { select: { name: true } },
      },
    }),
  ]);

  const items: TimelineItem[] = [
    ...appointments.map(
      (a): TimelineItem => ({
        kind: "APPOINTMENT",
        id: a.id,
        date: a.startTime,
        serviceName: a.service
          ? localized(a.service.name as LocalizedField, "fr")
          : null,
        type: null,
        notes: a.visitNotes,
        treatment: null,
        status: a.status,
      }),
    ),
    ...visits.map(
      (v): TimelineItem => ({
        kind: "VISIT",
        id: v.id,
        date: v.date,
        serviceName: v.service
          ? localized(v.service.name as LocalizedField, "fr")
          : null,
        type: v.type,
        notes: v.notes,
        treatment: v.treatment,
        status: null,
      }),
    ),
  ]
    // Tiebreak on `id` (task-13.md étape 5 tour 2, MAJEUR-3): the two source
    // queries above are each individually deterministic on ties now, but
    // merging APPOINTMENT and VISIT rows into one array re-introduces the
    // same ambiguity across sources — two items sharing the exact same
    // `date` need a total order that does not depend on which source array
    // TypeScript happened to concatenate first.
    .sort((a, b) => {
      const byDate = b.date.getTime() - a.date.getTime();
      if (byDate !== 0) return byDate;
      return b.id.localeCompare(a.id);
    });

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Patient",
    id,
    { scope: "history" },
    getClientIp(request.headers),
  );

  return withRefreshedSession(
    ok({
      items: paged.map((item) => ({ ...item, date: item.date.toISOString() })),
      total,
      page,
      limit,
    }),
    guard,
  );
}
