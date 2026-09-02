// Task 15 step 2 — the single closed allow-list for patient documents
// (x-rays), plus the pure byte-level validator that enforces it.
//
// Why bytes, not just a MIME type or an extension: a `<script>` served
// *inline* from our own origin is stored cross-site scripting — one of the
// acceptance criteria for this task (tasks/todo.md, Task 15 criterion 2). An
// extension is just text the uploader typed; the `Content-Type` a browser
// declares on a multipart upload is equally self-reported. Neither can be
// trusted to say what a file actually is. Only the first bytes of the file
// itself — the "magic bytes" every real image/PDF/DICOM format starts
// with — cannot be forged without also breaking the file for the format
// they claim to be. So every upload must agree on all three: declared MIME
// type, file extension, and magic bytes. Any mismatch is a flat rejection,
// never a "best guess" correction — see validateDocumentBytes below.
//
// The allow-list is closed by construction (a plain object literal, not a
// deny-list of "bad" types): a MIME type absent from ALLOWED_TYPES is
// rejected by default, there is no fallback branch that lets an unknown type
// through.

/** One entry of the allow-list: which file extensions are legal for this
 * MIME type, and where in the file its magic-byte signature must sit. */
interface MimeTypeSpec {
  /** Lower-case extensions, each including the leading dot. */
  readonly extensions: readonly AllowedExtension[];
  /** The signature bytes, in order. */
  readonly magicBytes: readonly number[];
  /** Byte offset where `magicBytes` must start. 0 for every format here
   * except DICOM, which reserves a 128-byte preamble before its "DICM"
   * marker — a DICM at offset 0 is therefore itself a rejection, not a
   * looser match. */
  readonly magicOffset: number;
}

/** The literal union of allowed MIME types, declared once and reused both as
 * the `Record` key type below and as the source for the Zod enum in
 * src/schemas/document.ts — never a second hand-written list. */
export type AllowedMimeType =
  | "image/jpeg"
  | "image/png"
  | "application/pdf"
  | "application/dicom";

/** The literal union of allowed file extensions, declared once and reused as
 * `MimeTypeSpec.extensions`'s element type and `DocumentValidationResult`'s
 * `extension` field. Exists so that a future call like
 * `putDocument(key, bytes, file.type)` — the client's own, unvalidated
 * `Content-Type` — instead of `putDocument(key, bytes, result.mimeType)`
 * fails to compile rather than silently storing an attacker-chosen content
 * type on the blob (ortho-security audit, task-15.md §Étape 2, MAJEUR-2). */
export type AllowedExtension = ".jpg" | ".jpeg" | ".png" | ".pdf" | ".dcm";

export const ALLOWED_TYPES: Record<AllowedMimeType, MimeTypeSpec> = {
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
  "application/pdf": {
    // "%PDF-"
    extensions: [".pdf"],
    magicBytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    magicOffset: 0,
  },
  "application/dicom": {
    // "DICM", after DICOM's mandatory 128-byte preamble.
    extensions: [".dcm"],
    magicBytes: [0x44, 0x49, 0x43, 0x4d],
    magicOffset: 128,
  },
};

/** Sole declaration of the per-file size cap in the whole repo — the route
 * (step 3) and the upload form (step 5) both import this constant rather
 * than repeating the number. Chosen because a Vercel serverless function's
 * request body limit sits around 4.5 MB; staying under that means an
 * oversized file gets our French message instead of an unreadable platform
 * error (task-15.md §Décisions d'architecture 2). */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export type DocumentValidationResult =
  | { ok: true; mimeType: AllowedMimeType; extension: AllowedExtension }
  | {
      ok: false;
      reason: "TYPE" | "EXTENSION_MISMATCH" | "CONTENT_MISMATCH" | "SIZE";
    };

/** Last dot-segment of a file name, lower-cased, including the dot.
 * `null` when there is none. Callers already run the file name through the
 * Zod schema (src/schemas/document.ts) that forbids `/`, `\` and control
 * characters, but this function makes no assumption about that — it simply
 * never matches across a path separator. Returns a plain `string`, not yet
 * narrowed to `AllowedExtension` — that narrowing happens in
 * `isAllowedExtension` below, once the extension has actually been checked
 * against the allow-list for the declared MIME type. */
function extractExtension(fileName: string): string | null {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : null;
}

/** Type guard narrowing a raw extracted extension to `AllowedExtension` once
 * it is confirmed to be one of `extensions`. Needed because
 * `readonly AllowedExtension[]`'s own `.includes` rejects a plain `string`
 * argument at compile time — this is the one place that gap is bridged. */
function isAllowedExtension(
  extension: string,
  extensions: readonly AllowedExtension[],
): extension is AllowedExtension {
  return (extensions as readonly string[]).includes(extension);
}

/** Whether `bytes` contains `signature` starting at `offset`. */
function hasMagicBytes(
  bytes: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean {
  if (bytes.byteLength < offset + signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

/** Pure validator — no I/O, no database, no Blob SDK. Checks, in this exact
 * order, that a file is genuinely what it claims to be:
 *   1. the declared MIME type is in the allow-list ("TYPE");
 *   2. the file name's extension matches that type ("EXTENSION_MISMATCH");
 *   3. the file's magic bytes match that type ("CONTENT_MISMATCH" — this is
 *      the check that catches an HTML/script payload renamed to `.jpg`);
 *   4. the byte length is within MAX_DOCUMENT_BYTES ("SIZE").
 * All three of type/extension/content must agree; any single mismatch is a
 * rejection, never silently corrected to "the type the bytes suggest". */
export function validateDocumentBytes(input: {
  fileName: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}): DocumentValidationResult {
  const { fileName, declaredMimeType, bytes } = input;

  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, declaredMimeType)) {
    return { ok: false, reason: "TYPE" };
  }
  const mimeType = declaredMimeType as AllowedMimeType;
  const spec = ALLOWED_TYPES[mimeType];

  const extension = extractExtension(fileName);
  if (!extension || !isAllowedExtension(extension, spec.extensions)) {
    return { ok: false, reason: "EXTENSION_MISMATCH" };
  }

  if (!hasMagicBytes(bytes, spec.magicBytes, spec.magicOffset)) {
    return { ok: false, reason: "CONTENT_MISMATCH" };
  }

  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "SIZE" };
  }

  return { ok: true, mimeType, extension };
}
