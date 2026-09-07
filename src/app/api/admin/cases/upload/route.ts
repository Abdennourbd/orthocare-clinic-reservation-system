import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/api/http";
import {
  assertSameOriginStrict,
  requireStaff,
  withRefreshedSession,
} from "@/lib/auth/guard";
import { checkRateLimit, RateLimitError } from "@/lib/security/rateLimit";
import { CONTENT_WRITE_RATE_LIMIT } from "@/lib/content/rateLimits";
import { caseUploadSchema } from "@/schemas/case";
import {
  MAX_CASE_IMAGE_BYTES,
  validateCaseImageBytes,
} from "@/lib/gallery/images";
import { buildCaseImageKey, putCaseImage } from "@/lib/gallery/blobStorage";
import {
  CaseBlobNotConfiguredError,
  CaseBlobOperationError,
  CaseImageTooLargeError,
  CaseImageTypeNotAllowedError,
} from "@/lib/gallery/errors";

// G2 — POST /api/admin/cases/upload (multipart file upload → public Blob).
// ADMIN-only. Load-bearing order (same as patient documents): staff → CSRF
// → rate limit → formData (400) → Zod metadata (400) → FILE SIZE from the
// declared part size (413, BEFORE arrayBuffer — an oversized file is
// rejected without ever being fully buffered) → arrayBuffer → byte-level
// validation (415/413) → blob put (only after every validation passed — a
// rejected upload must never leave an orphan blob) → 201 {url}.
//
// The returned URL is public by design (gallery pages are public). Nothing
// patient-identifying travels here: the storage key is a random UUID, and
// the uploader's file name is validated but never stored.

export async function POST(request: NextRequest) {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;

  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "CSRF_ORIGIN_MISMATCH", "Origine non autorisée.");
  }

  try {
    await checkRateLimit(`staff:${guard.user.id}:content-write`, CONTENT_WRITE_RATE_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return errorResponse(429, "RATE_LIMITED", "Trop de requêtes. Réessayez plus tard.");
    }
    throw e;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Formulaire illisible.");
  }

  const file = form.get("file");
  const declaredMimeType = form.get("declaredMimeType");
  const parsed = caseUploadSchema.safeParse({
    fileName: file instanceof File ? file.name : undefined,
    declaredMimeType: typeof declaredMimeType === "string" ? declaredMimeType : undefined,
  });
  if (!parsed.success || !(file instanceof File)) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.success ? "Le fichier est requis." : parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  if (file.size > MAX_CASE_IMAGE_BYTES) {
    return errorResponse(413, "IMAGE_TOO_LARGE", new CaseImageTooLargeError().message);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateCaseImageBytes({
    fileName: parsed.data.fileName,
    declaredMimeType: parsed.data.declaredMimeType,
    bytes,
  });
  if (!validation.ok) {
    if (validation.reason === "SIZE") {
      return errorResponse(413, "IMAGE_TOO_LARGE", new CaseImageTooLargeError().message);
    }
    return errorResponse(415, "IMAGE_TYPE_NOT_ALLOWED", new CaseImageTypeNotAllowedError().message);
  }

  try {
    const url = await putCaseImage(
      buildCaseImageKey(validation.extension),
      bytes,
      validation.mimeType,
    );
    return withRefreshedSession(ok({ url }, { status: 201 }), guard);
  } catch (e) {
    const mapped = caseImageErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}

function caseImageErrorResponse(error: unknown): Response | null {
  if (error instanceof CaseImageTypeNotAllowedError) {
    return errorResponse(415, "IMAGE_TYPE_NOT_ALLOWED", error.message);
  }
  if (error instanceof CaseImageTooLargeError) {
    return errorResponse(413, "IMAGE_TOO_LARGE", error.message);
  }
  if (error instanceof CaseBlobNotConfiguredError) {
    return errorResponse(503, "BLOB_NOT_CONFIGURED", error.message);
  }
  if (error instanceof CaseBlobOperationError) {
    return errorResponse(502, "BLOB_OPERATION_FAILED", error.message);
  }
  return null;
}
