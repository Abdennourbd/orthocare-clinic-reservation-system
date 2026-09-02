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
import { getDocumentStream, deleteDocument } from "@/lib/documents/blobStorage";
import {
  BlobNotConfiguredError,
  BlobOperationError,
} from "@/lib/documents/errors";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 15 step 4 — GET (download) + DELETE (soft delete) for a single
// PatientDocument, addressed by document id at /api/admin/documents/[id].
// Here the document itself is the resource: the guard is followed by a
// direct row lookup, and missing vs soft-deleted are answered with the
// SAME 404 (same status, same code, same message) — a deleted radiography's
// existence is never confirmed (audit MAJEUR-1).
//
// Anonymized-chart read-closure (fix round 1): the lookup joins the owning
// patient's `anonymizedAt`, and an ERASED chart's documents answer the SAME
// indistinguishable 404 — deliberately a 404, not the sibling list route's
// 409 PATIENT_ANONYMIZED. A 409 here would confirm that a document exists
// for an identity whose whole point is to be erased (document ids persist
// in audit logs via entityId), collapsing the very indistinguishability
// this surface guarantees for deleted vs nonexistent. The blob itself is
// untouched: the frozen "should anonymization delete documents" decision
// stays frozen — this is read-closure only.
//
// GET order is load-bearing: requireStaff -> rate limit -> 404 ->
// getDocumentStream -> audit -> stream. The blob is only touched after the
// row passed the deletedAt AND anonymizedAt checks, and the download is
// audited BEFORE the bytes leave the server.
//
// DELETE order is load-bearing (task-15.md §Décisions d'architecture 7):
// mark deletedAt + deletedById FIRST, then deleteDocument(blobKey). By the
// time the blob delete runs the row is already hidden, so a blob failure
// leaves an unreachable private orphan — answered 200 with `blobDeleted:
// false` and audited that way (ruling: no blobDeletedAt column, no retry
// loop — the residual blob is unreachable without the store token).
//
// `blobKey` never appears in any response, log or audit detail — it is read
// from the row and passed to the adapter only. Audit details carry ids and
// size only, never the file name (patient-adjacent). Error messages are the
// FR strings of src/lib/documents/errors.ts.
//
// Next 16: `params` is a Promise — awaited before use.

// Same shared read/write budgets as the sibling patient routes
// (`staff:<userId>:patients-read` 60/5min, `staff:<userId>:patients-write`
// 30/5min) — a download is a patient read, a delete is a patient write;
// neither gets its own unthrottled bucket. Declared locally per route file,
// same convention as the siblings.
const READ_RATE_LIMIT = { limit: 60, windowMs: 5 * 60_000 };

/** Maps the blob adapter's typed errors to their HTTP responses; `null` for
 * any other error, which the caller re-throws (500). Same mapping as the
 * step-3 upload route (minus the upload-only 415/413). */
function documentErrorResponse(error: unknown): Response | null {
  if (error instanceof BlobNotConfiguredError) {
    return errorResponse(503, "BLOB_NOT_CONFIGURED", error.message);
  }
  if (error instanceof BlobOperationError) {
    return errorResponse(502, "BLOB_OPERATION_FAILED", error.message);
  }
  return null;
}

/** RFC 5987 Content-Disposition for the download (audit MAJEUR-1): an Arabic
 * `name` — the common case in this Algiers clinic — passed raw to
 * `Headers.set` throws TypeError, and a raw non-ASCII byte in the header
 * value is illegal anyway. So: an ASCII-only fallback in the legacy
 * `filename=` parameter, and `filename*=UTF-8''…` carrying
 * encodeURIComponent(name) with `'` post-encoded to %27 (encodeURIComponent
 * leaves `'` untouched; unencoded it would fake a closing quote of the
 * parameter). The Zod name schema already rejects `"` `;` CR/LF and
 * controls, so the fallback needs only non-ASCII → `_`. */
function asciiFallbackFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return /[A-Za-z0-9]/.test(ascii) ? ascii : "document";
}

function contentDisposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${asciiFallbackFilename(name)}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
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

  // Indistinguishable 404: missing, soft-deleted AND anonymized-chart get
  // the same status, code and message — never confirm that a radiography
  // exists, or ever existed, for an erased identity.
  const document = await getPrisma().patientDocument.findUnique({
    where: { id },
    select: {
      id: true,
      patientId: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      blobKey: true,
      deletedAt: true,
      patient: { select: { anonymizedAt: true } },
    },
  });
  if (!document || document.deletedAt !== null || document.patient.anonymizedAt !== null) {
    return errorResponse(404, "NOT_FOUND", "Document introuvable.");
  }

  try {
    const stream = await getDocumentStream(document.blobKey);

    await logAction(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.PATIENT_DOCUMENT_DOWNLOADED,
      "PatientDocument",
      document.id,
      { patientId: document.patientId, sizeBytes: document.sizeBytes },
      getClientIp(request.headers),
    );

    const headers = new Headers();
    headers.set("Content-Type", document.mimeType);
    headers.set("Content-Disposition", contentDisposition(document.name));

    return withRefreshedSession(new Response(stream, { headers }), guard);
  } catch (error) {
    const mapped = documentErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  // ADMIN only (task-15.md §Étape 4): deleting a radiography is an
  // administrative, irreversible-from-the-UI act — the receptionist gets 403
  // here even though they may upload and list. Explicit role list, never a
  // bare requireStaff (a role added later must fail closed).
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  // Same shared write budget as POST /api/admin/patients and the step-3
  // upload (`staff:<userId>:patients-write`, 30/5min).
  try {
    await checkRateLimit(`staff:${guard.user.id}:patients-write`, PATIENTS_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  const { id } = await params;

  // Same indistinguishable 404 as GET, for unknown, already-deleted AND
  // anonymized-chart ids.
  const document = await getPrisma().patientDocument.findUnique({
    where: { id },
    select: {
      id: true,
      patientId: true,
      sizeBytes: true,
      blobKey: true,
      deletedAt: true,
      patient: { select: { anonymizedAt: true } },
    },
  });
  if (!document || document.deletedAt !== null || document.patient.anonymizedAt !== null) {
    return errorResponse(404, "NOT_FOUND", "Document introuvable.");
  }

  // DB FIRST, blob second: the row stops granting access the moment
  // deletedAt is set, so any blob failure below leaves a private orphan
  // that is unreachable without the store token — never a live leak.
  await getPrisma().patientDocument.update({
    where: { id: document.id },
    data: { deletedAt: new Date(), deletedById: guard.user.id },
  });

  let blobDeleted = true;
  try {
    await deleteDocument(document.blobKey);
  } catch {
    // BlobNotConfigured / BlobOperation / anything else: still 200 — the
    // row is already hidden and the residual private blob is unreachable.
    // Ruling (recorded): audited `blobDeleted: false`, no 500, no retry.
    blobDeleted = false;
  }

  // Detail carries ids, size and the blobDeleted boolean — never the file
  // name, never the blobKey.
  await logAction(
    { type: AuditActorType.STAFF, userId: guard.user.id },
    AuditAction.PATIENT_DOCUMENT_DELETED,
    "PatientDocument",
    document.id,
    { patientId: document.patientId, sizeBytes: document.sizeBytes, blobDeleted },
    getClientIp(request.headers),
  );

  return withRefreshedSession(ok({ blobDeleted }), guard);
}
