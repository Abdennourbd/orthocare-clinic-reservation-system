// G2 — closed allow-list + byte-level validator for public case-gallery
// uploads (before/after + extra pictures). Same discipline as
// src/lib/documents/mime.ts: the declared MIME type, the file extension and
// the magic bytes must ALL agree, because an uploader-controlled extension
// or Content-Type proves nothing about what the bytes really are — and these
// images are served INLINE on a public page, where an HTML payload would run
// as our own origin (stored XSS).
//
// Deviation from tasks/plan-gallery.md noted here, not silently: the cap is
// 4 Mo, not ~5 Mo — a Vercel serverless request body tops out around
// 4.5 Mo, so anything above 4 Mo would die with an unreadable platform
// error instead of our French message (same rationale as MAX_DOCUMENT_BYTES).

interface ImageTypeSpec {
  readonly extensions: readonly AllowedImageExtension[];
  readonly magicBytes: readonly number[];
  readonly magicOffset: number;
  readonly magicBytes2?: readonly number[];
  readonly magicOffset2?: number;
}

export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type AllowedImageExtension = ".jpg" | ".jpeg" | ".png" | ".webp";

export const ALLOWED_IMAGE_TYPES: Record<AllowedImageMimeType, ImageTypeSpec> = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    magicBytes: [0xff, 0xd8, 0xff],
    magicOffset: 0,
  },
  "image/png": {
    extensions: [".png"],
    magicBytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    magicOffset: 0,
  },
  "image/webp": {
    // "RIFF" at 0, "WEBP" at 8 — two signatures, one format.
    extensions: [".webp"],
    magicBytes: [0x52, 0x49, 0x46, 0x46],
    magicOffset: 0,
    magicBytes2: [0x57, 0x45, 0x42, 0x50],
    magicOffset2: 8,
  },
};

export const MAX_CASE_IMAGE_BYTES = 4 * 1024 * 1024;

export const MAX_EXTRAS_PER_CASE = 8;

export const MAX_FEATURED_CASES = 4;

export type CaseImageValidationResult =
  | { ok: true; mimeType: AllowedImageMimeType; extension: AllowedImageExtension }
  | {
      ok: false;
      reason: "TYPE" | "EXTENSION_MISMATCH" | "CONTENT_MISMATCH" | "SIZE";
    };

function extractExtension(fileName: string): string | null {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : null;
}

function isAllowedExtension(
  extension: string,
  extensions: readonly AllowedImageExtension[],
): extension is AllowedImageExtension {
  return (extensions as readonly string[]).includes(extension);
}

function hasMagicBytes(bytes: Uint8Array, signature: readonly number[], offset: number): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/** Pure validator — no I/O. Checks, in order: allow-listed type, matching
 * extension, matching magic bytes (both signatures when the format has
 * two), then the size cap. Any single mismatch is a rejection. */
export function validateCaseImageBytes(input: {
  fileName: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}): CaseImageValidationResult {
  const { fileName, declaredMimeType, bytes } = input;

  if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, declaredMimeType)) {
    return { ok: false, reason: "TYPE" };
  }
  const mimeType = declaredMimeType as AllowedImageMimeType;
  const spec = ALLOWED_IMAGE_TYPES[mimeType];

  const extension = extractExtension(fileName);
  if (!extension || !isAllowedExtension(extension, spec.extensions)) {
    return { ok: false, reason: "EXTENSION_MISMATCH" };
  }

  if (!hasMagicBytes(bytes, spec.magicBytes, spec.magicOffset)) {
    return { ok: false, reason: "CONTENT_MISMATCH" };
  }
  if (
    spec.magicBytes2 !== undefined &&
    spec.magicOffset2 !== undefined &&
    !hasMagicBytes(bytes, spec.magicBytes2, spec.magicOffset2)
  ) {
    return { ok: false, reason: "CONTENT_MISMATCH" };
  }

  if (bytes.byteLength > MAX_CASE_IMAGE_BYTES) {
    return { ok: false, reason: "SIZE" };
  }

  return { ok: true, mimeType, extension };
}
