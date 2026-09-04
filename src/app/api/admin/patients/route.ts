import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { logActionSafe } from "@/lib/audit/logAction";
import { getClientIp } from "@/lib/security/clientIp";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { normalizePhoneE164 } from "@/lib/phone/normalize";
import { findDuplicateCandidates, normalizeName } from "@/lib/patients/duplicates";
import { PATIENTS_WRITE_RATE_LIMIT } from "@/lib/patients/rateLimits";
import { readConsentVersion } from "@/lib/booking/policy";
import { patientCreateSchema, patientListQuerySchema } from "@/schemas/patient";
import { AuditAction, AuditActorType, type Prisma } from "@/generated/prisma/client";

// Task 13 step 4 — GET (list/search) + POST (create with duplicate
// acknowledgement) /api/admin/patients. Both staff roles can read and create
// a patient; only deactivation and anonymization (steps 5-6) are ADMIN-only
// (task-13.md §Décisions d'architecture 3).
//
// GET IS audited (task-13.md §Exigences point 6 — a dated user ruling that
// overrides the step card's stale "the list route does not audit" note: a
// name/phone search is itself a read of patient data). `detail` carries a
// result count only — the search string `q` is NEVER written to the audit
// log, since it can itself contain a patient's name.
//
// The 409 DUPLICATE_CANDIDATES branch of POST is ALSO audited
// (task-13.md step-3 Journal, ortho-security audit, MAJEUR point 1): a 409
// writes nothing to the database, so without this a compromised
// receptionist session could replay the duplicate check indefinitely and
// harvest {id, firstName, lastName, phone} of unrelated patients with zero
// trace — while the identical data returned by GET's search IS logged. That
// asymmetry is the defect this closes. `detail` there is counters and match
// reasons only, never a candidate's name, phone, nor the submitted query.
//
// Task 13 étape 4 tour 2 — TWO separate acknowledgement gates, not one
// (ortho-security BLOCKING finding, user-authorized fix). Dismissing a
// homonym warning (`duplicateAcknowledged`, NAME match) used to also silently
// dismiss a phone-sharing warning (PHONE match): a receptionist confirming
// "this is a different person" never consciously confirmed "this phone
// number is already registered to someone else". Since a shared phone is
// legitimate (Algerian families share one — `phoneE164` is indexed but
// deliberately NOT `@unique`, prisma/schema.prisma:97) and
// upsertPatient() (src/lib/booking/createBooking.ts) resolves a later public
// booking on phone+name, an unacknowledged phone match left two records
// silently sharing a number with no distinct trace of who agreed to that.
// A PHONE match now requires its own `phoneSharingAcknowledged` and gets its
// own 409 code (`PHONE_ALREADY_REGISTERED`), audited the same way as the
// NAME branch (`scope: "phone-sharing-check"`, counters/enums only).
//
// Task 13 étape 5 — two debts closed here, carried forward by the étape 4
// tour-1 ortho-security audit (task-13.md étape 4 Journal, "2 MAJEUR portés
// en dette"):
//  1. GET (and the two new /[id]* GETs of this step) are now rate-limited
//     under the SAME `staff:<userId>:patients-read` key — 60 req/5min. Before
//     this, the entire patient directory was scrapeable in `ceil(N/200)`
//     unthrottled requests (25 for 5,000 patients). IP-keyed would either do
//     nothing (one shared clinic IP) or lock out the whole front desk, same
//     reasoning as the write limiter below.
//  2. POST now writes `consentAt`/`consentVersion` on every staff-created
//     record, matching the public booking path
//     (src/app/api/appointments/route.ts:132-133). Before this, a
//     front-desk-created record was opt-in-by-default (`messagingOptOut`
//     defaults to `false`) with zero evidence anyone ever consented.
//
// Also closed here (task-13.md §Contraintes obligatoires issues de l'audit
// de l'étape 4, points 4-5): the 409 DUPLICATE_CANDIDATES branch used to leak
// `candidates` (the FULL merged list, including phone-only matches) instead
// of `nameMatches` — staff learned the identity of a phone-sharing record
// without ever tripping the phone gate. And PATIENT_CREATED's audit detail
// carried a single `acknowledgedDuplicates` counter that conflated both
// gates; it is now the two counters that actually correspond to the two
// independent acknowledgements.

