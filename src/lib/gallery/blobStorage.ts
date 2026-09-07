import { del, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { CaseBlobNotConfiguredError, CaseBlobOperationError } from "@/lib/gallery/errors";
import type { AllowedImageExtension, AllowedImageMimeType } from "@/lib/gallery/images";
import { reportError } from "@/lib/monitoring/reportError";

// G2 — the ONLY module allowed to `import … from "@vercel/blob"` for case
// images (same rule as documents/blobStorage.ts): tests mock THIS module,
// never the SDK, so no test ever opens a socket.
//
// PUBLIC by design, unlike patient documents. These images render inline on
// public pages — a private blob would be unreachable without a session.
// Nothing patient-identifying is ever stored here: file names are the
// uploader's, storage keys are random UUIDs under `cases/`.

function readToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new CaseBlobNotConfiguredError();
  }
  return token;
}

function logOperationFailure(operation: "put" | "delete", error: unknown): void {
  reportError(`case_image_blob_${operation}_failed`, error);
}

/** Builds `cases/<random>.<ext>` — the key is NEVER derived from the
 * uploader-supplied file name (path traversal, collisions, control
 * characters). */
export function buildCaseImageKey(extension: AllowedImageExtension): string {
  return `cases/${randomUUID()}${extension}`;
}

/** Uploads already-validated bytes as a PUBLIC blob and returns its URL for
 * storage on the SmileCase row. `mimeType` must come from
 * `validateCaseImageBytes` — never the client's raw Content-Type. */
export async function putCaseImage(
  blobKey: string,
  bytes: Uint8Array,
  mimeType: AllowedImageMimeType,
): Promise<string> {
  const token = readToken();
  try {
    const result = await put(blobKey, Buffer.from(bytes), {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token,
    });
    return result.url;
  } catch (error) {
    logOperationFailure("put", error);
    throw new CaseBlobOperationError("put");
  }
}

/** Deletes a case image blob. Called AFTER the DB row is gone, so a failure
 * here leaves an unreachable orphan rather than a live leak. */
export async function deleteCaseImage(blobKey: string): Promise<void> {
  const token = readToken();
  try {
    await del(blobKey, { token });
  } catch (error) {
    logOperationFailure("delete", error);
    throw new CaseBlobOperationError("delete");
  }
}

/** Extracts the storage key from a blob URL previously returned by
 * `putCaseImage`, for deletion. Returns null when the URL is not one of
 * ours (local /images/… path or foreign host) — those need no blob cleanup. */
export function blobKeyFromUrl(imageUrl: string, blobHostSuffix: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith(blobHostSuffix) || !parsed.pathname.startsWith("/cases/")) {
    return null;
  }
  return parsed.pathname.slice(1);
}
