/**
 * Typed errors for the case-gallery upload domain (G2 — public before/after
 * images, PUBLIC Blob storage). Mirrors src/lib/documents/errors.ts: stable
 * `name` per class so routes map to HTTP status without string-matching.
 * Messages are French (admin FR-only) and never repeat the file name or the
 * blob key.
 */

import { MAX_CASE_IMAGE_BYTES } from "@/lib/gallery/images";

/** Declared MIME type, extension and magic bytes disagreed. Maps to 415. */
export class CaseImageTypeNotAllowedError extends Error {
  constructor() {
    super("Ce type de fichier n'est pas autorisé (JPEG, PNG ou WebP uniquement).");
    this.name = "CaseImageTypeNotAllowedError";
  }
}

/** File exceeds MAX_CASE_IMAGE_BYTES. Maps to 413. Cap computed from the
 * constant, never a repeated literal. */
export class CaseImageTooLargeError extends Error {
  constructor() {
    super(
      `Le fichier dépasse la taille maximale autorisée (${MAX_CASE_IMAGE_BYTES / (1024 * 1024)} Mo).`,
    );
    this.name = "CaseImageTooLargeError";
  }
}

/** `BLOB_READ_WRITE_TOKEN` missing. Maps to 503. Thrown from inside the
 * function body — never at module load — so importing this module (e.g.
 * tests/authz-matrix.test.ts importing every route) never throws. */
export class CaseBlobNotConfiguredError extends Error {
  constructor() {
    super("Le stockage des images n'est pas configuré.");
    this.name = "CaseBlobNotConfiguredError";
  }
}

/** A Vercel Blob SDK call failed. Maps to 502. Names only the operation. */
export class CaseBlobOperationError extends Error {
  constructor(operation: "put" | "delete") {
    super(`Échec du stockage (${operation}).`);
    this.name = "CaseBlobOperationError";
  }
}