const DEFAULT_LIMIT = 50;

// Read rate limit — see the header comment above. Applied identically to
// this list route and to GET /[id] and GET /[id]/history (step 5).
const READ_RATE_LIMIT = { limit: 60, windowMs: 5 * 60_000 };

// The whitelist for both the GET list rows and the POST 201 response —
// never `notes`, `email` nor `birthDate` here (task-13.md step-4 spec).
const patientListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  active: true,
  anonymizedAt: true,
  createdAt: true,
} satisfies Prisma.PatientSelect;

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-read`, READ_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsedQuery = patientListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedQuery.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Paramètres de requête invalides.");
  }
  const { q, active } = parsedQuery.data;
  const limit = Math.min(parsedQuery.data.limit ?? DEFAULT_LIMIT, 200);
  const page = parsedQuery.data.page ?? 1;

  // Default: active patients only. "all" removes the filter; "false" lists
  // only the soft-deleted ones (still readable by staff, never destroyed).
  const activeFilter: boolean | undefined =
    active === "all" ? undefined : active === "false" ? false : true;

  // Search matches firstName/lastName two ways at once. The plain ILIKE
  // clauses below cover exact/case-insensitive matches and — critically —
  // degrade gracefully on any row whose `*Normalized` column is still NULL
  // (production cannot run the task-13 étape 9a backfill script live, see
  // that step's Journal MAJEUR-2 debt), so they stay exactly as they were.
  // Task 13 étape 9b adds `firstNameNormalized`/`lastNameNormalized`
  // `contains` clauses (task-13.md étape 9a) alongside them: those columns
  // are kept in sync by every write path and let `contains` match across
  // Latin accents and Arabic diacritics/tatweel, which plain ILIKE cannot
  // do. Neither the old nor the new `contains` is indexed — a leading-
  // wildcard `LIKE '%...%'` has no B-tree to ride without `pg_trgm`, which
  // the user's 2026-08-28 ruling forbids adding — an already-accepted
  // performance trade-off for this list, not a regression introduced here.
  // OR the phone, tried first as a full normalized E.164 value and, when
  // that fails (a partial number, or non-digit noise), as a raw-digit
  // substring match — a receptionist may only remember the last few digits.
  let orClauses: Prisma.PatientWhereInput[] | undefined;
  if (q) {
    const phoneE164Query = normalizePhoneE164(q);
    const digitsOnly = q.replace(/\D/g, "");
    // TWO independent protections are required on the four name clauses
    // below, neither one substitutes for the other (task-13.md étape 9b
    // tour 2, ortho-security MAJEUR-1 — a prior version of this comment
    // wrongly claimed the length guard alone was sufficient; it is not).
    //
    // 1) Prisma's `contains` compiles to Postgres
    //    `LIKE ('%' || $1 || '%')` with NO `ESCAPE` clause and NO escaping
    //    of the parameter — so `%` and `_`, Postgres LIKE metacharacters,
    //    pass straight through from `q` and act as wildcards. `likeTerm`
    //    strips `\`, `%` and `_` (the three LIKE metacharacters) before `q`
    //    reaches either an ILIKE clause or `normalizeName()`. Measured:
    //    without this, `q = "%"` alone matched every patient row.
    // 2) Stripping metacharacters (or normalizeName() folding diacritics,
    //    e.g. a lone tatweel U+0640) can reduce a non-empty `q` down to an
    //    EMPTY string. A Prisma `{ contains: "" }` compiles to Postgres
    //    `LIKE '%%'`, which matches EVERY row — so ALL FOUR name clauses
    //    below are gated on their term's `.length > 0`, not just the two
    //    `*Normalized` ones. Do not remove or "simplify" either guard:
    //    dropping (1) lets `%`/`_` act as wildcards even with a non-empty
    //    term; dropping (2) on the ILIKE clauses alone reproduces the
    //    original bug the moment `likeTerm` empties out (task-13.md étape
    //    9b, point 2, and tour-2 MAJEUR-1 fix).
    const likeTerm = q.replace(/[\\%_]/g, "");
    const normalizedQ = likeTerm ? normalizeName(likeTerm) : "";
    orClauses = [
      ...(likeTerm.length > 0
        ? [
            { firstName: { contains: likeTerm, mode: "insensitive" as const } },
            { lastName: { contains: likeTerm, mode: "insensitive" as const } },
          ]
        : []),
      ...(normalizedQ.length > 0
        ? [
            { firstNameNormalized: { contains: normalizedQ } },
            { lastNameNormalized: { contains: normalizedQ } },
          ]
        : []),
      ...(phoneE164Query
        ? [{ phoneE164: { contains: phoneE164Query } }]
        : digitsOnly
          ? [{ phoneE164: { contains: digitsOnly } }]
          : []),
    ];
  }

  const where: Prisma.PatientWhereInput = {
    ...(activeFilter !== undefined ? { active: activeFilter } : {}),
    ...(orClauses ? { OR: orClauses } : {}),
  };

  const [total, patients] = await Promise.all([
    getPrisma().patient.count({ where }),
    getPrisma().patient.findMany({
      where,
      // Secondary/tertiary sort keys: two patients can share a last+first
      // name, and `id` guarantees a deterministic order across pages.
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      take: limit,
      skip: (page - 1) * limit,
      select: patientListSelect,
    }),
  ]);

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_RECORD_VIEWED,
    "Patient",
    "list",
    { scope: "list", resultCount: patients.length },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ patients, total, page, limit }), guard);
}

// Rate-limit key is the STAFF SESSION's userId, never the caller's IP
// (task-13.md step-3 Journal, ortho-security audit, MAJEUR point 2): a
// single-site clinic sits behind one shared public IP, so an IP-keyed limit
// would either do nothing useful (one shared bucket for the whole front
// desk) or lock the entire clinic out from one bad actor's traffic — the
// session's userId is the only identifier here a caller cannot forge or
// share. This is also what caps how many times a single compromised session
// can replay the free, side-effect-free 409 DUPLICATE_CANDIDATES probe
// (an id/name/phone oracle over other patients). Budget itself now lives in
// `@/lib/patients/rateLimits` (task-13.md étape 5 tour 2, MAJEUR-1) — shared
// with PATCH /[id] and POST /[id]/visits instead of redeclared per file.

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const parsed = patientCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  // task-13.md step-3 Journal, ortho-security audit, MAJEUR point 3 —
  // reproduces the public booking route's guard verbatim
  // (src/app/api/appointments/route.ts:77-84), 422 status included: the
  // step card guessed 400 INVALID_PHONE, but this repo already has exactly
  // one precedent for "phone fails to normalize" and consistency with it
  // wins (see this step's Journal entry for the full reasoning). Without
  // this guard a Patient would be written with a fabricated phoneE164,
  // silently breaking duplicate detection, upsertPatient() and messaging.
  const phoneE164 = normalizePhoneE164(parsed.data.phone);
  if (!phoneE164) {
    return errorResponse(422, "INVALID_PHONE", "Numéro de téléphone algérien invalide.");
  }

  const candidates = await findDuplicateCandidates({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    phone: parsed.data.phone,
  });

  // Task 13 étape 4 tour 2 (ortho-security BLOCKING finding, user-authorized
  // fix): a single `duplicateAcknowledged` flag used to gate BOTH a homonym
  // warning and a phone-sharing warning, so acknowledging "this is a
  // different person" (legitimate — Algerian families share one phone) also
  // silently acknowledged "this phone is already registered", with no
  // distinct trace. Split the two: a candidate matched by NAME is gated by
  // `duplicateAcknowledged` as before; a candidate matched by PHONE requires
  // its own `phoneSharingAcknowledged`, with its own 409 code, so the two
  // gestures can never be conflated by a single click.
  const nameMatches = candidates.filter((c) => c.matchedOn.includes("NAME"));
  const phoneMatches = candidates.filter((c) => c.matchedOn.includes("PHONE"));

  if (nameMatches.length > 0 && parsed.data.duplicateAcknowledged !== true) {
    // See the header comment: this read of other patients' identity must be
    // audited exactly like GET's search is. `detail` is counters/enums
    // only — never a candidate's name or phone, never the submitted values.
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.PATIENT_RECORD_VIEWED,
      "Patient",
      candidates[0]?.id ?? "-",
      {
        scope: "duplicate-check",
        candidateCount: candidates.length,
        matchedOn: Array.from(new Set(candidates.flatMap((c) => c.matchedOn))),
      },
      getClientIp(request.headers),
    );
    // errorResponse() is left untouched (shared helper) — the 409 envelope
    // is built by hand here so `duplicates` can ride alongside the standard
    // `{ error: { code, message } }` shape (task-13.md §Décisions
    // d'architecture 1).
    // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 4,
    // point 4 — `nameMatches` only, never the full `candidates` array. The
    // full array also carries phone-only matches, which would let staff
    // learn the identity of a phone-sharing record without ever tripping the
    // dedicated PHONE_ALREADY_REGISTERED gate below (minimal disclosure).
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

  if (phoneMatches.length > 0 && parsed.data.phoneSharingAcknowledged !== true) {
    // Same audit discipline as the NAME branch above — counters and enums
    // only, never the candidate's or the submitted patient's name/phone.
    await logActionSafe(
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

  // task-13.md step-3 Journal, ortho-security audit, MAJEUR point 5 — build
  // the Prisma payload from explicit named fields, never `parsed.data`
  // itself or a `{ ...parsed.data }` spread. `duplicateAcknowledged` always
  // survives Zod parsing (it carries a `.default(false)`) but is not a
  // Patient column: passing it through would throw a
  // PrismaClientValidationError whose message SERIALIZES the offending
  // arguments — the patient's name and phone — a risk that a
  // destructure-then-spread only defers to the next schema field that isn't
  // a column. Naming every field here is what actually forecloses it.
  // task-13.md §Contraintes obligatoires issues de l'audit de l'étape 4,
  // point 2 — a staff-created record must carry the same consent evidence as
  // a public booking (src/app/api/appointments/route.ts:132-133). Without
  // this, `messagingOptOut` defaulting to `false` made a counter-created
  // record opt-in-by-default with zero proof anyone ever agreed to it.
  const consentVersion = await readConsentVersion();
  const patientData = parsed.data;
  const patient = await getPrisma().patient.create({
    data: {
      firstName: patientData.firstName,
      lastName: patientData.lastName,
      // Task 13 étape 9a — bilingual search columns, reused from
      // findDuplicateCandidates()'s own normalizer, never reimplemented.
      firstNameNormalized: normalizeName(patientData.firstName),
      lastNameNormalized: normalizeName(patientData.lastName),
      phone: patientData.phone,
      phoneE164,
      email: patientData.email ? patientData.email : null,
      birthDate: patientData.birthDate ? new Date(patientData.birthDate) : null,
      notes: patientData.notes,
      messagingOptOut: patientData.messagingOptOut,
      whatsappOptIn: patientData.whatsappOptIn,
      preferredLocale: patientData.preferredLocale,
      consentAt: new Date(),
      consentVersion,
      createdById: guard.user.id,
      updatedById: guard.user.id,
    },
    select: patientListSelect,
  });

  await logActionSafe(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_CREATED,
    "Patient",
    patient.id,
    // Two counters, never the name/phone/email just written — one per
    // independent acknowledgement gate (task-13.md §Contraintes point 5).
    {
      acknowledgedNameDuplicates: nameMatches.length,
      acknowledgedPhoneSharing: phoneMatches.length,
    },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok(patient, { status: 201 }), guard);
}
