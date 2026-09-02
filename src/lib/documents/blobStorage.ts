import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { BlobNotConfiguredError, BlobOperationError } from "@/lib/documents/errors";
import type { AllowedExtension, AllowedMimeType } from "@/lib/documents/mime";

// Task 15 step 2 — the ONLY module in this repo allowed to `import … from
// "@vercel/blob"` (task-15.md §Contexte "Comment tester un upload sans
// réseau Vercel"). Everything else — route handlers, tests — talks to
// putDocument/getDocumentStream/deleteDocument/buildBlobKey below. That
// indirection exists so tests/integration can
// `vi.mock("@/lib/documents/blobStorage")` with an in-memory Map and never
// open a socket: the real SDK is never exercised in CI. That gap is
// deliberate and the tradeoff is written down here on purpose — the only
// proof this adapter actually talks to Vercel Blob is the manual
// verification at step 5, which is therefore not optional.
//
// `access: "private"` is non-negotiable on every call. The SDK's default —
// public, with a hard-to-guess URL — would pass every test in this repo
// while leaving an X-ray downloadable forever by anyone who ever saw the
// link. Every read of a document instead goes through
// `GET /api/admin/documents/[id]` (step 4), which re-checks the staff
// session on every single request (task-15.md §Objectif).
//
// The token is read INSIDE each function, never at module load — same lazy
// pattern as `getPrisma()` (src/lib/db.ts). `tests/authz-matrix.test.ts`
// imports every route module to build its table; if this module read
// `process.env.BLOB_READ_WRITE_TOKEN` at the top level, that import alone
// would throw on any machine without the token configured.

function readToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new BlobNotConfiguredError();
  }
  return token;
}

/** Logs only which operation failed and which SDK error class fired — never
 * the SDK error's own message, which may itself echo the pathname
 * (`blobKey`) it operated on. Never the token, ever. */
function logOperationFailure(operation: "put" | "get" | "delete", error: unknown): void {
  console.error("[documents] blobStorage operation failed", {
    operation,
    errorName: error instanceof Error ? error.name : typeof error,
  });
}

/** A valid Prisma cuid: lower-case alphanumerics only, no `/`, `\`, `.` or
 * whitespace. `buildBlobKey` rejects anything else so that `patientId` can
 * never widen the `patients/` prefix it is interpolated into — today every
 * caller already resolves the patient row (and therefore a genuine id)
 * before calling this function, but this module is the safety boundary
 * reused by steps 3-5, and a future caller building the key before that
 * resolution must fail loudly instead of silently writing outside the
 * patient's namespace (ortho-security audit, task-15.md §Étape 2,
 * MAJEUR-3 — a blob written outside the prefix would silently survive any
 * future prefix-based scan or erasure). */
const VALID_PATIENT_ID_PATTERN = /^[a-z0-9]+$/i;

/** Builds `patients/<patientId>/<random>.<ext>` — the blob's storage key is
 * NEVER derived from the file name the user supplied (path traversal,
 * collisions, control-character injection; task-15.md §Décisions
 * d'architecture 3). `randomUUID()` stands in for the "cuid" named in the
 * relay: no cuid2 package is installed for application code (Prisma's
 * `cuid()` default is internal to the Prisma engine, not exposed as a JS
 * helper), and a v4 UUID gives the same property that matters here — unique
 * and unguessable — while needing no new dependency. */
export function buildBlobKey(patientId: string, extension: AllowedExtension): string {
  if (!VALID_PATIENT_ID_PATTERN.test(patientId)) {
    throw new Error("Invalid patientId for blob key.");
  }
  return `patients/${patientId}/${randomUUID()}${extension}`;
}

/** Uploads the already-validated bytes of a document. `mimeType` must be one
 * of the allow-listed values returned by
 * `validateDocumentBytes` (src/lib/documents/mime.ts) — this function does
 * not re-validate content, it only stores it. `addRandomSuffix: false` and
 * `allowOverwrite: false` because `buildBlobKey` already guarantees a fresh,
 * unique key: a collision here would mean a bug upstream, not a case to
 * paper over. */
export async function putDocument(
  blobKey: string,
  bytes: Uint8Array,
  mimeType: AllowedMimeType,
): Promise<void> {
  const token = readToken();
  try {
    await put(blobKey, Buffer.from(bytes), {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token,
    });
  } catch (error) {
    logOperationFailure("put", error);
    throw new BlobOperationError("put");
  }
}

/** Streams a document's bytes back for `GET /api/admin/documents/[id]`
 * (step 4) to pipe into the HTTP response. Never returns a URL — private
 * blobs have none reachable without this token. */
export async function getDocumentStream(
  blobKey: string,
): Promise<ReadableStream<Uint8Array>> {
  const token = readToken();
  try {
    const result = await get(blobKey, { access: "private", token });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new BlobOperationError("get");
    }
    return result.stream;
  } catch (error) {
    if (error instanceof BlobOperationError) {
      throw error;
    }
    logOperationFailure("get", error);
    throw new BlobOperationError("get");
  }
}

/** Deletes a document's blob. Called AFTER the PatientDocument row has
 * already been soft-deleted (task-15.md §Décisions d'architecture 7) — by
 * the time this runs, the row no longer grants access to the blob, so a
 * failure here leaves an unreachable orphan rather than a live leak. */
export async function deleteDocument(blobKey: string): Promise<void> {
  const token = readToken();
  try {
    await del(blobKey, { token });
  } catch (error) {
    logOperationFailure("delete", error);
    throw new BlobOperationError("delete");
  }
}
