/**
 * Typed errors for the patient document domain (Task 15 — X-ray uploads,
 * private Blob storage). Each carries a stable `name` so the route handlers
 * of steps 3-4 can map it to an HTTP status without string-matching,
 * mirroring src/lib/booking/errors.ts and src/lib/selfservice/errors.ts.
 * Messages are French: the admin dashboard is FR-only (task-15.md §Contexte,
 * verified against src/app/admin/layout.tsx), same convention as
 * src/schemas/patient.ts.
 */

import { MAX_DOCUMENT_BYTES } from "@/lib/documents/mime";

/** The declared MIME type, the file name's extension and the file's magic
 * bytes did not all agree on the same allow-listed type
 * (src/lib/documents/mime.ts#validateDocumentBytes). Maps to HTTP 415.
 * Deliberately generic: never repeats the file name or the declared type in
 * the message (CLAUDE.md — no patient-adjacent data in an error message). */
export class DocumentTypeNotAllowedError extends Error {
  constructor() {
    super("Ce type de fichier n'est pas autorisé.");
    this.name = "DocumentTypeNotAllowedError";
  }
}

/** The file exceeds MAX_DOCUMENT_BYTES. Maps to HTTP 413. The cap in the
 * message is computed from MAX_DOCUMENT_BYTES (src/lib/documents/mime.ts),
 * never repeated as a literal — a message that disagreed with the actual
 * enforced cap would be its own (small) defect (ortho-security audit,
 * task-15.md §Étape 2, MAJEUR-4). */
export class DocumentTooLargeError extends Error {
  constructor() {
    super(
      `Le fichier dépasse la taille maximale autorisée (${MAX_DOCUMENT_BYTES / (1024 * 1024)} Mo).`,
    );
    this.name = "DocumentTooLargeError";
  }
}

/** No PatientDocument row matches the id (or it is soft-deleted). Maps to
 * HTTP 404. */
export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document introuvable.");
    this.name = "DocumentNotFoundError";
  }
}

/** `BLOB_READ_WRITE_TOKEN` is missing or empty. Maps to HTTP 503. Thrown by
 * every src/lib/documents/blobStorage.ts function from inside the function
 * body — never at module load — so importing blobStorage.ts on a machine
 * without the token set (e.g. tests/authz-matrix.test.ts, which imports
 * every route module) never throws at import time
 * (task-15.md §Contexte "Comment tester un upload sans réseau"). */
export class BlobNotConfiguredError extends Error {
  constructor() {
    super("Le stockage des documents n'est pas configuré.");
    this.name = "BlobNotConfiguredError";
  }
}

/** A Vercel Blob SDK call failed (network, quota, store error…). Maps to
 * HTTP 502. The message names only the operation, never the token or the
 * full blobKey — see src/lib/documents/blobStorage.ts header comment. */
export class BlobOperationError extends Error {
  constructor(operation: "put" | "get" | "delete") {
    super(`Échec du stockage (${operation}).`);
    this.name = "BlobOperationError";
  }
}
