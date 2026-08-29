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
import { normalizePhoneE164 } from "@/lib/phone/normalize";
import { findDuplicateCandidates } from "@/lib/patients/duplicates";
import { PATIENTS_WRITE_RATE_LIMIT } from "@/lib/patients/rateLimits";
import { patientUpdateSchema } from "@/schemas/patient";
import { AuditAction, AuditActorType, type Prisma } from "@/generated/prisma/client";

// Task 13 step 5 — GET (single record, audited) + PATCH (edit, with the same
// duplicate-acknowledgement contract as POST /api/admin/patients) for
// /api/admin/patients/[id]. Both staff roles can read and edit; only ADMIN
// can flip `active` (task-13.md §Décisions d'architecture 3 — the sole
// destructive operation on this screen).
//
// Next 16: `params` is a Promise (CLAUDE.md "Next.js 16 gotchas") — every
// handler here awaits it before use.
//
// Order is load-bearing in every handler below: requireStaff -> (CSRF, on
// PATCH) -> rate limit (GET only) -> Zod -> domain checks (404 / role gate /
// duplicate detection) -> DB write. A 404 must NEVER precede a 401/403 — that
// is exactly what would let an anonymous caller learn "this patient id
// exists" from a status code alone (the id lives in the URL, the single most
// exposed surface of this task). The 404 message is byte-for-byte identical
// for "does not exist" and "exists but excluded" (there is only one 404
// reason here, but the convention is kept for consistency with the rest of
// this route family).

// Whitelist for GET's full record — deliberately wider than the list route's
// (task-13.md étape 5 spec): a staff member opening one chart needs
// email/birthDate/notes/consent/messaging prefs, but STILL never anything
// beyond this named set (no raw FK columns, `createdBy`/`updatedBy` reduced
// to `name` only).
const patientRecordSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  birthDate: true,
  notes: true,
  active: true,
  anonymizedAt: true,
  consentAt: true,
  consentVersion: true,
  messagingOptOut: true,
  whatsappOptIn: true,
  preferredLocale: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.PatientSelect;

// Same key/budget as GET /api/admin/patients (task-13.md §Contraintes
// obligatoires issues de l'audit de l'étape 4, point 1) — shared across all
// three read routes on purpose, so the directory-scraping budget is one pool
// per staff session, not one per endpoint.
const READ_RATE_LIMIT = { limit: 60, windowMs: 5 * 60_000 };

// `params` is typed `Promise<Record<string, string>>`, not the more specific
// `Promise<{ id: string }>` a Next 16 `[id]` folder would suggest — it must
// stay assignable to `RouteRow.handler` in tests/authz-matrix.test.ts, whose
// row.handler === routeModule[method] check (that file's step 2, tour 3
// hardening) requires the exported function to be usable BY REFERENCE, with
// no wrapper closure. Both are honest, awaited Promises either way; only the
// property-presence guarantee differs, and `id` is read the same way below.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  // task-13.md étape 5 tour 2, MINEUR-2 — explicit roles rather than a bare
  // `requireStaff(request)`: correct today because only ADMIN/RECEPTIONIST
  // exist, but fail-open the moment a third role is added later. Matches the
  // `allowed` column of tests/authz-matrix.test.ts for this route.
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

  const patient = await getPrisma().patient.findUnique({
    where: { id },
    select: patientRecordSelect,
  });
  if (!patient) {
    // Generic, identical to every other 404 in this route family — never
    // distinguishes "no such id" from "exists but withheld".
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Patient",
    id,
    { scope: "record" },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(patient), guard);
}

