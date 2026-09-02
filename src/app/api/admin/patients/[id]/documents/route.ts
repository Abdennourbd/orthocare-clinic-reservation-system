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
import { PATIENTS_WRITE_RATE_LIMIT } from "@/lib/patients/rateLimits";
import { documentUploadSchema } from "@/schemas/document";
import { MAX_DOCUMENT_BYTES, validateDocumentBytes } from "@/lib/documents/mime";
import { buildBlobKey, putDocument } from "@/lib/documents/blobStorage";
import {
  BlobNotConfiguredError,
  BlobOperationError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
} from "@/lib/documents/errors";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 15 step 3 — POST (upload) + GET (list) for
// /api/admin/patients/[id]/documents. Both staff roles, explicitly (never a
// bare requireStaff — a role added later must fail closed), same convention
// as the sibling ../visits route.
//
// POST order is load-bearing: requireStaff -> CSRF -> rate limit ->
// formData (400) -> FILE SIZE (413, BEFORE arrayBuffer — an oversized file
// must never be fully buffered in memory, step-2 audit MINEUR-2) ->
// Zod metadata (400) -> 404 (patient) -> arrayBuffer -> byte-level
// validation (415/413) -> blob put -> DB row -> audit. The 404 comes AFTER
// body parsing so an authorized caller with a malformed body always gets 400
// (tests/authz-matrix.test.ts pins okStatus 400 on a bodyless POST), and the
// blob write happens only after every validation has passed — a rejected
// upload must never leave an orphan blob.
//
// `blobKey` never appears in any response, log or audit detail — it is
// written to the PatientDocument row only (step 4 reads it server-side to
// stream the private blob). Error messages are the FR strings of
// src/lib/documents/errors.ts, which never repeat the file name or the
// declared type.
//
// Next 16: `params` is a Promise — awaited before use.

// Same key/budget as the sibling read routes (60/5min) — declared locally,
// same as in ../route.ts and ../history/route.ts.
const READ_RATE_LIMIT = { limit: 60, windowMs: 5 * 60_000 };

/** Maps the domain's typed errors to their HTTP responses; `null` for any
 * other error, which the caller re-throws (500). */
function documentErrorResponse(error: unknown): Response | null {
  if (error instanceof DocumentTypeNotAllowedError) {
    return errorResponse(415, "DOCUMENT_TYPE_NOT_ALLOWED", error.message);
  }
  if (error instanceof DocumentTooLargeError) {
    return errorResponse(413, "DOCUMENT_TOO_LARGE", error.message);
  }
  if (error instanceof BlobNotConfiguredError) {
    return errorResponse(503, "BLOB_NOT_CONFIGURED", error.message);
  }
  if (error instanceof BlobOperationError) {
    return errorResponse(502, "BLOB_OPERATION_FAILED", error.message);
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  // Same shared write budget as POST /api/admin/patients, PATCH /[id] and
  // POST /[id]/visits (`staff:<userId>:patients-write`, 30/5min) — an
  // upload is the heaviest patient write of all, it belongs under the same
  // budget, not an unthrottled one.
  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Requête invalide.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse(400, "VALIDATION_ERROR", "Le fichier est requis.");
  }

  const parsed = documentUploadSchema.safeParse({
    name: formData.get("name"),
    declaredMimeType: formData.get("declaredMimeType"),
  });
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { id } = await params;

  const patient = await getPrisma().patient.findUnique({
    where: { id },
    select: { id: true, anonymizedAt: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-2 — an erased chart must never receive
  // a fresh document (a new radiograph would re-attach PHI to a supposedly-
  // erased identity, making the anonymization reversible in substance). Same
  // code and message as the sibling PATCH /[id] and POST /[id]/visits guards.
  if (patient.anonymizedAt !== null) {
    return errorResponse(
      409,
      "PATIENT_ANONYMIZED",
      "Cette fiche a été anonymisée et ne peut plus être modifiée.",
    );
  }

  // MINEUR-2 (step-2 audit): the size gate sits BEFORE arrayBuffer(), using
  // the multipart part's own declared size — a 500 MB upload is rejected
  // without ever being read into memory. The same cap is re-checked on the
  // actual bytes below (validateDocumentBytes, reason "SIZE") in case a
  // declared part size ever disagrees with the real content.
  try {
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new DocumentTooLargeError();
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Type -> extension -> content -> size, in mime.ts's exact order; all
    // must agree. The extension for the blob key comes from the VALIDATED
    // result — never from the user-supplied name.
    const validation = validateDocumentBytes({
      fileName: parsed.data.name,
      declaredMimeType: parsed.data.declaredMimeType,
      bytes,
    });
    if (!validation.ok) {
      if (validation.reason === "SIZE") {
        throw new DocumentTooLargeError();
      }
      // TYPE / EXTENSION_MISMATCH / CONTENT_MISMATCH — one flat 415 either
      // way, never a "best guess" correction (mime.ts header comment).
      throw new DocumentTypeNotAllowedError();
    }

    const blobKey = buildBlobKey(patient.id, validation.extension);
    await putDocument(blobKey, bytes, validation.mimeType);

    const document = await getPrisma().patientDocument.create({
      data: {
        patientId: patient.id,
        name: parsed.data.name,
        mimeType: validation.mimeType,
        sizeBytes: bytes.byteLength,
        blobKey,
        uploadedById: guard.user.id,
      },
    });

    // Detail carries ids and size only — never the file name (patient-
    // adjacent), never the blobKey (storage topology).
    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.PATIENT_DOCUMENT_UPLOADED,
      "PatientDocument",
      document.id,
      { patientId: patient.id, sizeBytes: document.sizeBytes },
      getClientIp(request.headers),
    );

    return withRefreshedSession(
      ok(
        {
          id: document.id,
          name: document.name,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          uploadedAt: document.uploadedAt,
        },
        { status: 201 },
      ),
      guard,
    );
  } catch (error) {
    const mapped = documentErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;

  // Same key/budget as GET /api/admin/patients, GET /[id] and GET /[id]/history
  // (`staff:<userId>:patients-read`, 60/5min, declared locally per route file
  // like the sibling routes) — listing documents is a patient read like any
  // other, it belongs under the shared read pool.
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
    select: { id: true, anonymizedAt: true },
  });
  if (!patient) {
    return errorResponse(404, "NOT_FOUND", "Patient introuvable.");
  }

  // task-13.md étape 5 tour 2, MAJEUR-2 — the read side mirrors the write
  // side: an erased chart's metadata list is closed off like every other
  // access to it. Same code and message as the sibling guards.
  if (patient.anonymizedAt !== null) {
    return errorResponse(
      409,
      "PATIENT_ANONYMIZED",
      "Cette fiche a été anonymisée et ne peut plus être modifiée.",
    );
  }

  const where = { patientId: patient.id, deletedAt: null };
  const [documents, total] = await Promise.all([
    getPrisma().patientDocument.findMany({
      where,
      // `id` tiebreak (same convention as [id]/history/route.ts, MAJEUR-3):
      // `uploadedAt` has millisecond precision, so two uploads in the same
      // millisecond must not fall back to whatever order Postgres returns.
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        uploadedAt: true,
        uploadedBy: { select: { name: true } },
      },
    }),
    getPrisma().patientDocument.count({ where }),
  ]);

  // Metadata only — no blobKey anywhere in the payload. uploadedBy reduced
  // to `name` only (same rule as createdBy on the patient record view).
  return withRefreshedSession(
    ok({
      items: documents.map((d) => ({
        id: d.id,
        name: d.name,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedBy?.name ?? null,
      })),
      total,
    }),
    guard,
  );
}