// The Patient columns PATCH is allowed to touch, in the exact form used to
// compute `changedFields` for the audit trail — field NAMES only, values
// never leave this function (task-13.md étape 5 spec: `detail.changedFields`
// must be a list of names, "jamais leurs valeurs").
const PATCHABLE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "birthDate",
  "notes",
  "messagingOptOut",
  "whatsappOptIn",
  "preferredLocale",
  "active",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  // task-13.md étape 5 tour 2, MINEUR-2 — see the identical comment on GET.
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-1 — a mutation deserves the same
  // budget as POST /api/admin/patients (`staff:<userId>:patients-write`,
  // 30/5min). Before this, editing or deactivating a chart had no rate
  // limit at all, unlike every other write in this task.
  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await params;

  const parsed = patientUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const data = parsed.data;

  // task-13.md §Décisions d'architecture 3 / §Points de vigilance étape 5 —
  // deactivation is ADMIN-only, and this check runs BEFORE any DB read: a
  // receptionist attempting it must never learn, via a 404 vs. 403
  // difference, whether the target id exists.
  //
  // Semantics of `active: false` — arbitrage rendu par l'utilisateur,
  // 2026-08-29 (task-13.md étape 5 tour 2): "désactivée = masquée, pas
  // bloquée". A deactivated record stays bookable online and editable here —
  // making it non-resolvable would force a NEW Patient row on every future
  // public booking attempt for that person, i.e. would MANUFACTURE
  // duplicates on every visit, which is worse than the soft-delete this
  // button exists to provide. `upsertPatient()`
  // (src/lib/booking/createBooking.ts) is deliberately NOT filtered on
  // `active` — only on `anonymizedAt` (a genuinely erased record must never
  // be resolved back into). The étape 8 button's label must say
  // "Désactiver", never "Supprimer" — nothing is deleted.
  if (data.active !== undefined && guard.user.role !== "ADMIN") {
    return errorResponse(403, "FORBIDDEN", "Accès refusé.");
  }

  // Phone format is validated as soon as it is present, before any DB call —
  // same order as POST /api/admin/patients.
  let newPhoneE164: string | undefined;
  if (data.phone !== undefined) {
    const normalized = normalizePhoneE164(data.phone);
    if (!normalized) {
      return errorResponse(422, "INVALID_PHONE", "Numéro de téléphone algérien invalide.");
    }
    newPhoneE164 = normalized;
  }

  const existing = await getPrisma().patient.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-2 — a record erased via
  // POST /[id]/anonymize (étape 6, ADMIN-only) must never be writable again
  // from this screen. Without this, PATCH would overwrite a placeholder
  // identity with a real name/phone again (the erasure would be reversible
  // from the UI), and findDuplicateCandidates() already excludes anonymized
  // rows (`anonymizedAt: null` in its where clause), so no 409 would ever
  // warn staff that they are re-identifying an erased patient.
  if (existing.anonymizedAt !== null) {
    return errorResponse(
      409,
      "PATIENT_ANONYMIZED",
      "Cette fiche a été anonymisée et ne peut plus être modifiée.",
    );
  }

  // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 4,
  // point 3 — PATCH must replay BOTH duplicate-acknowledgement gates, with
  // `excludeId: id` so a record never matches itself. Without this, editing
  // a name into a homonym's or editing a phone onto an already-registered
  // number would silently reopen exactly the hole POST's creation gates
  // exist to close — a receptionist could fabricate an identical
  // phone+name pair through an edit and make booking resolution ambiguous.
  const nameChanged = data.firstName !== undefined || data.lastName !== undefined;
  const phoneChanged = data.phone !== undefined;

  if (nameChanged || phoneChanged) {
    const candidates = await findDuplicateCandidates({
      firstName: data.firstName ?? existing.firstName,
      lastName: data.lastName ?? existing.lastName,
      phone: data.phone ?? existing.phone,
      excludeId: id,
    });
    const nameMatches = candidates.filter((c) => c.matchedOn.includes("NAME"));
    const phoneMatches = candidates.filter((c) => c.matchedOn.includes("PHONE"));
    // task-13.md étape 5 tour 2, BLOQUANT (ortho-security) — a candidate
    // matched on BOTH "PHONE" and "NAME" is a different class of risk than
    // either gate alone: after this write, the two records would be
    // indistinguishable to upsertPatient() (phone+name resolution), and
    // upsertPatient() departs the tie deterministically but ARBITRARILY.
    // Gating this only on the field the caller happens to be touching
    // (`nameChanged`/`phoneChanged`, as before) misses the ordinary case
    // where a father and son already share a name across two distinct
    // charts and a receptionist corrects one chart's phone to match the
    // other's, acknowledging only "this phone is shared" — the NAME gate is
    // then never evaluated because the name field itself did not change.
    // This check runs whenever either field changed (the outer `if` above),
    // regardless of which one, and demands BOTH acknowledgements together —
    // deliberately NOT removing the `nameChanged &&`/`phoneChanged &&`
    // conditions below, which still guard the two single-signal gates
    // against firing on a PRE-EXISTING homonymy the edit never touches.
    const dualMatches = candidates.filter(
      (c) => c.matchedOn.includes("PHONE") && c.matchedOn.includes("NAME"),
    );
    if (
      dualMatches.length > 0 &&
      (data.duplicateAcknowledged !== true || data.phoneSharingAcknowledged !== true)
    ) {
      await logAction(
        { type: AuditActorType.STAFF, userId: guard.user.id },
        AuditAction.PATIENT_RECORD_VIEWED,
        "Patient",
        dualMatches[0]?.id ?? "-",
        {
          scope: "indistinguishable-check",
          candidateCount: dualMatches.length,
          matchedOn: Array.from(new Set(dualMatches.flatMap((c) => c.matchedOn))),
        },
        getClientIp(request.headers),
      );
      return withRefreshedSession(
        Response.json(
          {
            error: {
              code: "INDISTINGUISHABLE_RECORDS",
              message:
                "Ce changement ferait correspondre le nom ET le téléphone d'un autre patient : ces deux fiches deviendront indiscernables pour la réservation en ligne. Confirmez les deux acquittements (nom et téléphone) pour continuer.",
            },
            duplicates: dualMatches,
          },
          { status: 409 },
        ),
        guard,
      );
    }

    if (nameChanged && nameMatches.length > 0 && data.duplicateAcknowledged !== true) {
      await logAction(
        { type: AuditActorType.STAFF, userId: guard.user.id },
        AuditAction.PATIENT_RECORD_VIEWED,
        "Patient",
        nameMatches[0]?.id ?? "-",
        {
          scope: "duplicate-check",
          candidateCount: nameMatches.length,
          matchedOn: Array.from(new Set(nameMatches.flatMap((c) => c.matchedOn))),
        },
        getClientIp(request.headers),
      );
      return withRefreshedSession(
        Response.json(
          {
            error: {
              code: "DUPLICATE_CANDIDATES",
              message: "Un patient similaire existe déjà. Vérifiez avant d'enregistrer.",
            },
            duplicates: nameMatches,
          },
          { status: 409 },
        ),
        guard,
      );
    }

    if (phoneChanged && phoneMatches.length > 0 && data.phoneSharingAcknowledged !== true) {
      await logAction(
        { type: AuditActorType.STAFF, userId: guard.user.id },
        AuditAction.PATIENT_RECORD_VIEWED,
        "Patient",
        phoneMatches[0]?.id ?? "-",
        {
          scope: "phone-sharing-check",
          candidateCount: phoneMatches.length,
          matchedOn: Array.from(new Set(phoneMatches.flatMap((c) => c.matchedOn))),
        },
        getClientIp(request.headers),
      );
      return withRefreshedSession(
        Response.json(
          {
            error: {
              code: "PHONE_ALREADY_REGISTERED",
              message:
                "Ce numéro est déjà utilisé par un autre patient. Confirmez qu'il s'agit d'un téléphone partagé.",
            },
            duplicates: phoneMatches,
          },
          { status: 409 },
        ),
        guard,
      );
    }
  }

  const changedFields = PATCHABLE_FIELDS.filter((field) => data[field] !== undefined);

  // Every Prisma field named explicitly (never `...data`) — same reasoning
  // as POST /api/admin/patients: `data` also carries
  // `duplicateAcknowledged`/`phoneSharingAcknowledged`, neither a Patient
  // column, and a raw spread would throw a PrismaClientValidationError whose
  // message serializes the patient's name/phone.
  // Unchecked variant (like POST /api/admin/patients): the scalar FK
  // `updatedById` is set directly, not via a nested `updatedBy: { connect }`.
  const updateData: Prisma.PatientUncheckedUpdateInput = { updatedById: guard.user.id };
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.phone !== undefined && newPhoneE164 !== undefined) {
    updateData.phone = data.phone;
    updateData.phoneE164 = newPhoneE164;
  }
  if (data.email !== undefined) updateData.email = data.email ? data.email : null;
  if (data.birthDate !== undefined) {
    updateData.birthDate = data.birthDate ? new Date(data.birthDate) : null;
  }
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.messagingOptOut !== undefined) updateData.messagingOptOut = data.messagingOptOut;
  if (data.whatsappOptIn !== undefined) updateData.whatsappOptIn = data.whatsappOptIn;
  if (data.preferredLocale !== undefined) updateData.preferredLocale = data.preferredLocale;
  // Reached only when role === ADMIN (checked above).
  if (data.active !== undefined) updateData.active = data.active;

  const updated = await getPrisma().patient.update({
    where: { id },
    data: updateData,
    select: patientRecordSelect,
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_UPDATED,
    "Patient",
    id,
    // Field NAMES only — never a value, never even for `notes`/`birthDate`.
    // Exception: `active` itself (task-13.md étape 5 tour 2, MINEUR-1) — a
    // boolean, not patient data, but `changedFields` alone doesn't say
    // whether this write deactivated or reactivated the chart, the one
    // destructive-looking operation on this screen.
    { changedFields, ...(data.active !== undefined ? { active: data.active } : {}) },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(updated), guard);
}
